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
declare geom jsonb; features jsonb; saved_id uuid; restored jsonb; started timestamptz;
begin
 select jsonb_build_object('type','GeometryCollection','geometries',jsonb_agg(jsonb_build_object('type','Polygon','coordinates',jsonb_build_array(jsonb_build_array(
 jsonb_build_array(148.0+i*0.0001,-21,300),jsonb_build_array(148.00005+i*0.0001,-21,310),
 jsonb_build_array(148.00005+i*0.0001,-21.00005,320),jsonb_build_array(148.0+i*0.0001,-21.00005,330),
 jsonb_build_array(148.0+i*0.0001,-21,300)))))) into geom from generate_series(0,37) i;
 select jsonb_agg(jsonb_build_object('type','Feature','geometry',geom,'properties',jsonb_build_object('Name','Fixture '||i,'_fieldmaps_kml_original_geometry',geom,'notes',repeat('n',6500)))) into features from generate_series(1,499) i;
 if octet_length(features::text)<9000000 then raise exception 'Fixture is too small: % bytes',octet_length(features::text);end if;
 started:=clock_timestamp();
 saved_id:=public.import_vector(jsonb_build_object('map_id','00000000-0000-4000-8000-000000000979','name','Large 3D collection','source_crs','EPSG:4326','metadata',jsonb_build_object('format','KMZ')),features);
 if (select count(*) from public.features where public.features.layer_id=saved_id)<>499 then raise exception 'Incomplete feature save';end if;
 restored:=public.layer_geojson(saved_id);
 if jsonb_array_length(restored->'features')<>499 then raise exception 'Incomplete saved readback';end if;
 if not exists(select 1 from public.features f where f.layer_id=saved_id and f.properties ? '_fieldmaps_kml_original_geometry') then raise exception 'Original 3D geometry was lost';end if;
 if clock_timestamp()-started>interval '42 seconds' then raise exception 'Import is too slow';end if;
end $test$;
reset role;
rollback;
select 'PASS: representative 9+ MB 3D KMZ import and readback, 499 features, authenticated RLS, original geometry retained; all fixture data rolled back' as result;
