-- Annotation writes use the live account role, including when JWT claims are stale.
create function maps_private.guard_annotation_write() returns trigger
language plpgsql security invoker set search_path='' as $$
declare protected boolean := false;
begin
 if tg_table_name='layers' then
  if tg_op<>'INSERT' then protected := coalesce(old.metadata ? 'annotation',false); end if;
  if tg_op<>'DELETE' then protected := protected or coalesce(new.metadata ? 'annotation',false); end if;
 else
  if tg_op<>'INSERT' then select coalesce(bool_or(metadata ? 'annotation'),false) into protected from public.layers where id=old.layer_id; end if;
  if tg_op<>'DELETE' then protected := protected or exists(select 1 from public.layers where id=new.layer_id and metadata ? 'annotation'); end if;
 end if;
 if protected and not public.maps_admin() then raise exception 'Only admins can create, edit or delete annotations' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function maps_private.guard_annotation_write() from public,anon,authenticated;
create trigger annotation_layer_guard before insert or update or delete on public.layers for each row execute function maps_private.guard_annotation_write();
create trigger annotation_feature_guard before insert or update or delete on public.features for each row execute function maps_private.guard_annotation_write();

-- RLS is evaluated as the caller. Only assigned, published projects are listed for operators.
create function public.maps_published_projects() returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(project || jsonb_build_object('release_id',id,'published_version',version,'last_synced_at',published_at) order by project->>'name'),'[]'::jsonb)
 from (select distinct on(map_id) id,map_id,version,published_at,manifest->'project' project from public.map_releases order by map_id,version desc) latest;
$$;
revoke all on function public.maps_published_projects() from public,anon;
grant execute on function public.maps_published_projects() to authenticated;

create or replace function public.sync_map(p_map_id uuid,p_release_id uuid,p_expected_revision bigint,p_rasters jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.maps; r public.map_releases; l public.layers; items jsonb:='[]'; item jsonb; target text; paths text[]:='{}'; v bigint;
begin
 if auth.uid() is null then raise exception 'Sign in before syncing'; end if;
 select * into m from public.maps where id=p_map_id for update;
 if not found then raise exception 'Project not found or access denied'; end if;
 if m.draft_revision<>p_expected_revision then raise exception 'Project changed while syncing. Try SYNC again.'; end if;
 select * into r from public.map_releases where map_id=p_map_id order by version desc limit 1;
 if found and r.source_revision=m.draft_revision then
  return jsonb_build_object('id',r.id,'version',r.version,'published_at',r.published_at,'source_revision',r.source_revision);
 end if;
 v:=coalesce(r.version,0)+1;
 for l in select * from public.layers where map_id=p_map_id and id::text in (
  select case when jsonb_typeof(n)='string' then n#>>'{}' else child#>>'{}' end
  from jsonb_array_elements(m.layer_layout) n
  left join lateral jsonb_array_elements(case when jsonb_typeof(n)='object' then coalesce(n->'children','[]') else '[]'::jsonb end) child on true
 ) order by created_at,id loop
  item:=jsonb_build_object('id',l.id,'name',l.name,'kind',l.kind,'source_crs',l.source_crs,'vertical_datum',l.vertical_datum,
   'color',l.color,'opacity',l.opacity,'visible',l.visible,'bounds',l.bounds,
   'metadata',jsonb_build_object('annotation',l.metadata->'annotation','style',l.metadata->'style','xyz',l.metadata->'xyz','xyzView',l.metadata->'xyzView','crs_label',l.metadata->'crs_label'));
  if l.kind='vector' then item:=item||jsonb_build_object('fc',public.layer_geojson(l.id));
  elsif not (l.metadata ? 'xyz') then
   target:=p_rasters->>l.id::text;
   if target is null or target<>auth.uid()::text||'/sync/'||p_release_id::text||'/'||l.id::text||'.png'
   or not exists(select 1 from storage.objects where bucket_id='gis-files' and name=target)
   then raise exception 'A raster snapshot is missing. Try SYNC again.'; end if;
   paths:=array_append(paths,target);item:=item||jsonb_build_object('raster_path',target);
  end if;
  items:=items||jsonb_build_array(item);
 end loop;
 insert into public.map_releases(id,map_id,version,source_revision,manifest,raster_paths)
 values(p_release_id,p_map_id,v,m.draft_revision,jsonb_build_object('schema_version',1,'project',jsonb_build_object('id',m.id,'name',m.name,'default_crs',m.default_crs,'default_crs_label',m.default_crs_label),'layer_layout',m.layer_layout,'layers',items),paths)
 returning * into r;
 update public.maps set last_synced_revision=m.draft_revision,last_synced_at=r.published_at where id=p_map_id;
 return jsonb_build_object('id',r.id,'version',r.version,'published_at',r.published_at,'source_revision',r.source_revision);
end $$;
revoke all on function public.sync_map(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.sync_map(uuid,uuid,bigint,jsonb) to authenticated;
