-- Existing saved maps become projects without moving any layers or changing ownership.
alter table public.maps
 add column if not exists default_crs text check(default_crs is null or default_crs ~ '^EPSG:[0-9]+$'),
 add column if not exists default_crs_label text;
