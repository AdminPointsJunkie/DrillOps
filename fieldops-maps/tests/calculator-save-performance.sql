begin;
set local statement_timeout='55s';
do $$ declare w uuid;u uuid;sid uuid;m uuid:=gen_random_uuid();l uuid:=gen_random_uuid();begin
 select wm.workspace_id,wm.user_id,a.session_id into w,u,sid from public.workspace_members wm join maps_private.fieldmaps_active_sessions a on a.user_id=wm.user_id join maps_private.drillops_access d on d.user_id=wm.user_id where wm.role='owner' and wm.status='active' and d.active and 'fieldmaps'=any(d.apps) limit 1;
 if u is null then raise exception 'No test administrator';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
 insert into public.maps(id,owner_id,workspace_id,name) values(m,u,w,'Calculator performance verification');
 insert into public.layers(id,map_id,name,kind,source_crs,metadata) values(l,m,'Calculator temporary','vector','EPSG:4326','{}');
 insert into public.features(layer_id,geometry,properties) select l,extensions.st_setsrid(extensions.st_makepoint(148+n/100000.0,-22),4326),(select jsonb_object_agg('Field '||c,'Example borehole value '||c) from generate_series(1,80)c)||jsonb_build_object('Hitch/Spud','01/01/2021') from generate_series(1,810)n;
 perform set_config('test.calculator_layer',l::text,true);
end $$;
set local role authenticated;
do $$ declare l uuid:=current_setting('test.calculator_layer')::uuid;base jsonb;edited jsonb;payload jsonb;r jsonb;t timestamptz;begin
 base:=public.layer_geojson(l)->'features';
 select jsonb_build_object('name',name,'source_crs',source_crs,'vertical_datum',vertical_datum,'metadata',metadata,'original_paths',original_paths) into payload from public.layers where id=l;
 select jsonb_agg(jsonb_set(f,'{properties}',(f->'properties')||jsonb_build_object('Drilled Year',2021))) into edited from jsonb_array_elements(base) f;
 t:=clock_timestamp();r:=public.merge_vector_edits(l,jsonb_set(payload,'{metadata}',(payload->'metadata')||'{"field_types":{"Drilled Year":"integer"}}'),payload,base,edited);
 perform set_config('test.calculator_duration',extract(epoch from clock_timestamp()-t)::text,true);
 if jsonb_array_length(r->'fc'->'features')<>810 or exists(select 1 from public.features where layer_id=l and properties->>'Drilled Year'<>'2021') then raise exception 'Calculated values not saved';end if;
end $$;
select current_setting('test.calculator_duration') as seconds;
rollback;
