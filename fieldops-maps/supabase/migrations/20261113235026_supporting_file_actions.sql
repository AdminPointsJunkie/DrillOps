-- Group headings travel with each file into the existing published snapshot.
create or replace function public.maps_supporting_file(p_map uuid,p_action text,p_file jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.maps;items jsonb;heading text;target jsonb;destination bigint;filename text;begin
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
 elsif p_action='rename' then
  filename:=trim(p_file->>'name');
  if filename is null or length(filename)<1 or length(filename)>240 or filename ~ '[/\\]' then raise exception 'Enter a file name of 1–240 characters without slashes';end if;
  if not exists(select 1 from jsonb_array_elements(m.supporting_files) f where f->>'path'=p_file->>'path') then raise exception 'File unavailable';end if;
  select jsonb_agg(case when f->>'path'=p_file->>'path' then f||jsonb_build_object('name',filename) else f end order by ordinal) into items from jsonb_array_elements(m.supporting_files) with ordinality as entry(f,ordinal);
 elsif p_action='move' then
  select f into target from jsonb_array_elements(m.supporting_files) f where f->>'path'=p_file->>'path';
  if target is null then raise exception 'File unavailable';end if;
  if p_file->>'before'=p_file->>'path' then return m.supporting_files;end if;
  if coalesce(p_file->>'before','')<>'' then
   select ordinal into destination from jsonb_array_elements(m.supporting_files) with ordinality as entry(f,ordinal) where f->>'path'=p_file->>'before';
   if destination is null then raise exception 'Destination file unavailable';end if;
  else destination:=jsonb_array_length(m.supporting_files)+1;end if;
  select jsonb_agg(case when f->>'path'=p_file->>'path' then f||jsonb_build_object('group',heading) else f end order by case when f->>'path'=p_file->>'path' then destination*2-1 else ordinal*2 end) into items from jsonb_array_elements(m.supporting_files) with ordinality as entry(f,ordinal);
 elsif p_action='remove_group' then
  if coalesce(p_file->>'previous','')='' then raise exception 'Choose a named group';end if;
  select coalesce(jsonb_agg(f order by ordinal),'[]'::jsonb) into items from jsonb_array_elements(m.supporting_files) with ordinality as entry(f,ordinal) where coalesce(f->>'group','')<>p_file->>'previous';
 else raise exception 'Unknown supporting-file action';end if;
 update public.maps set supporting_files=items where id=p_map;
 return items;
end $$;
revoke all on function public.maps_supporting_file(uuid,text,jsonb) from public,anon;
grant execute on function public.maps_supporting_file(uuid,text,jsonb) to authenticated;
