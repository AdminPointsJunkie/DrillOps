begin;
set local statement_timeout='45s';
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-4000-8000-000000000977','authenticated','authenticated','fieldmaps-save-check-977@example.invalid','{}','{}');
insert into public.workspaces(id,name) values('00000000-0000-4000-8000-000000000978','Isolated save check');
insert into public.workspace_members(workspace_id,user_id,role) values('00000000-0000-4000-8000-000000000978','00000000-0000-4000-8000-000000000977','owner');
insert into public.maps(id,owner_id,workspace_id,name) values('00000000-0000-4000-8000-000000000979','00000000-0000-4000-8000-000000000977','00000000-0000-4000-8000-000000000978','Rolled-back KMZ save verification');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000977","role":"authenticated","app_metadata":{}}',true);
set local role authenticated;
do $test$
declare geom jsonb; features jsonb; saved_id uuid; restored jsonb; started timestamptz; publication jsonb; versioned jsonb; layer_value jsonb; mobile_result jsonb; base_feature jsonb;
begin
 select jsonb_build_object('type','GeometryCollection','geometries',jsonb_agg(jsonb_build_object('type','Polygon','coordinates',jsonb_build_array(jsonb_build_array(
 jsonb_build_array(148.0+i*0.0001,-21,300),jsonb_build_array(148.00005+i*0.0001,-21,310),
 jsonb_build_array(148.00005+i*0.0001,-21.00005,320),jsonb_build_array(148.0+i*0.0001,-21.00005,330),
 jsonb_build_array(148.0+i*0.0001,-21,300)))))) into geom from generate_series(0,1) i;
 -- Match the failing KMZ: MultiGeometry nested inside another collection.
 geom:=jsonb_build_object('type','GeometryCollection','geometries',jsonb_build_array(geom));
 select jsonb_agg(jsonb_build_object('type','Feature','geometry',geom,'properties',jsonb_build_object('Name','Fixture '||i,'_fieldmaps_kml_original_geometry',geom,'notes','fixture'))) into features from generate_series(1,3) i;
 started:=clock_timestamp();
 saved_id:=public.import_vector(jsonb_build_object('map_id','00000000-0000-4000-8000-000000000979','name','Large 3D collection','source_crs','EPSG:4326','metadata',jsonb_build_object('format','KMZ')),features);
 if (select count(*) from public.features where public.features.layer_id=saved_id)<>3 then raise exception 'Incomplete feature save';end if;
 restored:=public.layer_geojson(saved_id);
 if jsonb_array_length(restored->'features')<>3 then raise exception 'Incomplete saved readback';end if;
 if not exists(select 1 from public.features f where f.layer_id=saved_id and f.properties ? '_fieldmaps_kml_original_geometry') then raise exception 'Original 3D geometry was lost';end if;

 if restored#>>'{features,0,geometry,geometries,0,geometries,0,type}'<>'Polygon' then raise exception 'Nested collection structure lost';end if;
 if (restored#>>'{features,0,geometry,geometries,0,geometries,0,coordinates,0,0,2}')::numeric<>300 then raise exception 'Z coordinate lost';end if;
 select to_jsonb(l) into layer_value from public.layers l where id=saved_id;
 versioned:=public.replace_vector_versioned(saved_id,layer_value,restored->'features',coalesce(layer_value->'metadata'->>'data_revision',''));
 if jsonb_array_length(versioned->'features')<>3 then raise exception 'Versioned replacement lost features';end if;
 update public.maps set layer_layout=jsonb_build_array(saved_id::text) where id='00000000-0000-4000-8000-000000000979';
 publication:=public.sync_map('00000000-0000-4000-8000-000000000979',gen_random_uuid(),(select draft_revision from public.maps where id='00000000-0000-4000-8000-000000000979'));
 restored:=public.maps_release_layer((publication->>'id')::uuid,saved_id);
 if jsonb_array_length(restored->'fc'->'features')<>3 then raise exception 'Publication lost features';end if;
 restored:=public.maps_release_layer((publication->>'id')::uuid,saved_id,2,null);
 if jsonb_array_length(restored->'fc'->'features')<>3 then raise exception 'Generalised readback lost features';end if;

 perform public.workspace_fieldops_access('00000000-0000-4000-8000-000000000978','00000000-0000-4000-8000-000000000977',true);
 base_feature:=public.layer_geojson(saved_id)->'features'->0;
 mobile_result:=public.fieldops_apply_edit(gen_random_uuid(),'00000000-0000-4000-8000-000000000979',saved_id,base_feature,jsonb_set(base_feature,'{properties,Name}','"Field edit"'));
 if mobile_result->>'status'<>'uploaded' then raise exception 'Nested FieldOps attribute edit failed: %',mobile_result;end if;
 if mobile_result#>>'{feature,geometry,geometries,0,geometries,0,type}'<>'Polygon' then raise exception 'FieldOps edit lost nested geometry';end if;
end $test$;
reset role;
rollback;
select 'PASS: nested KMZ readback, original Z and hierarchy, version history, publication, generalised download and FieldOps edit; all fixture data rolled back' as result;
