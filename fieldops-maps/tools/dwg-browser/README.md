# Browser DWG importer

ACadSharp 3.8.37 pinned to commit d9f3de8c9910b602d392aa1acc72b62c095ec40e, with its pinned CSUtilities submodule. MIT licensed. The untrimmed .NET 10 WebAssembly runtime preserves reflection-based CAD readers; it loads lazily in a disposable module worker. Input never goes to a conversion service. 50 MB input / 100 MB converted output, 120-second worker deadline. Unsupported or failed conversions never fall through to another format reader.

The importer supports model-space geometry, not complete AutoCAD document fidelity. Tables, shapes, proxy/custom entities and specialist 3D objects may be absent. Model-space DWG references are detected and explicitly selected from local files/folders or original DWGs in the private company library. Selected references bind into their original INSERT definitions, retaining base point, rotation, scale and repeated placement. Nested overlays and cycles are excluded, with notices; reference depth is limited to eight levels, 100 references and 300 MB total input. Names use the standard CAD `$0$` binding prefix to keep layers/blocks distinct. GDAL block merging is disabled to retain individual styles and layers. Named ByLayer colours are resolved before binding; layer 0 and ByBlock retain inheritance. Original referenced files and library provenance are saved with the source and reused when editing coordinate settings. Conversion notices appear in the review dialog. No source CRS is inferred from drawing coordinates. Users must confirm the CRS and inspect the preview. Original DWG files are kept as the layer source; ordinary draft/save/sync rules apply.

Regenerate assets with .NET 10 and its wasm-tools workload installed:

    node scripts/build-dwg.mjs

Normal npm builds use the checked-in public/dwg assets and need no .NET installation. Sources and runtime licences are included with those assets. Browser integration test: tests/browser-dwg.html. Its small control drawing was generated from the committed control.dxf using ACadSharp's DWG writer; no customer data is included.

All three candidate readers were evaluated against 26 upstream fixtures. LibreDWG had the broadest parseable-output coverage (25), ACadSharp 21, libdxfrw 8. These are not fidelity scores. ACadSharp is the initial embedded reader because its browser runtime was verified, its RGB output matched the paired drawing and its MIT licence allows straightforward distribution. LibreDWG and libdxfrw are not bundled or silently used as fallback engines. A fallback must pass the same geometry validation and distribution review before enabling it.

The `tests/browser-xrefs.html` integration test compares synthetic, nested and repeated DWG references with independently positioned DXF geometry. It also verifies colours, layer names, skipping, cycle/overlay handling and source-bundle rebuilding. `tests/fixtures/xrefs` contains only generated test drawings.

The build applies one compatibility patch to the pinned DXF writer: always emit entity group code 8, including layer 0. GDAL needs an explicit layer 0 to inherit an INSERT layer correctly with block merging disabled. The build checks the exact upstream line before applying the patch.
