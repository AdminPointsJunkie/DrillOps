# Photo locations, search and compact toolbar

Photo locations start on and can be hidden in Layers. Circular previews group photos as the map zooms out; clicking opens a gallery. Published attachments follow existing layer visibility and feature filters. New personal pins and 2048-pixel JPEG copies are stored in IndexedDB by account/workspace/project, not uploaded. Clearing browser/site data removes these copies. Original selected files are unchanged. Linked-cloud sync is not implemented. Existing feature attachments now require an explicit Upload selected files to DrillOps click.

Search supports places (user-submitted Photon requests with a small in-memory cache, timeout and throttling), decimal latitude/longitude and explicit MGA zone/GDA94/GDA2020 via the existing GDAL engine. Photon is a best-effort public geocoder; large deployments should configure their own instance. Coordinate and project-feature searches remain available when place search fails. Only the submitted place query is sent; no project or photo information is sent to Photon.

Top bar retains search, photos, drawing and adding data; secondary actions are grouped under Tools. The shortcut guide (?) lists Mac and Windows keys, including save (Command/Control S), sync (Command/Control Shift S), search (Command/Control F), photos (P), layers (L), location (G), fit (F), filter (X), compare (C) and satellite (B). Text fields and open dialogs retain normal keyboard behaviour.

Validation: Vite production build; coordinate validation, photo grouping, IndexedDB persistence and scope isolation, default-on/hide behaviour, explicit-upload gating, toolbar action preservation and shortcut-guide tests. Interactive browser/device visual QA remains outstanding.
