-- Canonical DrillOps identity and app access live beside FieldMaps Auth.
CREATE TABLE IF NOT EXISTS maps_private.drillops_access (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 apps text[] NOT NULL DEFAULT ARRAY['fieldmaps']::text[], active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS maps_private.drillops_identity_links (
 legacy_user_id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id), UNIQUE(user_id)
);
CREATE TABLE IF NOT EXISTS maps_private.drillops_access_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id uuid NOT NULL REFERENCES auth.users(id),
 user_id uuid NOT NULL REFERENCES auth.users(id),before_value jsonb,after_value jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE maps_private.drillops_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE maps_private.drillops_identity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE maps_private.drillops_access_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON maps_private.drillops_access,maps_private.drillops_identity_links,maps_private.drillops_access_events FROM PUBLIC,anon,authenticated;
INSERT INTO maps_private.drillops_access(user_id) SELECT id FROM auth.users ON CONFLICT DO NOTHING;
INSERT INTO maps_private.drillops_identity_links VALUES
 ('ad598f44-a39b-42fd-a0b6-ddc8f81adba0','c636e8ab-01d4-458e-a455-6f329dae6bf1'),
 ('9f1914b5-53ff-4a78-b688-802900e1fbb0','dfb3114e-c357-47b4-8947-2612bd90aaf8') ON CONFLICT DO NOTHING;
UPDATE maps_private.drillops_access SET apps=ARRAY['fieldmaps','eos','account','project','field'] WHERE user_id='c636e8ab-01d4-458e-a455-6f329dae6bf1' AND revision=1;
UPDATE maps_private.drillops_access SET apps=ARRAY['fieldmaps','field'] WHERE user_id='dfb3114e-c357-47b4-8947-2612bd90aaf8' AND revision=1;
CREATE OR REPLACE FUNCTION maps_private.drillops_is_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid()='c636e8ab-01d4-458e-a455-6f329dae6bf1'::uuid AND EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()));
$$;
CREATE OR REPLACE FUNCTION maps_private.drillops_has_app(app text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM maps_private.drillops_access a JOIN auth.users u ON u.id=a.user_id WHERE a.user_id=auth.uid() AND a.active AND app=ANY(a.apps) AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now()));
$$;
CREATE OR REPLACE FUNCTION maps_private.drillops_identity_access(provider text,subject uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid;result jsonb;BEGIN
 IF provider='canonical' THEN u:=subject;ELSIF provider='legacy' THEN SELECT user_id INTO u FROM maps_private.drillops_identity_links WHERE legacy_user_id=subject;ELSE RAISE EXCEPTION 'Unknown identity provider';END IF;
 SELECT jsonb_build_object('user_id',a.user_id,'operations_user_id',coalesce(l.legacy_user_id,a.user_id),'email',p.email,'name',coalesce(nullif(p.raw_user_meta_data->>'full_name',''),nullif(p.raw_user_meta_data->>'name',''),split_part(p.email,'@',1)),'apps',a.apps,'active',a.active AND p.deleted_at IS NULL AND (p.banned_until IS NULL OR p.banned_until<=now()),'owner',a.user_id='c636e8ab-01d4-458e-a455-6f329dae6bf1'::uuid,'revision',a.revision)
 INTO result FROM maps_private.drillops_access a JOIN auth.users p ON p.id=a.user_id LEFT JOIN maps_private.drillops_identity_links l ON l.user_id=a.user_id WHERE a.user_id=u;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.drillops_identity_access(provider text,subject uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT maps_private.drillops_identity_access(provider,subject);$$;
CREATE OR REPLACE FUNCTION maps_private.drillops_own_access() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT CASE WHEN auth.uid() IS NOT NULL THEN maps_private.drillops_identity_access('canonical',auth.uid()) ELSE NULL END;$$;
REVOKE ALL ON FUNCTION maps_private.drillops_own_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION maps_private.drillops_own_access() TO authenticated;
CREATE OR REPLACE FUNCTION public.drillops_access() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT maps_private.drillops_own_access();$$;
CREATE OR REPLACE FUNCTION maps_private.drillops_admin_users() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$BEGIN
 IF NOT coalesce(maps_private.drillops_is_owner(),false) THEN RAISE EXCEPTION 'Owner access required' USING errcode='42501';END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'name',coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name',''),'apps',coalesce(a.apps,'{}'),'active',coalesce(a.active,false),'revision',coalesce(a.revision,0),'owner',u.id=auth.uid()) ORDER BY u.email),'[]'::jsonb) FROM auth.users u LEFT JOIN maps_private.drillops_access a ON a.user_id=u.id WHERE u.deleted_at IS NULL);
END $$;
CREATE OR REPLACE FUNCTION public.drillops_admin_users() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT maps_private.drillops_admin_users();$$;
CREATE OR REPLACE FUNCTION maps_private.drillops_admin_access(target uuid,apps text[],active boolean,revision integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old maps_private.drillops_access;updated maps_private.drillops_access;BEGIN
 IF NOT coalesce(maps_private.drillops_is_owner(),false) THEN RAISE EXCEPTION 'Owner access required' USING errcode='42501';END IF;
 IF target=auth.uid() THEN RAISE EXCEPTION 'Owner access is protected';END IF;
 IF apps IS NULL OR active IS NULL OR NOT apps<@ARRAY['fieldmaps','eos','account','project','field']::text[] THEN RAISE EXCEPTION 'Invalid app access';END IF;
 SELECT * INTO old FROM maps_private.drillops_access a WHERE a.user_id=target FOR UPDATE;
 IF NOT FOUND OR old.revision<>revision THEN RAISE EXCEPTION 'Access changed. Refresh before saving.' USING errcode='40001';END IF;
 UPDATE maps_private.drillops_access a SET apps=(SELECT coalesce(array_agg(DISTINCT x),'{}'::text[]) FROM unnest(drillops_admin_access.apps) x),active=drillops_admin_access.active,revision=a.revision+1,updated_at=now() WHERE a.user_id=target RETURNING * INTO updated;
 INSERT INTO maps_private.drillops_access_events(actor_id,user_id,before_value,after_value) VALUES(auth.uid(),target,to_jsonb(old),to_jsonb(updated));
 RETURN to_jsonb(updated);
END $$;
CREATE OR REPLACE FUNCTION public.drillops_admin_access(target uuid,apps text[],active boolean,revision integer) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT maps_private.drillops_admin_access(target,apps,active,revision);$$;
CREATE OR REPLACE FUNCTION maps_private.drillops_new_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$BEGIN INSERT INTO maps_private.drillops_access(user_id) VALUES(new.id) ON CONFLICT DO NOTHING;RETURN new;END $$;
DROP TRIGGER IF EXISTS drillops_new_account ON auth.users;
CREATE TRIGGER drillops_new_account AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION maps_private.drillops_new_account();
REVOKE ALL ON FUNCTION maps_private.drillops_is_owner(),maps_private.drillops_has_app(text),maps_private.drillops_identity_access(text,uuid),public.drillops_identity_access(text,uuid),public.drillops_access(),maps_private.drillops_admin_users(),public.drillops_admin_users(),maps_private.drillops_admin_access(uuid,text[],boolean,integer),public.drillops_admin_access(uuid,text[],boolean,integer),maps_private.drillops_new_account() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.drillops_identity_access(text,uuid),maps_private.drillops_identity_access(text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION maps_private.drillops_is_owner(),maps_private.drillops_has_app(text),public.drillops_access(),maps_private.drillops_admin_users(),public.drillops_admin_users(),maps_private.drillops_admin_access(uuid,text[],boolean,integer),public.drillops_admin_access(uuid,text[],boolean,integer) TO authenticated;
-- Apply app revocation to existing FieldMaps row/storage policies through their shared helpers.
CREATE OR REPLACE FUNCTION maps_private.ws_platform() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT maps_private.drillops_has_app('fieldmaps') AND EXISTS(SELECT 1 FROM maps_private.platform_admins p JOIN auth.users u ON u.id=p.user_id WHERE p.user_id=auth.uid() AND (u.banned_until IS NULL OR u.banned_until<=now())); $$;
CREATE OR REPLACE FUNCTION maps_private.ws_role(w uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT CASE WHEN NOT maps_private.drillops_has_app('fieldmaps') THEN NULL WHEN maps_private.ws_platform() THEN 'owner' ELSE (SELECT m.role FROM public.workspace_members m JOIN public.workspaces c ON c.id=m.workspace_id JOIN auth.users u ON u.id=m.user_id WHERE m.workspace_id=w AND m.user_id=auth.uid() AND m.status='active' AND c.status='active' AND (u.banned_until IS NULL OR u.banned_until<=now())) END; $$;
-- Existing Operations-only user was copied with its existing password hash once,
-- without overwriting any canonical account. Preserve its established app access.
INSERT INTO maps_private.drillops_identity_links(legacy_user_id,user_id)
 SELECT '2d26a244-b287-4437-aa3a-9e9d1087ab4d',id FROM auth.users
 WHERE id='2d26a244-b287-4437-aa3a-9e9d1087ab4d' ON CONFLICT DO NOTHING;
UPDATE maps_private.drillops_access SET apps=ARRAY['eos','account','project','field']
 WHERE user_id='2d26a244-b287-4437-aa3a-9e9d1087ab4d' AND revision=1;
