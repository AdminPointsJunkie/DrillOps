# FieldOps Maps

Unadvertised GIS workspace for the DrillOps / FieldOps ecosystem.

Production route: https://www.drillops.com.au/maps/
Supabase project: `dzthwvxrltkltfvubvld` (Shared Map, Sydney).

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

- Browser: Vite, Leaflet, GDAL 3.8.4 / PROJ 9.3.1 in a Web Worker, Papa Parse.
- PostGIS: `public.maps`, `public.layers`, `public.features`, a GiST geometry index, and an atomic vector-import function.
- Supabase Storage: private `gis-files` bucket; paths scoped to the signed-in user.
- Supabase Auth: email/password. Configure production email delivery and redirect URLs in the Supabase dashboard before opening registration broadly. The browser uses only a publishable key. No service-role secret is present.
- CRS catalogue: non-deprecated geographic 2D/projected EPSG records exported from installed PROJ database; exact EPSG numbers and name fragments are searchable. Runtime conversion validates the selected definition with the bundled PROJ engine.

Importing does not upload data until Save is used. Originals, source CRS, chosen epoch/pipeline/control points, height-reference label and display geometry are retained on save. Preview and unsaved layers are held in browser memory. A signed-in account can use saved maps from another browser/phone and refresh them.

## Tested

- Browser batch upload, CSV column selection, EPSG 7856 name/number lookup, MGA56-to-WGS84 reprojection, raster preview, GeoJSON review.
- GDAL engine: zipped shapefile, DXF, GeoJSON, GeoTIFF warp/PNG output.
- Coordinate parsing: decimal degrees, DMS hemispheres, malformed coordinates and out-of-range bounds.
- Database: transaction-only vector insertion, owner access and cross-account denial. Test users/data were rolled back. Supabase security advisor was clear.

## Current limits

- 50 MB per input file, 100 MB per batch, 20,000 features per vector layer.
- Raster previews are reduced to 1,536 pixels on the longer source dimension. Full originals are retained; this is not a tiled full-resolution raster service.
- Browser memory and the bundled driver determine format support. DWG is not promised. GeoTIFF/world-file georeferencing is required for raster positioning.
- Source coordinate systems are never inferred from coordinate magnitudes. CSV requires confirmation; missing CRS requires a choice.
- PROJ requests best available operations without downloading grids. Missing resources may cause import to fail. No survey accuracy is certified. Height reference is recorded, not vertically transformed. Expert pipelines and first-order local-grid control points are vector-only.
- Online access only. No offline downloads, cross-account sharing, native FieldOps sign-on integration, automatic refresh, replacement/versioning, or background processing for large datasets yet.
- Remove hides a saved layer from the current view; Refresh restores it. No cloud deletion UI is exposed.

## Engine packaging

`scripts/prepare-engine.mjs` stores the WASM engine as a gzip-compressed `.bin` below per-file hosting limits. The browser decompresses it into a Blob. A narrowly checked patch permits Blob URLs in the upstream GDAL worker path resolver. Other GDAL behavior is unchanged. See `public/GDAL-LICENSE.txt` and https://github.com/bugra9/gdal3.js for upstream source and component notices.

## Database connections

Dashboard: https://supabase.com/dashboard/project/dzthwvxrltkltfvubvld
API: https://dzthwvxrltkltfvubvld.supabase.co
Direct PostgreSQL host: `db.dzthwvxrltkltfvubvld.supabase.co`, port 5432, database `postgres`, username `postgres`, SSL required. Passwords and pooler connection details must be obtained from the dashboard Connect panel. Do not put database passwords or service-role keys in client code.
