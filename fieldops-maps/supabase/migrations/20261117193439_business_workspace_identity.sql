-- Extend the existing verified identity bridge; no new accounts or memberships.
CREATE OR REPLACE FUNCTION maps_private.drillops_business_identity(provider text, subject uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; u uuid; admin boolean;
BEGIN
 result := maps_private.drillops_identity_access(provider,subject);
 IF result IS NULL OR NOT (result->>'active')::boolean THEN RETURN result; END IF;
 u := (result->>'user_id')::uuid;
 SELECT EXISTS(SELECT 1 FROM maps_private.platform_admins WHERE user_id=u) INTO admin;
 RETURN result || jsonb_build_object('owner',admin,'workspaces',COALESCE((
 SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'role',CASE WHEN admin THEN 'owner' ELSE m.role END,
   'owner_id',w.owner_id,'people',CASE WHEN admin OR m.role IN ('owner','admin') THEN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',wm.user_id,'name',COALESCE(NULLIF(wm.display_name,''),split_part(au.email,'@',1)),
       'email',au.email,'role',wm.role,'status',wm.status,'apps',COALESCE(a.apps,'{}'::text[]),
       'platform_admin',EXISTS(SELECT 1 FROM maps_private.platform_admins pa WHERE pa.user_id=wm.user_id)))
    FROM public.workspace_members wm JOIN auth.users au ON au.id=wm.user_id
    LEFT JOIN maps_private.drillops_access a ON a.user_id=wm.user_id AND a.active
    WHERE wm.workspace_id=w.id), '[]'::jsonb) ELSE '[]'::jsonb END) ORDER BY w.name)
 FROM public.workspaces w LEFT JOIN public.workspace_members m ON m.workspace_id=w.id AND m.user_id=u AND m.status='active'
 WHERE w.status='active' AND (admin OR m.user_id IS NOT NULL)), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION maps_private.drillops_business_identity(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION maps_private.drillops_business_identity(text,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.drillops_identity_access(provider text,subject uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT maps_private.drillops_business_identity(provider,subject);
$$;
REVOKE ALL ON FUNCTION public.drillops_identity_access(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.drillops_identity_access(text,uuid) TO service_role;
