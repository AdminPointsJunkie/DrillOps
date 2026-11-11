-- Group headings travel with each file into the existing published snapshot.
create or replace function public.maps_supporting_file(p_map uuid,p_action text,p_file jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.maps;items jsonb;heading text;begin
 if auth.uid() is null or not maps_private.ws_project(p_map) then raise exception 'Project editing access required' using errcode='42501';end if;
 select * into m from public.maps where id=p_map for update;
 if not found then raise exception 'Project unavailable';end if;
 heading:=trim(coalesce(p_file->>'group',''));
 if length(heading)>80 or (p_file ? 'group' and jsonb_typeof(p_file->'group')<>'string') then raise exception 'Keep headings to 80 characters or fewer';end if;
 if p_action='add' then
  if heading<>'' then p_file:=p_file||jsonb_build_object('group',heading);end if;
  -- Retrying an uncertain response is safe and never duplicates an attachment.
  if exists(select 1 from jsonb_array_elements(m.supporting_files) f where f->>'path'=p_file->>'path') then return m.supporting_files;end if;
  items:=m.supporting_files||jsonb_build_array(p_file);
 elsif p_action='remove' then
  select coalesce(jsonb_agg(f),'[]'::jsonb) into items from jsonb_array_elements(m.supporting_files) f where f->>'path' is distinct from p_file->>'path';
 elsif p_action in ('group','rename_group') then
  if p_action='group' and not exists(select 1 from jsonb_array_elements(m.supporting_files) f where f->>'path'=p_file->>'path') then raise exception 'File unavailable';end if;
  select coalesce(jsonb_agg(case when (p_action='group' and f->>'path'=p_file->>'path') or (p_action='rename_group' and coalesce(f->>'group','')=p_file->>'previous') then f||jsonb_build_object('group',heading) else f end order by ordinal),'[]'::jsonb)
  into items from jsonb_array_elements(m.supporting_files) with ordinality as entry(f,ordinal);
 else raise exception 'Unknown supporting-file action';end if;
 update public.maps set supporting_files=items where id=p_map;
 return items;
end $$;
revoke all on function public.maps_supporting_file(uuid,text,jsonb) from public,anon;
grant execute on function public.maps_supporting_file(uuid,text,jsonb) to authenticated;
