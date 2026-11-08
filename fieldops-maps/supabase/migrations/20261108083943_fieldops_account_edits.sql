-- FieldMaps accounts remain independent. Upload permission is a live, per-workspace grant.
create table maps_private.fieldops_access (
 workspace_id uuid not null, user_id uuid not null, enabled boolean not null default false,
 primary key(workspace_id,user_id),
 foreign key(workspace_id,user_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);
create table maps_private.fieldops_operations (
 user_id uuid not null references auth.users(id) on delete cascade,
 operation_id uuid not null, map_id uuid not null references public.maps(id) on delete cascade,
 request jsonb not null, response jsonb not null, created_at timestamptz not null default now(),
 primary key(user_id,operation_id)
);
alter table maps_private.fieldops_access enable row level security;
alter table maps_private.fieldops_operations enable row level security;
revoke all on maps_private.fieldops_access,maps_private.fieldops_operations from public,anon,authenticated;

create function maps_private.fieldops_allowed(p_map uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and maps_private.ws_project(p_map,true) and exists(
  select 1 from public.maps m join maps_private.fieldops_access a on a.workspace_id=m.workspace_id
  join public.workspace_members u on u.workspace_id=a.workspace_id and u.user_id=a.user_id
  join public.workspaces w on w.id=u.workspace_id
  where m.id=p_map and a.user_id=auth.uid() and a.enabled and u.status='active' and w.status='active');
$$;
create function maps_private.fieldops_capabilities() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(m.id),'[]') from public.maps m where auth.uid() is not null and maps_private.fieldops_allowed(m.id)
 and exists(select 1 from public.map_releases r where r.map_id=m.id);
$$;
create function maps_private.fieldops_permissions(w uuid, target uuid default null, enabled boolean default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not maps_private.ws_manage(w) then raise exception 'Workspace administrator access required' using errcode='42501';end if;
 if target is not null then
  if enabled is null or not exists(select 1 from public.workspace_members where workspace_id=w and user_id=target) then raise exception 'Workspace member not found';end if;
  insert into maps_private.fieldops_access(workspace_id,user_id,enabled) values(w,target,enabled)
  on conflict(workspace_id,user_id) do update set enabled=excluded.enabled;
  insert into public.workspace_events(workspace_id,actor_id,action,detail) values(w,auth.uid(),'fieldops.upload_access',jsonb_build_object('user_id',target,'enabled',enabled));
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',a.user_id,'enabled',a.enabled)) from maps_private.fieldops_access a where a.workspace_id=w),'[]');
end $$;

-- Three-way merge: independent attributes and geometry changes merge; same-field edits do not.
create function maps_private.merge_field_feature(base jsonb, local_value jsonb, remote_value jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb; props jsonb; k text; conflicts jsonb:='[]'; b jsonb; l jsonb; r jsonb;
begin
 base:=nullif(base,'null');local_value:=nullif(local_value,'null');remote_value:=nullif(remote_value,'null');
 if local_value is not distinct from base then return jsonb_build_object('status','merged','feature',remote_value);end if;
 if remote_value is not distinct from base or local_value is not distinct from remote_value then return jsonb_build_object('status','merged','feature',local_value);end if;
 if base is null or local_value is null or remote_value is null then
  return jsonb_build_object('status','conflict','feature',remote_value,'fields',jsonb_build_array('feature deleted or replaced'));
 end if;
 result:=remote_value;props:=coalesce(remote_value->'properties','{}');
 for k in select jsonb_object_keys(coalesce(base->'properties','{}')) union select jsonb_object_keys(coalesce(local_value->'properties','{}')) loop
  b:=base->'properties'->k;l:=local_value->'properties'->k;r:=remote_value->'properties'->k;
  if l is distinct from b then
   if r is distinct from b and r is distinct from l then conflicts:=conflicts||jsonb_build_array(k);
   elsif l is null then props:=props-k;else props:=jsonb_set(props,array[k],l,true);end if;
  end if;
 end loop;
 result:=jsonb_set(result,'{properties}',props,true);
 if local_value->'geometry' is distinct from base->'geometry' then
  if remote_value->'geometry' is distinct from base->'geometry' and remote_value->'geometry' is distinct from local_value->'geometry' then conflicts:=conflicts||jsonb_build_array('geometry');
  else result:=jsonb_set(result,'{geometry}',local_value->'geometry');end if;
 end if;
 return jsonb_build_object('status',case when jsonb_array_length(conflicts)>0 then 'conflict' else 'merged' end,'feature',case when jsonb_array_length(conflicts)>0 then remote_value else result end,'fields',conflicts);
end $$;

create function maps_private.fieldops_apply_edit(op uuid, p_map uuid, p_layer uuid, p_base jsonb, p_feature jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare lid public.layers; current_value jsonb; merged jsonb; result jsonb; previous maps_private.fieldops_operations;
 fid bigint; geom extensions.geometry; props jsonb; release_id uuid; published_version bigint; payload jsonb; k text;
begin
 if auth.uid() is null or not maps_private.fieldops_allowed(p_map) then raise exception 'FieldOps upload permission is required for this project' using errcode='42501';end if;
 if op is null or octet_length(coalesce(p_base::text,''))+octet_length(coalesce(p_feature::text,''))>2097152 then raise exception 'Edit exceeds the supported size';end if;
 p_base:=nullif(p_base,'null');p_feature:=nullif(p_feature,'null');
 payload:=jsonb_build_object('map',p_map,'layer',p_layer,'base',p_base,'feature',p_feature);
 -- Serialize retries, including retries after a lost success response.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||op::text,0));
 select * into previous from maps_private.fieldops_operations where user_id=auth.uid() and operation_id=op;
 if found then
  if previous.request<>payload then raise exception 'This edit identifier was already used for different changes';end if;
  return previous.response;
 end if;
 select * into lid from public.layers where id=p_layer and map_id=p_map for update;
 if not found or lid.kind<>'vector' or lid.metadata ? 'annotation' then raise exception 'Choose an editable vector layer';end if;
 perform 1 from public.maps where id=p_map for update;
 select id,version into release_id,published_version from public.map_releases where map_id=p_map order by version desc limit 1;
 if release_id is null or not exists(select 1 from public.map_releases r,jsonb_array_elements(r.manifest->'layers') l where r.id=release_id and l->>'id'=p_layer::text) then raise exception 'This layer is not in the published project';end if;
 if p_base is not null then
  fid:=(p_base->>'id')::bigint;
  if fid is null then raise exception 'The original feature identifier is required';end if;
  select jsonb_build_object('type','Feature','id',id,'geometry',extensions.st_asgeojson(geometry)::jsonb,'properties',properties)
   into current_value from public.features where id=fid and layer_id=p_layer for update;
 end if;
 if p_feature is not null then
  if p_feature->>'type' is distinct from 'Feature' or jsonb_typeof(p_feature->'properties') is distinct from 'object' or p_feature->'geometry' is null then raise exception 'Invalid feature';end if;
  -- File links and internal metadata cannot be forged from the mobile editor.
  for k in select jsonb_object_keys(coalesce(p_base->'properties','{}')) union select jsonb_object_keys(p_feature->'properties') loop
   if left(k,1)='_' and p_feature->'properties'->k is distinct from p_base->'properties'->k then raise exception 'Protected file links and metadata must remain unchanged';end if;
  end loop;
 end if;
 merged:=maps_private.merge_field_feature(p_base,p_feature,current_value);
 if merged->>'status'='conflict' then
  result:=merged||jsonb_build_object('release_id',release_id,'release_version',published_version);
 else
  p_feature:=nullif(merged->'feature','null');
  if p_feature is null then delete from public.features where id=fid and layer_id=p_layer;
  else
   geom:=extensions.st_setsrid(extensions.st_geomfromgeojson(p_feature->'geometry'),4326);props:=p_feature->'properties';
   if geom is null or not extensions.st_isvalid(geom) or extensions.st_isempty(geom) or extensions.st_xmin(extensions.box3d(geom)) < -180 or extensions.st_xmax(extensions.box3d(geom)) > 180 or extensions.st_ymin(extensions.box3d(geom)) < -90 or extensions.st_ymax(extensions.box3d(geom)) > 90 then raise exception 'Invalid or out-of-range geometry';end if;
   if p_base is null then insert into public.features(layer_id,geometry,properties) values(p_layer,geom,props) returning id into fid;
   else update public.features set geometry=geom,properties=props where id=fid and layer_id=p_layer;end if;
   p_feature:=jsonb_build_object('type','Feature','id',fid,'geometry',extensions.st_asgeojson(geom)::jsonb,'properties',props);
  end if;
  update public.layers set feature_count=(select count(*) from public.features where layer_id=p_layer),
   bounds=(select case when count(*)=0 then null else jsonb_build_array(extensions.st_xmin(extensions.st_extent(geometry)),extensions.st_ymin(extensions.st_extent(geometry)),extensions.st_xmax(extensions.st_extent(geometry)),extensions.st_ymax(extensions.st_extent(geometry))) end from public.features where layer_id=p_layer),
   metadata=metadata||jsonb_build_object('data_revision',gen_random_uuid()::text) where id=p_layer;
  result:=jsonb_build_object('status','uploaded','feature',p_feature,'release_id',release_id,'release_version',published_version);
  insert into public.workspace_events(workspace_id,actor_id,action,detail) select workspace_id,auth.uid(),'fieldops.edit_uploaded',jsonb_build_object('project_id',p_map,'layer_id',p_layer,'operation_id',op) from public.maps where id=p_map;
 end if;
 insert into maps_private.fieldops_operations(user_id,operation_id,map_id,request,response) values(auth.uid(),op,p_map,payload,result);
 return result;
end $$;
create function public.fieldops_capabilities() returns jsonb language sql security invoker set search_path='' as $$select maps_private.fieldops_capabilities();$$;
create function public.workspace_fieldops_access(p_workspace uuid,p_user uuid default null,p_enabled boolean default null) returns jsonb language sql security invoker set search_path='' as $$select maps_private.fieldops_permissions(p_workspace,p_user,p_enabled);$$;
create function public.fieldops_apply_edit(p_operation uuid,p_map uuid,p_layer uuid,p_base jsonb,p_feature jsonb) returns jsonb language sql security invoker set search_path='' as $$select maps_private.fieldops_apply_edit(p_operation,p_map,p_layer,p_base,p_feature);$$;
revoke all on function maps_private.fieldops_allowed(uuid),maps_private.fieldops_capabilities(),maps_private.fieldops_permissions(uuid,uuid,boolean),maps_private.merge_field_feature(jsonb,jsonb,jsonb),maps_private.fieldops_apply_edit(uuid,uuid,uuid,jsonb,jsonb),public.fieldops_capabilities(),public.workspace_fieldops_access(uuid,uuid,boolean),public.fieldops_apply_edit(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function maps_private.fieldops_capabilities(),maps_private.fieldops_permissions(uuid,uuid,boolean),maps_private.fieldops_apply_edit(uuid,uuid,uuid,jsonb,jsonb),public.fieldops_capabilities(),public.workspace_fieldops_access(uuid,uuid,boolean),public.fieldops_apply_edit(uuid,uuid,uuid,jsonb,jsonb) to authenticated;

-- Revision tokens are maintained by feature writes, never by stale style payloads.
create function maps_private.preserve_data_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if pg_trigger_depth()=1 then
  new.metadata:=(new.metadata-'data_revision')||case when old.metadata ? 'data_revision' then jsonb_build_object('data_revision',old.metadata->'data_revision') else '{}'::jsonb end;
 end if;return new;
end $$;
create trigger fieldops_preserve_data_revision before update on public.layers for each row execute function maps_private.preserve_data_revision();
create function maps_private.bump_data_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 update public.layers set metadata=metadata||jsonb_build_object('data_revision',gen_random_uuid()::text)
 where id in(select distinct layer_id from changed);return null;
end $$;
create trigger fieldops_revision_insert after insert on public.features referencing new table as changed for each statement execute function maps_private.bump_data_revision();
create trigger fieldops_revision_update after update on public.features referencing new table as changed for each statement execute function maps_private.bump_data_revision();
create trigger fieldops_revision_delete after delete on public.features referencing old table as changed for each statement execute function maps_private.bump_data_revision();
revoke all on function maps_private.preserve_data_revision(),maps_private.bump_data_revision() from public,anon,authenticated;

-- Legacy browsers must refresh before replacing data changed by another writer.
-- Existing feature IDs survive normal drawing edits and attachment updates.
create or replace function public.replace_vector(p_layer_id uuid,p_layer jsonb,p_features jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare current_layer public.layers; n integer; prepared jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in to save layers';end if;
 select * into current_layer from public.layers where id=p_layer_id and kind='vector' for update;
 if not found then raise exception 'Layer not found or access denied';end if;
 if coalesce(current_layer.metadata->>'data_revision','')<>coalesce(p_layer->>'expected_data_revision',p_layer->'metadata'->>'data_revision','') then
  raise exception 'Layer changed on another device. Your edits have not been uploaded. Refresh and review the changes before saving.' using errcode='40001';
 end if;
 n:=jsonb_array_length(p_features);if n is null or n=0 or n>20000 then raise exception 'Import between 1 and 20,000 features per layer';end if;
 update public.layers set name=p_layer->>'name',source_crs=p_layer->>'source_crs',vertical_datum=coalesce(p_layer->>'vertical_datum','Unknown'),metadata=coalesce(p_layer->'metadata','{}'),original_paths=coalesce(p_layer->'original_paths',original_paths),bounds=p_layer->'bounds',feature_count=n where id=p_layer_id;
 with parsed as (
  select f,ordinality,extensions.st_setsrid(extensions.st_geomfromgeojson(f->'geometry'),4326) g,
   coalesce(f->'properties','{}') props,row_number() over(partition by f->>'id' order by ordinality) duplicate
  from jsonb_array_elements(p_features) with ordinality as input(f,ordinality)
 ), checked as (
  select *,coalesce(p_layer->'metadata'->>'format','')='DXF' and extensions.geometrytype(g)='LINESTRING'
   and extensions.st_npoints(g)>=2 and extensions.st_length(g)=0
   and extensions.st_zmin(extensions.box3d(g)) is not distinct from extensions.st_zmax(extensions.box3d(g)) collapsed from parsed
 ), normalized as (
  select f,ordinality,duplicate,case when collapsed then extensions.st_startpoint(g) else g end g,
   case when collapsed then props||jsonb_build_object('_drillops_geometry_note','Collapsed DXF line preserved as a point') else props end props from checked
 ) select jsonb_agg(jsonb_build_object('id',existing.id,'geometry',encode(extensions.st_asewkb(g),'hex'),'properties',props,
  'valid',g is not null and extensions.st_isvalid(g) and not extensions.st_isempty(g)
   and extensions.st_xmin(extensions.box3d(g))>=-180 and extensions.st_xmax(extensions.box3d(g))<=180
   and extensions.st_ymin(extensions.box3d(g))>=-90 and extensions.st_ymax(extensions.box3d(g))<=90) order by ordinality)
 into prepared from normalized left join public.features existing on existing.layer_id=p_layer_id and duplicate=1
  and existing.id=case when coalesce(f->>'id','') ~ '^[0-9]{1,18}$' then (f->>'id')::bigint end;
 if exists(select 1 from jsonb_array_elements(prepared) f where f->>'valid' is distinct from 'true') then raise exception 'Invalid or out-of-range geometry. Review source coordinates.';end if;
 delete from public.features where layer_id=p_layer_id and id not in(select (f->>'id')::bigint from jsonb_array_elements(prepared) f where f->>'id' is not null);
 update public.features target set geometry=extensions.st_geomfromewkb(decode(f->>'geometry','hex')),properties=f->'properties'
 from jsonb_array_elements(prepared) f where target.id=(f->>'id')::bigint and target.layer_id=p_layer_id;
 insert into public.features(layer_id,geometry,properties) select p_layer_id,extensions.st_geomfromewkb(decode(f->>'geometry','hex')),f->'properties'
 from jsonb_array_elements(prepared) f where f->>'id' is null;
 return p_layer_id;
end $$;

-- Web drawing/table saves use the same three-way merge as FieldOps. Any conflict
-- aborts the complete layer save, leaving the browser's unsaved work untouched.
create function public.merge_vector_edits(p_layer_id uuid,p_layer jsonb,p_base_layer jsonb,p_base_features jsonb,p_features jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_layer public.layers; m jsonb; features jsonb; layer_merge jsonb; current_payload jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 select * into current_layer from public.layers where id=p_layer_id and kind='vector' for update;
 if not found then raise exception 'Layer unavailable or access denied' using errcode='42501';end if;
 if jsonb_typeof(p_base_features)<>'array' or jsonb_typeof(p_features)<>'array' then raise exception 'Original feature data is required';end if;
 if jsonb_array_length(p_base_features)>20000 or jsonb_array_length(p_features)>20000 then raise exception 'A layer supports up to 20,000 features';end if;
 features:=public.layer_geojson(p_layer_id)->'features';
 if exists(select 1 from jsonb_array_elements(p_base_features) b where b->>'id' is null)
 or (select count(*)<>count(distinct b->>'id') from jsonb_array_elements(p_base_features) b)
 or (select count(*)<>count(distinct l->>'id') from jsonb_array_elements(p_features) l where l->>'id' is not null) then
  raise exception 'Refresh the layer before editing so each feature has a unique identifier';
 end if;
 with base as(select value b,value->>'id' id from jsonb_array_elements(p_base_features)),
 local_data as(select value l,value->>'id' id from jsonb_array_elements(p_features)),
 remote_data as(select value r,value->>'id' id from jsonb_array_elements(features)),
 changes as(select coalesce(base.id,local_data.id,remote_data.id) id,
  maps_private.merge_field_feature(b,l,r) result from base full join local_data using(id) full join remote_data using(id))
 select coalesce(jsonb_agg(result->'feature' order by id) filter(where nullif(result->'feature','null') is not null),'[]'),
  (jsonb_agg(jsonb_build_object('id',id,'fields',result->'fields')) filter(where result->>'status'='conflict'))->0
 into features,m from changes;
 if m is not null then raise exception 'Feature % changed on another device (%). Your edits remain unsaved; review the FieldMaps version before retrying.',m->>'id',m->'fields' using errcode='40001';end if;
 current_payload:=jsonb_build_object('name',current_layer.name,'source_crs',current_layer.source_crs,'vertical_datum',current_layer.vertical_datum,'metadata',current_layer.metadata-'data_revision','original_paths',current_layer.original_paths);
 p_base_layer:=p_base_layer-'bounds'-'expected_data_revision';p_layer:=p_layer-'bounds'-'expected_data_revision';
 p_base_layer:=jsonb_set(p_base_layer,'{metadata}',coalesce(p_base_layer->'metadata','{}')-'data_revision');
 p_layer:=jsonb_set(p_layer,'{metadata}',coalesce(p_layer->'metadata','{}')-'data_revision');
 layer_merge:=maps_private.merge_field_feature(jsonb_build_object('properties',p_base_layer),jsonb_build_object('properties',p_layer),jsonb_build_object('properties',current_payload));
 if layer_merge->>'status'='conflict' then raise exception 'Layer settings changed on another device. Your edits remain unsaved; review the changes before saving.' using errcode='40001';end if;
 p_layer:=layer_merge->'feature'->'properties';
 p_layer:=p_layer||jsonb_build_object('expected_data_revision',coalesce(current_layer.metadata->>'data_revision',''));
 perform public.replace_vector(p_layer_id,p_layer,features);
 update public.layers set bounds=(select case when count(*)=0 then null else jsonb_build_array(extensions.st_xmin(extensions.st_extent(geometry)),extensions.st_ymin(extensions.st_extent(geometry)),extensions.st_xmax(extensions.st_extent(geometry)),extensions.st_ymax(extensions.st_extent(geometry))) end from public.features where layer_id=p_layer_id) where id=p_layer_id;
 select * into current_layer from public.layers where id=p_layer_id;
 return jsonb_build_object('layer',to_jsonb(current_layer),'fc',public.layer_geojson(p_layer_id));
end $$;
revoke all on function public.merge_vector_edits(uuid,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function maps_private.merge_field_feature(jsonb,jsonb,jsonb),public.merge_vector_edits(uuid,jsonb,jsonb,jsonb,jsonb) to authenticated;

create or replace function public.replace_vector_versioned(p_layer_id uuid,p_layer jsonb,p_features jsonb,p_expected text default '',p_restore uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_layer public.layers; previous public.layer_data_versions; token text:=gen_random_uuid()::text; backup_id uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first';end if;
 select * into current_layer from public.layers where id=p_layer_id and kind='vector' for update;
 if not found then raise exception 'Layer unavailable or access denied';end if;
 if coalesce(current_layer.metadata->>'data_revision','')<>coalesce(p_expected,'') then raise exception 'Layer data changed. Refresh and review the replacement again.';end if;
 if p_restore is not null then
  select * into previous from public.layer_data_versions where id=p_restore and layer_id=p_layer_id;
  if not found then raise exception 'Previous version is no longer available';end if;
  p_layer:=previous.layer;p_features:=previous.features;
 end if;
 insert into public.layer_data_versions(layer_id,layer,features)
 select p_layer_id,to_jsonb(current_layer),coalesce(jsonb_agg(jsonb_build_object('type','Feature','geometry',extensions.st_asgeojson(f.geometry)::jsonb,'properties',f.properties) order by f.id),'[]')
 from public.features f where f.layer_id=p_layer_id returning id into backup_id;
 -- Keep current presentation even when rolling data back.
 p_layer:=p_layer||jsonb_build_object('name',current_layer.name,'metadata',coalesce(p_layer->'metadata','{}')||jsonb_build_object('style',current_layer.metadata->'style','data_revision',token));
 perform public.replace_vector(p_layer_id,p_layer||jsonb_build_object('expected_data_revision',p_expected),p_features);
 select metadata->>'data_revision' into token from public.layers where id=p_layer_id;
 p_layer:=p_layer||jsonb_build_object('metadata',(select metadata from public.layers where id=p_layer_id));
 p_features:=public.layer_geojson(p_layer_id)->'features';
 delete from public.layer_data_versions where layer_id=p_layer_id and id not in(select id from public.layer_data_versions where layer_id=p_layer_id order by created_at desc,id desc limit 3);
 return jsonb_build_object('version',backup_id,'data_revision',token,'layer',p_layer,'features',p_features);
end $$;
