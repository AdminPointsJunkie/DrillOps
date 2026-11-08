CREATE OR REPLACE FUNCTION maps_private.drillops_new_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE chosen text[]; saved maps_private.drillops_access;
BEGIN
 IF new.raw_app_meta_data->>'drillops_created_by'='c636e8ab-01d4-458e-a455-6f329dae6bf1' THEN
  IF jsonb_typeof(new.raw_app_meta_data->'drillops_initial_apps') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid initial apps'; END IF;
  SELECT array_agg(DISTINCT v) INTO chosen FROM jsonb_array_elements_text(new.raw_app_meta_data->'drillops_initial_apps') v;
  IF coalesce(cardinality(chosen),0)=0 OR NOT chosen<@ARRAY['fieldmaps','eos','account','project','field']::text[] THEN RAISE EXCEPTION 'Invalid initial apps'; END IF;
  INSERT INTO maps_private.drillops_access(user_id,apps) VALUES(new.id,chosen) RETURNING * INTO saved;
  INSERT INTO maps_private.drillops_access_events(actor_id,user_id,before_value,after_value)
   VALUES('c636e8ab-01d4-458e-a455-6f329dae6bf1',new.id,NULL,to_jsonb(saved));
 ELSE
  INSERT INTO maps_private.drillops_access(user_id) VALUES(new.id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION maps_private.drillops_new_account() FROM PUBLIC,anon,authenticated;
