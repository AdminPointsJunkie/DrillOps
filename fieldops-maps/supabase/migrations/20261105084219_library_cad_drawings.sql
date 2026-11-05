-- Keep company drawings in the existing private library with the same access policies.
update storage.buckets set allowed_mime_types=array_append(allowed_mime_types,'application/acad')
where id='layer-library' and not ('application/acad'=any(allowed_mime_types));
