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

Sampling is bilinear in the original raster grid. Missing cells stay missing; profiles and mesh faces never bridge missing sampled values. Sampling outside the outermost cell centres returns NoData. Sample spacing is not increased automatically: limits are 5,000 samples per profile, 200 cross-sections and 20,000 total cross-section samples. Windowed reads cache up to 32 blocks of 128 × 128 cells; large strip-compressed files can still require substantial decoding.

Elevation band scale/offset metadata and international feet conversion are applied. There is no automatic vertical datum conversion. Orthometric elevations such as AHD will not automatically align with ellipsoid globe heights: inspect with the existing 3D viewer height offset. Surface preview interpolation can omit smaller features and NoData holes between sampled vertices. Grade and ascent/descent describe sampled elevations, not unsampled terrain.

## Validation

`node --test tests/lidar.test.mjs` covers actual Float32 GeoTIFF decoding, PixelIsArea/PixelIsPoint, units, NoData, RGB rejection, profile distances/grade, section orientation, slope/aspect, mesh holes, cancellation and panel lifecycle. `tests/browser-lidar.html` is a deterministic synthetic DEM drawing harness (development only). Browser verification: drawing a two-vertex line and finishing it automatically generated a 648-sample profile with chart and exports. No site DEM was supplied for survey validation.
