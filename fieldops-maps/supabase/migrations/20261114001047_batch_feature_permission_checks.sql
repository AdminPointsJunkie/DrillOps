-- Check the same editable-layer set once per statement rather than once per row.
alter policy features_access on public.features
 using (layer_id in (select id from public.layers))
 with check (layer_id in (select id from public.layers));

-- Annotation authorization is a per-layer rule. Transition tables let us enforce
-- it once for each affected layer, while an exception still rolls back all rows.
create or replace function maps_private.guard_annotation_feature_batch()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists (
  select 1 from public.layers l join public.maps m on m.id=l.map_id
  where l.id in (select distinct layer_id from changed)
   and l.metadata ? 'annotation' and not maps_private.ws_manage(m.workspace_id)
 ) then raise exception 'Only workspace admins can change annotations' using errcode='42501';end if;
 return null;
end $$;
revoke all on function maps_private.guard_annotation_feature_batch() from public,anon,authenticated;
drop trigger annotation_feature_guard on public.features;
create trigger annotation_feature_insert_guard after insert on public.features referencing new table as changed for each statement execute function maps_private.guard_annotation_feature_batch();
create trigger annotation_feature_update_guard after update on public.features referencing new table as changed for each statement execute function maps_private.guard_annotation_feature_batch();
create trigger annotation_feature_delete_guard after delete on public.features referencing old table as changed for each statement execute function maps_private.guard_annotation_feature_batch();
