# DrillOps Maps

## Data efficiency and local imagery

GeoTIFF/COG and VRT raster overlays stay on the device (the current session in cloud mode), with no original or preview cloud upload. Original import archives also stay local; their parsed vectors can still be shared. Location attachments reject TIFFs and archives. JPEG photo attachments are optimised with on-demand thumbnails. The published web viewer caches unchanged exact layers, checks live access on every open, and defers hidden raster files. Publishing retains the latest three releases and reuses unchanged raster snapshots. Existing files are not purged.

See [the native app checklist and API contract](APP-DATA-EFFICIENCY-CHECKLIST.md) for changed-layer sync, on-demand vectors, optional display simplification, attribute selection and device-cache requirements. The legacy native download format remains supported until the app adopts these APIs.


## Location attachments

Select a saved point, line or area on the map (or through Search/Table) and use **Attachments → Attach files**. For a new location, draw a point and save the layer first. Editors can upload multiple files, download them or remove their link from the location. Limits are 50 MB per file, 20 files and 300 MB per selection. Operators can download attachments in their assigned published projects after **SYNC**.

Attachment descriptors are stored with feature properties in the reserved `_fieldmaps_files` field; it is hidden from ordinary attribute controls. Storage paths are also retained in `layers.original_paths` for workspace access and usage accounting. Browser-to-cloud transfer copies the files and rewrites references. Files are downloaded through authenticated private storage as downloads, without rendering uploaded HTML in the application.

SYNC validates each referenced file and records it in the release's existing `raster_paths` storage-access list (which now includes attachments). Published files become immutable under the existing storage policies. Removing an attachment unlinks it from the draft; retained bytes still count toward stored usage and keep previous releases readable. Failed uploads/saves may leave unreferenced bytes; do not delete them automatically after an uncertain response. The migration is `20261029035110_location_attachments.sql`. Regression coverage includes `tests/location-files.test.mjs` and the transaction-only `tests/location-files-access.sql` using the workspace fixture setup.

## People and access

New invitations open `/maps/setup.html` directly with the token hash in the URL fragment. The password form appears immediately and redeems the invitation only when submitted, avoiding map startup dependencies and passive email-scanner consumption. Legacy invite/recovery callbacks are forwarded to the same dedicated page before the map client starts. Invited accounts without a password also automatically open Create your password after ordinary sign-in, including after refresh or email-link sign-in. Closing it leaves Finish account setup available. Expired/used links show an actionable dialog; admins can Resend invitation on unverified accounts without changing their roles or assignments. The hosted invite template is tracked at `supabase/templates/invite.html` (subject: Create your DrillOps Maps password). Existing expired emails require a new invitation.

Admins open **People & access** in the header to invite people, edit names, assign Admin / Editor / Operator roles, suspend access and select operator projects. Editors manage their own projects; admins manage all projects. New signups and invitations are pending with no GIS access until approved. Invitations use the configured Supabase email provider and its limits. No emails are sent automatically during deployment.

Permissions read current server-managed roles, so revoked privileges do not survive in stale JWTs. Suspended accounts may still authenticate but cannot access GIS data. Account changes are atomic, and admins cannot alter their own account here. The invitation Edge Function validates the signed-in user and current admin status before using its server-only service key; gateway JWT verification is disabled because the function performs authentication itself.


## SYNC and operators

Drafts autosave. The sidebar shows Saving, Saved, Unsaved changes or Save failed, with Retry for retained style/layout failures and unsaved imports. SYNC saves pending changes and publishes a versioned operator release. Later edits remain private until the next SYNC. Last-sync time and an unsynced-change indicator distinguish saving from publication.

Publication checks the draft revision; retrying without intervening changes returns the same release. Raster previews are copied to separate release paths so draft image replacement does not affect operators. Interrupted copies may leave unreferenced files; future cleanup must retain every path referenced by a release.

The future iPhone app reads `map_releases` by map_id, descending version, using the latest manifest. It includes project CRS/name, group/order defaults, styles/visibility, vector GeoJSON and private preview paths. Operators with server-managed `app_metadata.maps_role=operator` read only projects assigned through `map_operators`. They may pan, zoom, toggle layers and personalise their view locally, but cannot edit drafts, upload files or publish. Original source files are not exposed. Owners/main admins manage assignments; none are created implicitly.

The native iPhone interface and notifications remain separate work. SYNC prepares the database/API contract and does not claim delivery to a device. Transaction-only tests in `tests/operator-sync.sql` verify snapshot isolation, retries, revision conflicts and access controls. Security advisor reports the existing Auth warning [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## KML and KMZ

Upload KML or zipped KMZ directly. KMZ uses GDAL's ZIP virtual filesystem. KML coordinates default to embedded WGS 84 rather than the project's projected default. Supported: points, lines, polygons, elevations, names and descriptions. Layer names start from filenames. Google Earth icons/styles, image overlays, tours and network links are not imported; apply styling after import. Custom extension attributes depend on the bundled GDAL KML driver. Empty/overlay-only documents report no supported geometry. Existing cloud file and feature limits apply.

Unadvertised GIS workspace for the DrillOps / FieldOps ecosystem.

Production route: https://www.drillops.com.au/maps/
Supabase project: `dzthwvxrltkltfvubvld` (Shared Map, Sydney).

## Cloud workspace

`LOCAL_TESTING=false` uses Supabase Auth, PostgreSQL/PostGIS and the private `gis-files` bucket. Sign in with email/password or an emailed sign-in link. New accounts must verify their email. Owners access their own projects; a main administrator with server-managed `app_metadata.maps_role=admin` can manage all GIS projects and files. User-editable metadata never grants access. No admin credential is shipped to the browser.

The **Import browser projects** button appears after sign-in. It copies a selected IndexedDB project, original files, vectors, raster previews, XYZ links, styles, labels and group/order settings into that account. Local data is retained. Stable destination IDs allow interrupted copies to resume without duplicate layers. Completed copies do not overwrite subsequent cloud edits. Run this from the same browser/profile that holds the testing data.

The current free-plan bucket allows **50 MB per file**. Transfers preflight every source and preview before creating a destination project. A project containing a larger file remains local and displays an error; there is no automatic plan upgrade or server raster processing; original archives and GeoTIFFs remain local.

Cloud layer edits use an atomic PostGIS replacement function; validation errors roll back to the previous geometry. Layout/group settings now live on `maps.layer_layout`. Apply schema.sql plus every migration for a new installation. The cloud workspace migration was applied remotely as `20261027212459`.

Google was deferred because billing/API credentials are not being enabled. Esri imagery and OpenStreetMap remain configured.

## Run and build

Use Node 20.19+ (tested with the installed Node runtime).

```sh
npm ci
node scripts/prepare-engine.mjs
npm run dev
npm test
node tests/engine-formats.cjs
npm run build
```

The development URL is `/maps/`. Copy `dist/` into the DrillOps repository's `docs/maps/` to publish with its existing GitHub Pages workflow. Keep this route out of navigation and sitemaps until launch. `index.html` carries `noindex,nofollow`; this is an unlisted public application, not a private URL. Saved data requires Supabase authentication and owner-scoped row-level policies.

## Architecture

Saved maps are presented as projects. Each project owns its existing layers and can have an optional EPSG default CRS, editable through Project settings. The default prepopulates import review (including files with embedded CRS); the user can override it or select Use file CRS instead. Existing projects without a default keep using embedded CRS where available. Changing a default does not reproject existing layers.

The View selector offers Street (OpenStreetMap), Satellite (Esri World Imagery), and Hybrid (imagery plus Esri transportation and place labels). Basemap changes preserve the map extent and imported layers.

Satellite tiles request `blankTile=false`; where detailed coverage is missing, a cropped parent tile is enlarged instead of showing Esri's placeholder. Imagery can be magnified to zoom 22 without claiming additional resolution. Imported layer names default to the filename stem, with internal names appended only for multi-layer datasets.

Click the **style icon** on a vector layer: points offer symbols and size; lines offer colour, width and dashes; shapes offer fill colour/opacity and outline styling. Mixed layers expose all relevant controls. Overall opacity applies to fills as well as outlines. Styles are saved in the layer metadata and restored with the project. Raster layers have an opacity control. The eye toggles visibility; the target button reveals a hidden layer and fits the map to its extent.

- Browser: Vite, Leaflet, GDAL 3.8.4 / PROJ 9.3.1 in a Web Worker, Papa Parse.
- PostGIS: `public.maps`, `public.layers`, `public.features`, a GiST geometry index, and an atomic vector-import function.
- Supabase Storage: private `gis-files` bucket; paths scoped to the signed-in user.
- Supabase Auth: email/password. Configure production email delivery and redirect URLs in the Supabase dashboard before opening registration broadly. The browser uses only a publishable key. No service-role secret is present.
- CRS catalogue: non-deprecated geographic 2D/projected EPSG records exported from installed PROJ database; exact EPSG numbers and name fragments are searchable. Runtime conversion validates the selected definition with the bundled PROJ engine.

Preview stays in browser memory. Import attempts to save to the selected project, using browser storage in testing mode or Supabase in cloud mode. Originals, source CRS, chosen epoch/pipeline/control points, height-reference label and display geometry are retained on save. Cross-device access requires cloud mode and a signed-in account.

## Tested

- Browser batch upload, CSV column selection, EPSG 7856 name/number lookup, MGA56-to-WGS84 reprojection, raster preview, GeoJSON review.
- GDAL engine: zipped shapefile, DXF, GeoJSON, GeoTIFF warp/PNG output.
- Coordinate parsing: decimal degrees, DMS hemispheres, malformed coordinates and out-of-range bounds.
- Database: transaction-only vector insertion, owner access and cross-account denial. Test users/data were rolled back. Supabase security advisor was clear.

## Current limits

- 50 MB per file in cloud mode (GeoTIFFs up to 250 MB are local-only), 300 MB per batch, 20,000 features per vector layer.
- Raster previews are reduced to 1,536 pixels on the longer source dimension. Permitted non-archive originals are retained; GeoTIFFs and their previews stay local. This is not a tiled full-resolution raster service.
- Browser memory and the bundled driver determine format support. DWG is not promised. GeoTIFF/world-file georeferencing is required for raster positioning.
- Source coordinate systems are never inferred from coordinate magnitudes. CSV requires confirmation; missing CRS requires a choice.
- PROJ requests best available operations without downloading grids. Missing resources may cause import to fail. No survey accuracy is certified. Height reference is recorded, not vertically transformed. Expert pipelines and first-order local-grid control points are vector-only.
- Online access only. No offline downloads, cross-account sharing, native FieldOps sign-on integration, automatic refresh or version history. Raster jobs run while the tab stays open.
- Remove hides a saved layer from the current view; Refresh restores it. No cloud deletion UI is exposed.

## Engine packaging

`scripts/prepare-engine.mjs` stores the WASM engine as a gzip-compressed `.bin` below per-file hosting limits. The browser decompresses it into a Blob. A narrowly checked patch permits Blob URLs in the upstream GDAL worker path resolver. Other GDAL behavior is unchanged. See `public/GDAL-LICENSE.txt` and https://github.com/bugra9/gdal3.js for upstream source and component notices.

## Database connections

Dashboard: https://supabase.com/dashboard/project/dzthwvxrltkltfvubvld
API: https://dzthwvxrltkltfvubvld.supabase.co
Direct PostgreSQL host: `db.dzthwvxrltkltfvubvld.supabase.co`, port 5432, database `postgres`, username `postgres`, SSL required. Passwords and pooler connection details must be obtained from the dashboard Connect panel. Do not put database passwords or service-role keys in client code.

Raster processing runs in the GDAL worker with a non-modal job card after review. Status shows conversion, preview encoding and file-save stages, rather than an estimated percentage. Keep the tab open; jobs do not survive closing it. Imports are serialized, and project switching waits until completion to keep the destination stable. Failed conversion remains in the review queue; failed saving retains the layer with a Save retry. Very large decoded rasters can still exceed browser memory; this is not a server tiling service.

## XYZ tile links

Choose **Add XYZ tile link** beneath the file drop area. Supply a name and HTTPS Web Mercator image-tile template containing `{z}`, `{x}` and `{y}` (in the provider’s order). `{s}` and `{r}` are optional. Set provider attribution and native zoom limits. Links are raster layer metadata, not uploaded raster files; they save with the project in the cloud workspace. Each has eye, target, opacity and Edit tiles controls. The target restores the view captured when the link was added; XYZ URLs do not provide coverage bounds. Only browser-safe URL keys are supported, not private credentials or custom authentication headers. WMS, vector PBF tiles and TileJSON documents are not XYZ image templates.

## Layer organisation and point information

The compact sidebar is 285 px wide; the header is 58 px high. Drag the six-dot handles to order layers or whole groups. The first layer in the list draws on top for points, lines, polygons, raster previews and XYZ tiles. Each imported layer uses its own Leaflet pane so ordering is consistent across geometry types. SVG path rendering avoids blank canvas surfaces intercepting clicks on lower layers.

Use **+ Group** to create a group. Drop layers on its heading or drop area, or select a group under **Organise**. Groups collapse, rename and hide/show without changing each child's visibility setting. **Ungroup** preserves children. Up/down controls provide a keyboard/touch alternative. Project arrangements persist in the database, including groups, collapsed state, visibility and draw order. Styles and labels remain in each layer's metadata.

Select a CSV field under **Style layer → Point labels**. Up to 500 visible labels per layer are rendered; zoom in for dense datasets. The right-hand **i** tool opens an attribute panel for clicked points, lines and polygons. Attribute text is escaped through DOM text nodes.

CSV previews no longer prebuild every feature's popup DOM. Confirming a preview reuses its conversion only when all CRS, coordinate-column and advanced settings match. EPSG:4326 CSV points bypass GDAL unless advanced transformations are requested; projected CSVs still use GDAL. The 20,000-point limit is checked before conversion. Browser QA covered preview/import/save of 5,000 CSV points.

### Styling CSV points by value

Open the layer style icon, then **Style by value**. Categorized classes use unique column values (up to 100); graduated classes split numeric values into 2–12 equal ranges. Click **Classify**, edit each class colour/symbol/size, then **Apply style**. Missing or unmatched values use the base layer style.

Formula mode independently controls colour, symbol and size. Use `[Column]` references, quoted text and `if`, `min`, `max`, `abs`, `round`, `sqrt`, or `coalesce`. For example: `if([Status] = 'Complete', '#147d72', '#ce6359')`, `if([Depth] > 100, 'triangle', 'circle')`, and `min(30, 6 + [Depth] / 10)`. This is a restricted expression language, not JavaScript or full QGIS syntax. Invalid result values fall back to the base style; sizes clamp to 4–48px. Preview validates syntax and reports feature coverage before applying.

Rules persist in `metadata.style.rules`, including in SYNC manifests. Clients displaying releases must evaluate those rules to reproduce the styling. Select **Single style** to remove the rules. Source CSV attributes are unchanged.

### Map exploration and annotations

The right-hand toolbar opens the attribute table (▦), feature search (⌕), filters (⏷), measurements (↔), and admin annotations (✎).

- The table sorts columns, searches values, pages through 100 rows at a time, and optionally limits rows to the current extent. Selecting a row highlights and zooms to the feature; selecting a map feature selects its table row. Search and filter conditions affect both table and map; source attributes stay unchanged.
- Expand a layer's Legend to toggle classification categories/ranges. Counts respect active filters. Search finds matching attributes in visible, filtered layers.
- View changes are personal until an editor chooses **Save default**. Defaults persist in metadata.style.view and travel in SYNC. **Reset** restores those saved defaults. Operators cannot save defaults.
- Table **Fields** configures popup title, field order, friendly display labels and hidden fields. This affects presentation, not data permissions: underlying published feature attributes remain readable.
- Measurements are temporary, approximate horizontal distance/area in metres, kilometres and hectares; terrain, RL and survey-grade grid corrections are not included.
- Admins can draw notes, access arrows and exclusion polygons on the map. Click positions, use Undo point, then Save annotation. The layer cog edits its name/text/colour or deletes it. Annotations save as vector layers; original uploads are untouched. Changes reach operators only after SYNC.
- Database triggers protect annotation metadata and geometry using the live account role. Published manifests now retain annotation metadata. Operator accounts load assigned published releases through the browser, never draft layers. Viewer filters, legend toggles, layer order and visibility do not write to the database.

Verification: exploration unit/UI tests, existing regression suite, and transaction-only exploration-access.sql against Postgres cover filters, styles, linked selection, geography measurements, saved annotations, live-role restrictions and assigned release access. Security advisor retains the pre-existing leaked-password-protection warning; see https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection .

## DXF geometry sections

New DXF imports create a drawing group with separate Points, Lines and Shapes layers, omitting empty sections. Each has independent geometry editing, visibility, opacity and symbology: point symbols/sizes/labels, line colours/widths/dashes, and shape outline/fill settings. Original CAD attributes and heights are retained. Mixed geometry collections are expanded into their constituent features. Non-DXF imports and existing saved mixed layers are unchanged.

Split sections share one uploaded original DXF, while saving their feature data independently. A failed section remains available for Save/Retry without deleting the source referenced by successful sections. Rebuilding source settings for a section filters the original back to that section only. Geometry editing keeps new features within the section’s geometry type. SYNC publishes the independent layers and their styles through the existing release mechanism.

## Map right-click actions

Right-click a location to copy coordinates, add a saved comment, start distance/area measurement there, compare vector/raster/XYZ layers with a draggable divider, open the position in Google Maps/Street View/OpenStreetMap, or paste GeoJSON/text. Select a feature and use Cmd/Ctrl+C, then right-click elsewhere and Paste here (or Cmd/Ctrl+V). GeoJSON geometry moves to the chosen location, retaining relative positions, attributes and heights. Plain text opens a comment draft. Comments use the existing saved annotation layers and publishing flow; this does not add threaded discussions or notifications. Editing actions retain the existing admin/project permissions. Measurements, external links and comparisons also work for viewers.

The cursor and right-click coordinates use the project's Default CRS, transformed by the existing GDAL engine. Geographic systems show latitude, longitude in decimal degrees; other systems show X, Y in their recorded units. With no default, the display uses EPSG:4326. Errors do not silently relabel WGS84 coordinates as projected values. External links always receive WGS84 coordinates. Catalogue geographic/unit metadata was generated from the EPSG definitions supplied by pyproj/PROJ. Comparison is temporary and restores the original layer visibility when closed or when switching projects.



## Compare layers

Choose **Compare layers** (◧) in the map toolbar. Tick Left and Right independently for each vector, raster or XYZ layer, then drag the pink divider. A layer can appear on either side, both sides or neither. The basemap is shared. Arrow keys move the focused divider; Home/End move it to an edge; Escape or Close returns to the normal map.

Compare is a temporary viewing tool available to editors and operators. It keeps existing styles, labels and filters and does not save selections or change layer visibility settings. Reset restores the initial selection and centred divider. Opening drawing, annotation or measurement tools closes Compare.

## Annotation menu, Route and Extract

The Annotations menu contains Pin, Line, Route, Polygon, Rectangle, Circle, More, Extract and Create layer. More contains Marker, Highlighter, Text, Note, Link, Image and Video. Measure remains a separate toolbar button. Travel time is omitted.

Route computes the shortest distance through an imported line network, in a worker, with up to 5,000 vertices. Enter WGS 84 coordinates or pick start/destination on the map. Each snaps to the nearest vertex within 250 metres; offsets and route length are recorded in attributes. Shared coordinate vertices form junctions; geometric crossings without a shared vertex do not connect. All roads are treated as two-way. Turn restrictions, gates, traffic and accessibility are not inferred. Results are new editable layers; Save and SYNC use the normal flow.

Extract takes a source layer and polygon boundary layer. It copies whole features that touch the boundary, preserving geometry and attributes. It does not trim crossing features. Draw and save a polygon first if you need a new extraction boundary. Sources are unchanged.

## Cloud file connections — setup required

Upload → Cloud services supports the device file chooser, including iCloud Drive and other cloud providers installed/enabled in the operating system. This is a selected-file import, not persistent account linking or background synchronisation. iCloud is handled through the device chooser.

Direct Google Drive, OneDrive and Dropbox connectors are implemented but disabled until the following provider registrations are configured. They must not be presented as connected before real-account verification. The cloud panel explains the unavailable state and offers the device chooser. Direct imports accept up to 20 files, 50 MB each and 100 MB total, then use the existing import review. Source files are not modified. Provider tokens and temporary download links are not saved into project data.

Set these **public browser configuration values** in `fieldops-maps/.env.local`, then rebuild. Never put client secrets, service credentials or access tokens in `VITE_` settings.

- `VITE_GOOGLE_CLIENT_ID`: Google OAuth web client ID. Register `https://www.drillops.com.au` as an authorised JavaScript origin. Enable Google Drive API and Google Picker API in the same project. Configure the OAuth consent screen and permitted testers/publication as appropriate. The connector requests `drive.file`, allowing selection through Picker rather than access to the entire drive.
- `VITE_GOOGLE_APP_ID`: Google Cloud project number, from that same project.
- `VITE_GOOGLE_API_KEY`: browser key restricted to the Google Drive/Picker APIs and approved website referrers, including `https://www.drillops.com.au/*` and `https://docs.google.com/*` as required by Picker. Google Sheets export as XLSX; Docs/Slides export as PDF. Other native Google file types require export first.
- `VITE_MICROSOFT_CLIENT_ID`: Microsoft Entra application client ID. Configure a single-page application with redirect URI exactly `https://www.drillops.com.au/maps/cloud-redirect.html`. Support organisational and personal Microsoft accounts if both are required. Add delegated `Files.Read`; no application permission or secret is used. This imports from the user's OneDrive, not all SharePoint sites. MSAL v5 uses a dedicated redirect bridge, which must not be served with Cross-Origin-Opener-Policy. The authentication cache is memory-only.
- `VITE_DROPBOX_APP_KEY`: Dropbox Chooser app key. Register the Chooser domain `www.drillops.com.au`. The Chooser returns temporary direct download links for selected files; no Dropbox secret is used.

After configuration, verify with real accounts: consent/cancel, folder navigation, normal files, expired login, denied access, import review and saving. Verify Google Sheets export and OneDrive personal/work accounts separately. Mock tests cover download limits and token destination restrictions; they do not establish that provider registrations or live consent work.

Provider instructions: [Google Picker setup](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample), [Microsoft app registration](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/initialization), [Microsoft redirect bridge](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge), [Dropbox Chooser setup](https://docs.dropboxapi.com/dropbox-api/docs/pre-built-components/chooser).

### Drawing, selection and routing update — 31 October 2026

Select features (V) supports click, Shift-click and drag-box selection across visible,
filtered vector layers, plus bounded image layers. Selected geometry remains visible
above data panes. Space temporarily pans; Escape exits. Selection offers geometry
editing, bulk attributes, layer grouping, copying into a new layer and GeoJSON export.
Extract copies an existing feature, preserving holes, altitude and attributes.
Drawing supports double-click/Enter completion, closing polygons at their first
vertex, dragged circles/rectangles and area labels. Marker/highlighter strokes save
on release; text and sticky-note styling is available.

Online roads is the default Route source, with driving, cycling and walking; imported
tracks and explicit straight lines remain alternatives. Deploy `supabase/functions/maps-route`
with JWT verification and set `ORS_API_KEY` in the project's Edge Function secrets.
Create a free account at https://account.heigit.org/ to obtain the key; never put it
in frontend environment variables or committed files. The function checks the signed-in
user's project access before calling ORS. Missing configuration, provider failures and
quota errors are shown explicitly; they never substitute a straight line for a road route.
The function was deployed to SharedMap, but live road calculation is **not enabled or
verified until the server secret is configured**.

Validation: 164 automated tests passed, production build passed. Browser checks on
synthetic local data covered click/box/Shift selection, bulk attribute editing,
rectangle creation and persistent area labels, Extract and automatic highlighter
saving. This update is not a claim of complete Felt parity: element-level grouping,
mixed road/straight route segments, route end caps, rich link cards and a complete
mobile/tool-by-tool comparison remain to be addressed. TestFlight 2.0 (16) predates
these web changes; it does not contain the new web rendering controls.
