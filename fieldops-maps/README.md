# DrillOps Maps

## FieldOps account connection and manual edits

FieldOps 1.1.3 connects using a separate FieldMaps account. Workspace administrators can enable **Allow uploads from FieldOps** for individual members in People & access; membership and project assignments still apply. All members are read-only from FieldOps until that permission is explicitly enabled.

The device keeps a durable account-specific edit queue. **Sync now** uploads queued vector changes and downloads published projects for offline use. Saving or foregrounding the app never triggers an upload. Mobile uploads update the draft; an authorised web editor still presses **SYNC** to publish changes to other devices.

Browser and mobile edits use original snapshots to merge changes to separate fields. Same-field changes and deletion versus editing require an explicit conflict choice. Cancelling the web review retains unsaved edits. Stable feature identifiers, revision checks and idempotent upload operations protect against stale saves and lost-response retries. Uploaded device overlays remain until a newer publication is downloaded.

The migration is `20261108083943_fieldops_account_edits.sql`. Tests are `tests/fieldops-sync.sql` (run in a transaction and roll back) and `tests/fieldops-sync.test.mjs`. The new private tables intentionally have no direct client access; authenticated API functions enforce live workspace access and the explicit upload grant. Existing data replacement/version-history functions retain their prior access policies and now reject stale revisions.

Mobile edits cover scalar attributes and coordinates for points, lines and simple polygons. Other geometry is retained during attribute edits. Raster and attachment uploads are not part of this integration. Live tile services still need internet. Complete offline downloads are kept through network failures; confirmed revoked access removes the downloaded project on the next access check.

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
The function was deployed to SharedMap and the existing free-account key was saved
in its encrypted server settings with the owner’s approval. It uses the current
`api.heigit.org/openrouteservice/v2/directions` endpoint.

Validation: 164 automated tests passed, production build passed. Browser checks on
synthetic local data covered click/box/Shift selection, bulk attribute editing,
rectangle creation and persistent area labels, Extract and automatic highlighter
saving. This update is not a claim of complete Felt parity: resizing a whole element group and a complete
mobile/tool-by-tool comparison remain to be addressed. TestFlight 2.0 (16) predates
these web changes; it does not contain the new web rendering controls.

Live verification: the signed-in portal calculated 4.07 km driving, cycling and walking routes
between two public-road test stops near Coppabella. The preview was not saved to the project.
The published JavaScript assets matched the local production build byte-for-byte.

### Individual feature groups and mixed routes

The selector now groups only the selected vector features, including features from
multiple layers. Group membership is stored in `_fieldmaps_group` feature properties,
so existing save/SYNC/download flows preserve it without a schema migration. Clicking
a member selects the visible group; Alt-click selects one member; Shift toggles the
group; Ungroup removes membership. Hidden or filtered features are excluded from
selection. Group buttons list the visible members. Existing layer folders are unchanged.
Extract and Create layer from selection produce independent copies, not new group members.

Route supports per-segment Road/Straight choices, a next-segment control and Shift-click
for straight segments. Adjacent road legs share a provider request. Straight legs join
snapped road endpoints and do not invoke the provider. Failed road legs cannot become
implicit straight lines. Changing stops invalidates outstanding calculations. Successful
road requests are cached for the open tool session to conserve the free allowance.
Width, opacity, solid/dashed/dotted pattern, distance labels and endpoints persist on
the resulting layer. Segment choices and waypoints persist in routing metadata.

Validation: 171 tests pass, including mixed-leg batching, snapped joins, failure and
stale-response handling, request reuse and saved route styles. Browser checks confirmed
grouping two of twelve points, selecting that pair with one click, Alt-selecting one
member, and ungrouping without changing the source layer's feature count.

Selected features can now move together using Move selected and a map drag, with
Undo move available while the selector remains open. Movement preserves polygon holes,
altitude and other coordinate components. Undo restores geometry while retaining later
attribute edits. Project changes during an in-flight layer save cannot redraw an old
project's layer into the newly opened map. Link annotations render readable cards with
a title, note and destination, without fetching third-party page content or previews.

Validation expanded to 174 passing tests. Browser checks confirmed moving two features,
undoing to their original positions, and saving a readable link card on the map.

### Felt tutorial audit — 31 October 2026

Reference: https://www.youtube.com/watch?v=3gLvhVlX82Y (11:16). This audit uses
its complete auto-generated transcript and the implementation, with browser evidence
only where explicitly stated. It supersedes earlier short lists of remaining gaps.
The portal is **not yet a complete behavioural match** to the tutorial.

| Tutorial workflow | Current portal status | Remaining difference |
| --- | --- | --- |
| 0:25 Place search creates a labelled pin | Search finds existing layer features | Place geocoding, map navigation and creating a search-result pin |
| 0:41 Built-in data library / graticules | Imports and basemaps available | Equivalent curated dataset library and editable graticules |
| 1:20 Extract administrative boundaries/buildings by zoom | Extract copies a feature already on the map | Boundary/building data source, hover preview and zoom-dependent extraction |
| 1:54 Shapes and area/distance | Drawing gestures tested; rectangle and persistent area label browser-tested | Full gesture-by-gesture checks for each shape; metric/imperial switching |
| 2:57 Routes with road snapping and Shift straight segments | Driving/cycling/walking tested live; mixed road/straight preview tested live at 8.12 km | Continuous cursor preview, matching Escape completion and re-routing saved routes by dragging endpoints |
| 4:07 Select by colour; Ctrl/Cmd+G grouping | Click/box/Shift selection, individual feature groups and Alt member selection browser-tested | Select same colour, grouping shortcut and context-menu actions |
| 5:13 Group visibility and legend icons | Feature-group membership and selection implemented | Group visibility switch, group legend view and custom icons/emoji |
| 6:06 Bulk attributes | Individual and bulk editing implemented and tested | Felt's attribute-coverage counts and add-existing-row-to-all interaction |
| 7:20 Elements versus layers; conversion both ways | Create layer from selection makes an independent copy | Separate element lifecycle/topmost rendering, conversion rather than copy, reverse conversion |
| 7:48 Categorical data styling | Existing attribute-based styles and layer legends | Exact tutorial workflow not fully browser-audited |
| 8:20 Marker / highlighter / duplicate / rotate | Freehand strokes and styles; group movement with Undo browser-tested | Cmd/Ctrl+D styled duplication, rotation handles, highlighter dots from single clicks |
| 9:13 Text | Text styling and movement implemented | Styled duplication and full direct-on-map editing parity |
| 9:36 Notes and comments | Sticky notes implemented | Collaborative comments and full note interaction audit |
| 9:50 Website / YouTube links | Readable website cards and safe links browser-tested; direct video-file player exists | YouTube embeds, K shortcut and fetched rich previews |
| 10:20 Annotation groups / legend emoji | Annotation feature groups supported | Group legend and emoji controls |
| 10:49 GeoJSON export | Layer/project/selection export actions exist | End-to-end exported-file comparison for all tutorial-created element types |

Live mixed-route verification after unlocking the Mac: three public-map stops near
Coppabella, first leg Follow roads, second leg Straight line entered with Shift-click.
The portal displayed a continuous 8.12 km result and enabled Add route. The preview
was closed without saving or syncing it into the user's project. Screenshot retained
locally in verification/felt-tools/live-mixed-route.png.

### Further Felt tool behaviour — 31 October 2026

Added selection by displayed colour, duplication retaining layer/annotation styles, clockwise rotation and geometric scaling with Undo, Ctrl/Cmd+G grouping and Ctrl/Cmd+D duplication, and persisted feature-group visibility. Added metric/imperial display units, single-click marker/highlighter dots, K for Link, and explicit-click YouTube playback using youtube-nocookie embeds. Rotation/resizing currently uses numeric controls; scaling changes geometry, not annotation font/card dimensions.

Validation: 179 tests pass; production build passes. Local synthetic browser checks verified same-colour selection, duplication, rotation, and group hide/restore. Full tutorial parity remains unfinished: public place-search pins, curated library, zoom-dependent boundary extraction, saved-route endpoint rerouting, separate element/layer conversion, group legend icons, collaborative comments and direct drag transform handles. This release updates the web portal, not the native TestFlight build.

### Reference library, boundary extraction, route editing and group legends — 1 November 2026

- Data library adds countries, selected-country states/provinces, major rivers, major lakes and an editable 10° graticule. Bundled Natural Earth geometry is pinned to ca96624a56bd078437bca8184e78163e5039ad19; see public/library/SOURCES.txt. State coverage is nine countries, including Australia.
- Extract offers existing features, countries, states, local administrative boundaries and buildings. Zoom-based mode selects the source; the user explicitly loads the current view. Hover highlights a polygon, click selects it, and Create editable copy preserves geometry and source attribution. Local boundaries/buildings use free Overpass with bounded view sizes, 25-second service timeout, 35-second client timeout, cancellation and stale-project guards. Incomplete geometries/responses are rejected. Source availability and precision vary; no cadastral claim is made.
- Edit geometry on a route restores its saved stops, mixed segments and styles; dragging a stop recalculates before Save route updates the existing layer. Cancelling restores the existing display. Endpoint handles stay above preview lines. Imported-track source IDs are now saved. Existing routes without routing metadata continue using the geometry editor.
- Feature groups appear in layer legends with visibility controls and editable names/icons/emoji. Changes apply across member layers with edit-access checks.

Validation: 186 tests pass and production build succeeds. Browser checks added a 177-country layer, loaded 1,092 real Brisbane building footprints and extracted one as an editable polygon, renamed a group and changed its legend icon, and moved/recalculated/reopened a route endpoint (891.9 m to 778.6 m). Online mixed-route recalculation is additionally covered by automated tests; no customer project was altered during these checks.

This covers these four workflows but does not claim Felt's identical data catalogue, full worldwide state/local coverage, or automatic boundary refresh on every pan. New changes apply to the web portal, not the native TestFlight build.

## Draft saving and Recently deleted (4 November 2026)

- **SAVE**, beside **SYNC**, saves pending layers and layout without publishing a phone release. **SYNC** publishes the current active project.
- **DrillOps menu → File → Project settings → Delete project** permanently deletes a project after confirmation. The database removes its layers, published releases and basket entries. Offline device copies may remain until devices reconnect.
- Removing a saved layer moves its complete row and feature records into the workspace's **Recently deleted** basket atomically. Refresh cannot reload archived layers and SYNC cannot publish them. Unsaved local layers require confirmation because they have no stored copy to restore.
- The basket restores a layer to its original project or another editable project in the same workspace. Geometry, attributes, styling and layer identity are retained. Workspace admins can empty the basket; editable items can be permanently deleted individually. Deleted records expire after 30 days, with database cleanup hourly at minute 17. Browser-only testing cleans expired records when the basket is accessed.
- Existing phone releases remain unchanged until the next SYNC. Shared uploaded objects and files referenced by published snapshots are retained; this migration purges archived database records, not Storage objects.
- Apply `20261104080131_layer_recycle_bin.sql` before deploying the web build. The archive is private, RLS-enabled and accessible only through permission-checked functions. Restore destinations must remain inside the workspace. Annotation actions require workspace admin access.
- Validation: 194 Node tests; production build; real-browser desktop/mobile Save, remove, refresh, restore-to-another-project and project-delete checks; isolated SQL checks; transaction-only integration checks on Shared Map (rolled back). No existing user projects were deleted during validation.

### Account controls and map workflow update — 4 November 2026

Every signed-in account can open Account settings from the home workspace menu or DrillOps → Settings, independently of workspace role. Name, email, optional contact phone/job title and marketing preference are saved on the user's own auth profile. Email changes use Supabase confirmation. Marketing is opt-in only; missing preferences mean false. Preference changes retain the wording, timestamp and source. No mailing campaign or provider integration is enabled by this UI.

Photos are cropped/resized to 512 px JPEG and stored in a private `profile-photos` bucket (1 MB, owner-path SELECT/INSERT/DELETE only). Signed URLs are created for the account avatar; initials remain the fallback. Photos currently appear in the user's personal account controls, not other members' directory entries. Migration `20261104082319_account_profile_photos.sql` creates the bucket and policies. A rollback-only live policy check verified own reads and denial of cross-account reads.

Upload → Paste spreadsheet or GeoJSON accepts tabular clipboard text, CSV and GeoJSON (5 MB / 20,000 records), previews the first five records and uses the existing coordinate/join review. Layer search filters the sidebar without changing map visibility or published content.

Style by value adds equal-interval/quantile classification and sequential colour palettes. Ties are kept together; fewer classes are produced when distinct values are insufficient. Preview draws temporary styles on the actual map; Apply saves the style, Cancel removes the preview. Saved explicit class boundaries remain compatible with native rendering.

Analysis now previews the result on the map before Add result layer. Parameter edits invalidate the preview, cancellation terminates the worker and removes temporary geometry, and acceptance checks the source is still open. Results include operation/source/parameter provenance in layer metadata and remain drafts until saved and explicitly synced. Existing 20,000-feature limits and geometry restrictions remain in place. This is an incremental Felt-inspired workflow update, not full Felt feature parity or a new live-collaboration/connected-database backend.

## Data workflows, styling and public viewing (4 November 2026)

Layer Style now includes **Replace data**, **Previous data**, **Presets & bulk styling**
and **Number formatting**. Replacement uses the existing import review and reuses
that layer's coordinate-column settings. It previews added/removed columns, blocks
missing presentation fields and mismatched geometry families, and can match a unique
record column to retain location attachments and feature groups. Replacements keep
layer identity, name, presentation and order. Cloud replacement and backup are one
transaction; the latest three previous datasets can be restored after refresh.
Recovery keeps the current presentation. It does not publish: Sync is separate.
Replacement currently accepts one vector dataset per operation; multi-sheet sources
must be exported to one dataset first. Original TIFF/archive cloud restrictions remain.

Workspace style presets copy colour, opacity, symbol/line/fill settings, labels,
classification rules and number formats, preserving each target's filters/popups.
Applying to multiple saved layers is atomic. Missing label/classification/formula
columns block application. Natural breaks use exact weighted Jenks classification;
manual limits must cover the numeric data. Style-by-value controls now appear for
lines and polygons as well as points. Number formats are per column: decimals,
thousands separators, trimmed zeros, percentages, compact values and prefix/suffix.
They format display values without rewriting source numbers.

Analysis now clips points and lines as well as polygons, measures nearest distances
from points, summarizes clipped lengths/areas/values within polygons, and produces
geometry-validation point reports. Invalid geometries are reported, not silently
repaired. Saved result settings can be rerun against current inputs; source updates
do not automatically recalculate existing results. Missing sources block reruns.
Operations run in cancellable browser workers with map preview before acceptance.
The 20,000-feature and pair-work limits remain. Heatmaps use a bounded 384-pixel
Gaussian density image (equal point weights, radius in metres, local Web Mercator
scale), saved as a regular raster for web/phone publication. Hexagon summaries create
ordinary count polygons, with a 2,000-cell/5-million-point-cell work limit.

**Share** enables or disables an unguessable view-only link. It is off by default and
serves only the latest synced release. A separate public viewer supports pan/zoom,
layer visibility and feature inspection, with no editing, upload, export or publishing
controls. It exposes published layer data/attributes, not source files or attachment
files. The endpoint rechecks the link, project and active workspace on every request;
the viewer checks every 30 seconds. Published raster previews use 60-second signed
URLs. Previously viewed/downloaded content cannot be recalled. No existing map is
made public by deployment. A map must have a synced release before viewers can open it.

Direct Drive/OneDrive/Dropbox registrations still need provider account setup and real
consent verification before those integrations can be enabled; device file imports
continue to work. This release does not lift cloud/browser size limits or add scheduled
source refresh, full live collaboration, mobile field capture, or server GIS processing.

### Cloud provider activation — 5 November 2026

Google Drive and Dropbox registrations are configured for `www.drillops.com.au`. Google uses the DrillOps project `gen-lang-client-0336912368` (number `497875615131`), a website OAuth client, `drive.file`, and a browser key restricted to Drive/Picker and the required referrers. Dropbox uses the Chooser with the registered website domain; Chooser does not require production approval. Public browser identifiers are kept in the local build environment; no OAuth client secret is used by this application. OneDrive remains disabled until its Microsoft app registration is completed.

Releases must preserve `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_APP_ID`, `VITE_GOOGLE_API_KEY`, and `VITE_DROPBOX_APP_KEY` when rebuilding. Do not claim a provider was live-tested from mocked unit tests alone.

## Supporting project files — 5 November 2026

Each saved project has a right-hand Supporting Files panel. Documents and images use the existing private file storage and upload metering, separately from GIS layers. PDF, Office documents, text/RTF and common images are accepted, up to 50 MB each, 20 files/300 MB per batch and 200 files per project. Uploads save the project draft immediately; SYNC snapshots the list for assigned app users. Removing a draft reference leaves previously published bytes intact until the normal publication lifecycle permits cleanup. Public viewing links omit supporting document metadata and download access.

The database migration adds a validated `maps.supporting_files` list, an atomic add/remove endpoint, immutable file protection and supporting-file publication snapshots. It preserves the existing workspace/project permissions. Native build 2.0 (24) adds Map / Files navigation, file preview/share and supporting documents in complete offline downloads. Web tests and rolled-back database role tests cover limits, private references and publication isolation; native integration tests cover offline documents and incomplete-package rejection.


### Custom print layout boxes — 5 November 2026

Print layout now provides direct Company logo upload/replacement, a selectable Items on page list, four-corner resizing, exact position/size fields, keyboard nudging, and front/back stacking controls. Every box type supports an optional frame with colour and thickness controls. SVG/vector PDF and raster exports share the same frame settings. Layouts and embedded logos remain saved on the current device, including reusable layouts.

Validation: 229 automated tests passed; production build succeeded. Browser checks covered logo upload, dragging, northwest-corner resizing, exact dimensions and frame toggling. Exported PNG was visually checked; SVG contained all six frames and the embedded logo.

Text boxes and custom layouts now have explicit toolbar actions: ＋ Text box, Save custom layout, and My layouts. A new text box selects its placeholder for immediate typing. Named custom layouts appear before samples, with clear browser/device storage information and save-error feedback. Browser verification added text, saved a named layout, reopened the editor and restored the layout with its text and logo intact. Production build passed.

Print map settings now include up/down layer ordering, shared by preview stacking, legends and vector/raster output. Layer order and visibility persist in custom layouts for the same project; unrelated projects use their own layers. Each page element has an accessible trash button in Items on page, plus Remove element in its settings; Delete/Backspace removes a selected element outside text inputs. Removing an element changes the layout only. Validation: 230 tests passed, production build succeeded, two overlapping layers reordered correctly, SVG draw order verified, and custom-layout reload retained order and removal.

Map framing interaction: double-click inside a map box to pan/zoom; double-click outside it (including another page element or the blank page) to save the current view and return to layout mode. Escape remains available. Active mode shows a toolbar hint and hides resize handles. Pointer capture now starts only when dragging, and a stationary click no longer rebuilds the box, preserving browser double-click targeting. Verified entry, zoom, pan, outside double-click exit and re-entry in the browser; 230 tests and production build passed.

### Print text formatting (5 November 2026)

Select a text box to set its font, size, bold, italic, underline, text colour, alignment, line spacing, padding and optional background colour. Formatting applies to the whole box and is retained in saved custom layouts. Preview and export share text layout rendering; vector PDF uses standard PDF font variants for styled text.

Validation: 233 tests passed, production build passed, and browser/PDF checks confirmed coloured, centred, bold/italic/underlined text.

### Workspace and public layer library — preview, 5 November 2026

The existing library entry opens a searchable browser with Workspace, Public data and admin-only Archived tabs, categories and actual geometry previews. Owners/admins save independent snapshots of current vector layers, cloud imagery or XYZ settings, with names/descriptions and presentation. Editors reuse copies. Feature attachments and original upload files are excluded; local-only GeoTIFFs remain local. Maximum snapshot file size is 50 MB. Archive/restore preserves project copies. Public data starts with the five existing attributed Natural Earth/grid datasets; it does not claim the full Felt catalogue.

Private layer-library storage and the workspace_layer_library table were installed with RLS. Rolled-back live database checks passed owner save/read, editor read, editor write denial, archived-row hiding, operator exclusion and unrelated-user isolation. The security advisor reported no library findings. All 239 tests and production build pass. Local browser verification saved a sample layer, reopened it, previewed it and added a separate project copy; public Countries preview was checked. Screenshots: Shared Map/verification/layer-library-20261105. Website deployment remains pending user preview approval.


## 3D map view

The 2D / 3D control opens a lazily loaded Cesium globe with satellite imagery and Esri World Elevation terrain. 3D data stays in the browser. Reuses project layer visibility, filters, source KML styling, point labels and feature inspection. Go to feature frames a named asset; right-drag/Ctrl+drag or a two-finger gesture orbits the model. Fit layers, top view, a display-only height offset and project-basemap choice are available. Layers opens the existing layer controls. Drawing and horizontal measurement remain in 2D. Closing 3D releases WebGL resources and returns to the same area in 2D.

KML geometry retained for 3D is preferred over the 2D plan-view geometry. Face triangulation uses the face's own plane, preserving vertical panels, holes and conductor elevations. All multi-part geometry is traversed. Absolute heights remain as supplied; relative-to-ground and clamped content use sampled terrain. Terrain and source vertical datums can differ; height offset affects the view only and does not alter saved coordinates. Terrain is a display surface, not a survey elevation reference. External COLLADA/glTF models, KML tours and screen overlays are not supported by this geometry viewer. WebGL failure leaves 2D available; terrain failures are shown explicitly.

Workers, widget CSS, terrain decoders and Cesium assets are hosted under `/maps/cesium/`; the prebuild script copies the pinned engine assets. The satellite provider reuses the application's parent-tile fallback so missing high-resolution tiles do not cover the scene with placeholder imagery. No Cesium ion account or API key is required.

## Nested KMZ save recovery (9 November 2026)

Nested KML MultiGeometry collections are retained when saved layers are read back. The database serializer preserves collection order and Z coordinates; PostGIS's direct GeoJSON export rejects nested collections. Large import, readback and publication calls have a bounded 45-second budget. Readback failures after a committed import retry the existing layer and clear the stale Save failed state without reuploading the source or creating duplicate layers.

Validation: the affected saved 499-feature layer was read with its authenticated owner's permissions, retaining original 3D geometry. A rolled-back 9+ MB / 499-feature nested collection import and readback passed. All 321 web checks and the production build passed. Apply both `20261108223641_nested_kmz_geojson_readback.sql` and `20261108223846_large_kmz_read_publish_budget.sql`; both are already applied to the live project.

The large-KMZ publishing path also avoids repeated binary JSON construction and redundant whole-manifest copies in project-settings/supporting-file triggers. The exact two-layer customer project completed a rolled-back SYNC under the actual account permissions in 11.72 seconds, with all 547 features verified. No customer publication was committed by the check. Apply `20261108225756_efficient_large_kmz_publication.sql` (already live).
