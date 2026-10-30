# FieldMaps native app: data efficiency checklist

The platform changes preserve the existing schema-version-1 `map_releases.manifest` contract. The native app can continue using it, but must adopt the APIs below to gain changed-layer downloads and on-demand loading. No native app source was changed in this repository.

## Required native changes

1. **Local-only GeoTIFFs.** Open TIFF/GeoTIFF/COG files from device storage. Never upload originals, generated previews, thumbnails or an archive containing them. Keep these overlays outside the shared project's published layer layout. Label them “Local only”; explain whether the app retains a local bookmark or requires re-selection. Existing server copies are not automatically deleted.
2. **Check the lightweight manifest before opening or refreshing a map.** Call `maps_release_manifest({p_map_id})` using the signed-in user's JWT. It returns the latest release ID/version, project settings, layer layout and layer descriptors containing `id`, `hash`, `kind`, `name`, `visible`, `bounds`, and approximate JSON bytes. This server call checks live permissions; a cached release ID alone is never proof of access.
3. **Cache per account, project, layer and content hash.** Reuse unchanged layer bodies. Fetch a new body with `maps_release_layer({p_release, p_layer})` only if the layer hash changed or the local copy is missing. A changed project name or order need not redownload unchanged layers. Hashes are change tokens, not cryptographic authenticity proofs. Downloads are layers, not individual-feature patches.
4. **Load on demand.** Request visible layers first. Keep hidden layers as descriptors until enabled or explicitly inspected. Include parent-group visibility. Fetch attachments only when opened. Cancel or discard downloads for a previous account/project and guard against publication changes mid-download. If an old release has expired, refresh the manifest and retry against one consistent release.
5. **Add optional display-detail requests.** `maps_release_layer` accepts `p_tolerance: 0 | 2 | 10 | 50` (default 0). Nonzero values simplify a returned copy in EPSG:3857 display metres; originals are unchanged. They are not survey tolerances. Polar geometries are left exact. Adjacent polygon boundaries are not guaranteed to remain shared. Cache each tolerance separately, mark generalised display data, and always request tolerance 0 before measuring, editing, analysis or exporting exact coordinates.
6. **Select attributes explicitly where appropriate.** Optional `p_fields` is an array of up to 100 property names; null/default returns all. Underscore-prefixed system properties are always retained. Include fields used by labels, styles, filters and identification. Cache field selections separately. Fetch all properties on demand before full inspection or export. Never substitute a reduced-property result for the full layer.
7. **Use photo thumbnails.** Published `_fieldmaps_files` entries may include `thumbnail_path`, `size` and `original_size`. Request the thumbnail first and `path` only when the user opens/downloads the image. New web JPEG attachments are optimised to a maximum 2048-pixel edge at quality 0.82 when this reduces size, with a 256-pixel preview. Retain original photos separately if originals/EXIF matter. Native uploads should apply the same policy; documents and other image formats remain unchanged.
8. **Handle cache access and lifetime.** Partition by account, clear on sign-out/account switch, discard revoked projects, and impose a device storage budget with eviction. Online opens must revalidate live access. If offline access is added, define its authorisation expiry and revocation behaviour explicitly; it is not enabled by this web change. Never reuse one user's cache for another user.
9. **Handle retention and device reporting.** The latest three releases remain after each successful publish. A device may have an older cached version; refresh its manifest rather than repeatedly requesting a removed release. Device receipts associated with pruned releases are also removed by the existing foreign key, so report the refreshed release again. Do not claim an offline copy is current just because a previous receipt existed.
10. **Measure native usage separately.** Report app download bytes, cache hits/misses and full-download/render times if these are needed in the owner dashboard. Current diagnostics measure the web client, not native traffic or authoritative Supabase billing usage. Use a dedicated bounded, authenticated native telemetry contract before adding native reporting.

## Suggested request sequence

```text
Sign in → list assigned projects → request latest lightweight manifest
  → compare each visible layer's hash with this account's cache
  → download missing/changed visible layers for that release
  → atomically activate the new project manifest
  → request hidden layers / thumbnail / attachment on user demand
```

If permission is denied, close the project and remove its cached content. Do not fall back to cached data after a denial. If the release disappears during a download, discard the incomplete activation, fetch the latest manifest and retry. Network failures must not mix old and new layers under the new version label.

## Platform changes already delivered

- Cloud writes reject known TIFF names/MIME types and GeoTIFF layer metadata. Web uploads also inspect TIFF magic bytes. Renamed/arbitrary binary content is not a server-side malware/content scanner; the native client must apply the local-only policy too.
- Web GeoTIFF overlays remain in the current browser session and are excluded from cloud saving and publishing. Local testing mode may retain them in browser storage.
- Original import archives stay local; parsed vector layers can still be saved. Re-import the local source if original-file coordinate settings need changing. Attachment archives are rejected.
- The web published-map viewer reuses cached exact vector layers and file previews, downloads only changed layer bodies and defers hidden raster file downloads. Hidden vector bodies currently load eagerly in the web viewer so its existing search/analysis tools keep complete data; the native app can use descriptors for fully lazy vectors.
- Browser cache is best effort: at most eight project entries, with a conservative 25 MiB per-entry threshold; larger maps remain usable without persistent caching. Browser eviction can cause a fresh download. Online access is still required.
- Unchanged raster snapshots are reused across publications when their immutable draft source path matches, avoiding a new copy and download merely because another layer changed.
- One shared release serves all assigned users. Full legacy manifests are retained for compatibility, bounded to the latest three releases. Full content-addressed deduplication across retained legacy manifests is not implemented; removing those duplicate bodies requires retiring the old native download contract.
- Uploaded objects are not automatically deleted when a release expires, because draft sources and attachments may still reference them. A separate reference-checked object cleanup is required before deleting old stored files.
- Existing web analytics retain approximately 30 days, pruning older events on ingestion. No prior customer files were purged as part of this update.

## Acceptance tests for the native update

- Open an unchanged map twice: second open downloads the manifest and no unchanged layer bodies.
- Change one vector layer, publish, reopen: only that layer downloads; project order/style still updates.
- Change an unrelated layer: an unchanged raster file is not downloaded again.
- Hide a large layer and open the project: no body/file download until enabled.
- Revoke assignment, switch accounts or sign out: cached content must not remain accessible through the app.
- Interrupt a download: do not activate a mixed/incomplete release; retry safely.
- Measure/export after viewing a simplified layer: coordinates come from the exact version.
- Open a photo list: load thumbnails only; full image requires a user action.
- Try GeoTIFF and renamed TIFF upload paths: no original or preview reaches cloud storage.
- Publish more than three versions: old cache refresh succeeds after server retention removes the old release.
