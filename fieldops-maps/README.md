# DrillOps Maps

Unadvertised GIS workspace for the DrillOps / FieldOps ecosystem.

Production route: https://www.drillops.com.au/maps/
Supabase project: `dzthwvxrltkltfvubvld` (Shared Map, Sydney).

## Cloud workspace

`LOCAL_TESTING=false` uses Supabase Auth, PostgreSQL/PostGIS and the private `gis-files` bucket. Sign in with email/password or an emailed sign-in link. New accounts must verify their email. Owners access their own projects; a main administrator with server-managed `app_metadata.maps_role=admin` can manage all GIS projects and files. User-editable metadata never grants access. No admin credential is shipped to the browser.

The **Import browser projects** button appears after sign-in. It copies a selected IndexedDB project, original files, vectors, raster previews, XYZ links, styles, labels and group/order settings into that account. Local data is retained. Stable destination IDs allow interrupted copies to resume without duplicate layers. Completed copies do not overwrite subsequent cloud edits. Run this from the same browser/profile that holds the testing data.

The current free-plan bucket allows **50 MB per file**. Transfers preflight every source and preview before creating a destination project. A project containing a larger file remains local and displays an error; there is no automatic plan upgrade, server raster processing or silent loss of original files.

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

- 50 MB per file in cloud mode (local testing supports GeoTIFFs up to 250 MB), 300 MB per batch, 20,000 features per vector layer.
- Raster previews are reduced to 1,536 pixels on the longer source dimension. Full originals are retained; this is not a tiled full-resolution raster service.
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
