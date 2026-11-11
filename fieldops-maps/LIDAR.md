# LiDAR tools for FieldMaps desktop

Open **Analysis → LiDAR terrain tools**. Choose the original elevation GeoTIFF or local COG, confirm its band, elevation units and vertical datum, then **Load DEM**.

For a profile, choose **Draw line**, click two or more vertices on the map and click **Finish line**. The profile is extracted automatically. Hover over its chart to locate samples on the map. Change sample spacing and use **Calculate** to resample. Existing LineString and MultiLineString layers can also supply the alignment.

Other tools:
- **Cross-sections**: perpendicular sections at specified intervals along the alignment; negative offsets are left of the direction of travel. Select each section by its chainage.
- **Spot elevation · slope · aspect**: pick a location. Slope uses central differences at the chosen baseline; aspect is downslope, clockwise from north. Flat or missing neighbours have no aspect.
- **3D surface preview**: creates at most 64 × 64 sampled vertices and opens the added mesh in the existing 3D viewer. This coarse mesh is for inspection, not full-resolution terrain replacement.

Export CSV, SVG charts or 3D GeoJSON, or add a result layer and use the existing Save/Sync workflow. The DEM stays local to the open panel; reopen the source after closing it. Exported CSV contains chainage, distance/offset, longitude, latitude and elevation in metres. GeoJSON also records source name and vertical datum.

## Accuracy and limits

Use numeric elevation data, not aerial imagery, RGB terrain tiles or hillshade. LAS/LAZ requires a DEM first. Supported georeferencing follows the desktop raster sampler: WGS84, Web Mercator, WGS84 UTM, GDA94 MGA and supported GDA2020 MGA zones. Rotated/custom grids must be reprojected first. MGA lookup uses an approximate horizontal transform and is not survey-grade.

Sampling is bilinear in the original raster grid. Missing cells stay missing; profiles and mesh faces never bridge missing sampled values. Sampling outside the outermost cell centres returns NoData. Sample spacing is not increased automatically: limits are 5,000 samples per profile, 200 cross-sections and 20,000 total cross-section samples. Windowed reads cache up to 16 blocks of 128 × 128 cells; large strip-compressed files can still require substantial decoding.

Elevation band scale/offset metadata and international feet conversion are applied. There is no automatic vertical datum conversion. Orthometric elevations such as AHD will not automatically align with ellipsoid globe heights: inspect with the existing 3D viewer height offset. Surface preview interpolation can omit smaller features and NoData holes between sampled vertices. Grade and ascent/descent describe sampled elevations, not unsampled terrain.

## Validation

`node --test tests/lidar.test.mjs` covers actual Float32 GeoTIFF decoding, PixelIsArea/PixelIsPoint, units, NoData, RGB rejection, profile distances/grade, section orientation, slope/aspect, mesh holes, cancellation and panel lifecycle. `tests/browser-lidar.html` is a deterministic synthetic DEM drawing harness (development only). Browser verification: drawing a two-vertex line and finishing it automatically generated a 648-sample profile with chart and exports. No site DEM was supplied for survey validation.

## Hosted 3D elevation XYZ

Choose **Elevation source → 3D elevation XYZ**, paste an HTTPS `{z}/{x}/{y}` URL, select **Terrain-RGB** or **Terrarium**, native sample zoom, tile size (256/512) and optional provider NoData elevation. Zoom to the site and use **Load terrain XYZ**. This validates a sample at the map centre. Profiles, cross-sections, point measurements and the bounded surface preview then use the hosted elevation data.

**Add streaming 3D terrain layer** saves the source URL and current map footprint as a project layer and opens 3D. The first visible terrain source in layer order drives the globe inside that footprint. Hide that layer to return to default terrain. Ordinary imagery layers drape over the selected terrain. This is separate from the coarse, static surface preview. Streaming uses 33 × 33 heightmap vertices per display tile; sample zoom is capped at the source's configured native zoom. Source heights must already match the globe's vertical reference; no geoid transformation is performed.

Outside the saved footprint, in missing source coverage, and after tile errors, 3D uses global terrain (or ellipsoid heights where global heights are unavailable), with a status message. Analytical profiles do **not** substitute global elevations: missing source samples remain NoData. The original source datum is retained on extracted results.

Use lossless, unbuffered PNG or WebP elevation tiles in Web Mercator with XYZ north-origin Y and CORS enabled. JPEG, TMS inverted Y, quantized-mesh, Cesium 3D Tiles and ordinary coloured imagery are not elevation XYZ inputs. URL keys are saved when a streaming source is added to a project: use only keys intended for browser clients. Cloudflare account credentials are not needed. Local profile sessions cache 64 decoded tiles and cap requests at 512; reload with a lower zoom or smaller area if the limit is reached. Streaming requests dispose their tile cache after producing each display heightmap.

Encoding references: https://docs.mapbox.com/data/tilesets/guides/access-elevation-data/ and https://github.com/tilezen/joerd/blob/master/docs/formats.md .

## Cloud DEM collections

Choose **Elevation source → Cloud DEM collection**. The Ironbark 2024 collection URL is prefilled. Click **Load cloud DEM** to stream its COG tiles as one elevation source. The full dataset is not downloaded: visible map windows use overview levels, while spot elevations, profiles, sections and slope calculations sample original-resolution cells. Servers must support HTTP byte ranges and browser CORS; whole-file fallback is disabled.

Use **Terrain colours** or **Greyscale**, optional minimum/maximum heights, and opacity to adjust the display. **Add DEM to project** retains the collection URL and display settings as one project layer. Reopen a saved layer’s **DEM display and analysis…** menu to adjust its appearance or measure elevations, then choose **Update DEM layer**. Save and Sync use the existing project workflow. Hidden layers do not start downloads; removing a layer disposes its source caches. The 3D surface tool remains a bounded inspection mesh, not a streaming terrain provider.

The collection format is `fieldmaps-dem-catalog`, version 1. It contains `name`, WGS84 `bbox`, `units`, `verticalDatum`, and `tiles` with a relative/absolute HTTPS `href`, native `bounds`, WGS84 `bbox`, `crs`, `width`, `height`, and optional `band`. Relative tile paths resolve against the catalog URL. A collection is limited to 1,000 tiles and 2 MB of metadata. The current viewport image is capped at 640 × 640 pixels; this display limit never changes analytical sample resolution. Native pixel windows and HTTP blocks have bounded per-source caches.

AGD84 / AMG zones 48–58 are supported using EPSG:1669's approximate AGD84-to-WGS84 transform (nominal 3 m accuracy). The native DEM grid and elevations are retained. This is not a site-specific survey calibration or vertical datum conversion. Ironbark's vertical datum must be confirmed from its source survey metadata; do not assume AHD from the horizontal CRS.

Tests cover lazy collection loading, NoData holes, HTTP range requests against a real tiled COG, repeat-read caching, whole-file response rejection, coordinate transformation against GDAL/PROJ, and closing a hidden layer during a pending source load. `tests/browser-cog.html` is an optional development harness using the first real Ironbark tile; it writes no production project data.
