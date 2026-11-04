-- Transaction-only integration test. Run after the layer_recycle_bin migration.
begin;
insert into auth.users(id) values ('df000000-0000-4000-8000-000000000001'),('df000000-0000-4000-8000-000000000002');
insert into public.workspaces(id,name) values ('df000000-0000-4000-8000-000000000010','Workflow QA'),('df000000-0000-4000-8000-000000000011','Other QA');
insert into public.workspace_members(workspace_id,user_id,role) values ('df000000-0000-4000-8000-000000000010','df000000-0000-4000-8000-000000000001','owner'),('df000000-0000-4000-8000-000000000011','df000000-0000-4000-8000-000000000002','owner');
select set_config('request.jwt.claim.sub','df000000-0000-4000-8000-000000000001',true);
insert into public.maps(id,workspace_id,owner_id,name,layer_layout) values
 ('df000000-0000-4000-8000-000000000020','df000000-0000-4000-8000-000000000010','df000000-0000-4000-8000-000000000001','Source','[{"id":"group","name":"Survey","children":["df000000-0000-4000-8000-000000000030","df000000-0000-4000-8000-000000000031"]}]'),
 ('df000000-0000-4000-8000-000000000021','df000000-0000-4000-8000-000000000010','df000000-0000-4000-8000-000000000001','Destination','[]'),
 ('df000000-0000-4000-8000-000000000022','df000000-0000-4000-8000-000000000011','df000000-0000-4000-8000-000000000002','Other','[]');
insert into public.layers(id,map_id,name,kind,source_crs,vertical_datum,metadata,color,opacity,visible) values
 ('df000000-0000-4000-8000-000000000030','df000000-0000-4000-8000-000000000020','Remove me','vector','EPSG:4326','Unknown','{"style":{"color":"red"}}','#ff0000',0.8,true),
 ('df000000-0000-4000-8000-000000000031','df000000-0000-4000-8000-000000000020','Keep me','vector','EPSG:4326','Unknown','{}','#00ff00',0.8,true);
insert into public.features(layer_id,geometry,properties) values ('df000000-0000-4000-8000-000000000030','0101000020E610000000000000002063400000000000003BC0','{"name":"A","_fieldmaps_files":[]}');

set local role authenticated;
do $$declare result jsonb; version_id uuid; token text; payload jsonb; begin
 select to_jsonb(l) into payload from public.layers l where id='df000000-0000-4000-8000-000000000030';
 result:=public.replace_vector_versioned('df000000-0000-4000-8000-000000000030',payload,'[{"type":"Feature","geometry":{"type":"Point","coordinates":[154,-28]},"properties":{"name":"B"}}]');
 version_id:=(result->>'version')::uuid;token:=result->>'data_revision';
 assert (select properties->>'name' from public.features where layer_id='df000000-0000-4000-8000-000000000030')='B';
 assert (select count(*) from public.layer_data_versions where layer_id='df000000-0000-4000-8000-000000000030')=1;
 begin perform public.replace_vector_versioned('df000000-0000-4000-8000-000000000030',payload,'[]','');raise exception 'stale accepted';exception when raise_exception then if sqlerrm not like 'Layer data changed%' then raise;end if;end;
 begin perform public.replace_vector_versioned('df000000-0000-4000-8000-000000000030',payload,'[]',token);raise exception 'empty accepted';exception when raise_exception then if sqlerrm not like 'Import between%' then raise;end if;end;
 assert (select count(*) from public.layer_data_versions where layer_id='df000000-0000-4000-8000-000000000030')=1;
 result:=public.replace_vector_versioned('df000000-0000-4000-8000-000000000030','{}','[]',token,version_id);
 assert (select properties->>'name' from public.features where layer_id='df000000-0000-4000-8000-000000000030')='A';
 perform public.apply_map_style(array['df000000-0000-4000-8000-000000000030'::uuid,'df000000-0000-4000-8000-000000000031'::uuid],'{"color":"#123456","opacity":0.8,"style":{"pointSize":24}}');
 assert (select count(*) from public.layers where color='#123456' and map_id='df000000-0000-4000-8000-000000000020')=2;
 insert into public.map_style_presets(workspace_id,name,style) values ('df000000-0000-4000-8000-000000000010','QA','{"color":"#123456"}');
 insert into public.map_view_links(map_id) values ('df000000-0000-4000-8000-000000000020');
 assert (select enabled from public.map_view_links where map_id='df000000-0000-4000-8000-000000000020')=false;
end $$;
reset role;
select set_config('request.jwt.claim.sub','df000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$begin
 assert not exists(select 1 from public.layer_data_versions where layer_id='df000000-0000-4000-8000-000000000030');
 assert not exists(select 1 from public.map_style_presets where workspace_id='df000000-0000-4000-8000-000000000010');
 assert not exists(select 1 from public.map_view_links where map_id='df000000-0000-4000-8000-000000000020');
 begin perform public.replace_vector_versioned('df000000-0000-4000-8000-000000000030','{}','[]');raise exception 'cross-workspace allowed';exception when raise_exception then if sqlerrm<>'Layer unavailable or access denied' then raise;end if;end;
end $$;
reset role;
do $$begin
 assert not has_table_privilege('anon','public.map_view_links','select');
 assert not has_table_privilege('anon','public.layer_data_versions','select');
 assert not has_function_privilege('anon','public.replace_vector_versioned(uuid,jsonb,jsonb,text,uuid)','execute');
end $$;
rollback;
