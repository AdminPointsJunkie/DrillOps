# DrillOps FieldMaps: mobile document signing handoff

The iOS implementation is now in `FieldOps-1.1.3/iOS` on John's Mac. It builds successfully and its signing engine passes an iPhone simulator test. It has not been distributed through TestFlight or the App Store. Android implementation remains pending. The web implementation and shared backend are in this repository.

## Web behaviour and shared contract

- Supporting PDFs can be signed with typed text, drawn ink or an RSA PKCS#12 digital ID (`.p12` / `.pfx`). The web UI can generate a free password-protected self-signed ID. Keys and passwords stay on the device.
- Self-signed IDs do not establish independently verified identity. A recipient must explicitly trust the certificate in their PDF reader. No trusted timestamp, revocation service or CA identity verification is provided.
- Signing writes immutable PDF bytes and replaces the current attachment in the list. The original is retained in version history. Source and result SHA-256 hashes, authenticated signer ID and server receipt time are recorded. Certificate fingerprints and hashes are client-supplied; the backend does not independently validate the PDF's cryptographic signature.
- The visible PDF signing time is device time; the database `signed_at` is the server receipt time. Do not describe these as trusted timestamps.
- Existing certificate-signed PDFs are rejected to avoid invalidating their signatures. Multiple signatures on an already certified PDF require incremental PDF updates, which are not implemented.
- Typed/drawn signing supports a visible mark; certificate signing embeds detached CMS and is checked in tests with OpenSSL, including tamper detection.

See `fieldops-maps/src/document-signing-core.js`, `document-signing-save.js` and migrations `20261114024645_supporting_document_signatures.sql` and `20261114034000_document_current_version.sql`.

### Saving from the native app

1. Fetch the original attached PDF and record its SHA-256 hash. Do not change or overwrite it.
2. Generate one operation UUID and retain it with the exact signed bytes through retries.
3. Call `register_file_upload` (see `src/upload-meter.js`) for `{userId}/{mapId}/supporting/{operationId}/signed.pdf`.
4. Upload to `gis-files` without overwrite, then download and verify its SHA-256 hash. On retry, an already attached immutable file may return 403 or 409; reuse it only if an authorized download matches the expected hash.
5. Call `maps_record_document_signature` with:
   - `p_map`: map UUID; `p_operation`: stable operation UUID; `p_source`: original attachment path.
   - `p_file`: `{name, path, size, type: "application/pdf"}`.
   - `p_signature`: `{method: "typed" | "drawn" | "certificate", source_sha256, output_sha256, certificate_fingerprint}`. The fingerprint is null for typed/drawn methods.
6. Use the returned `files` list. The transaction updates the single current attachment, preserves its name/group/document ID, increments its version and returns the receipt. Old source bytes and metadata are retained in private history (`maps_document_history`). Concurrent signing against an obsolete source is rejected; reload and review the latest document before retrying. Retry the same request after an uncertain response; never generate another signature just to retry a save.
7. Desktop Supporting Files refreshes on opening/focus and every 30 seconds while visible. Current published map releases still require Sync. The native implementation must fetch the shared current document/version separately from its cached release: do not let an offline app overwrite a newer version. Use `maps_current_documents(p_map)` to fetch `{files, can_sign}`. Administrators grant individual assigned operators signing access in Supporting Files → Operator signing permissions. Removing the grant, assignment, account access or current session prevents signing.

The RPC accepts existing map editors and explicitly authorised, still-assigned operators. Operator uploads are restricted to registered per-operation signed PDF paths; operators do not gain map-edit rights. Re-check account/map access before completing an offline upload. Map deletion cascades private signature receipts.

## Native iOS implementation

- Files refreshes the current-document endpoint on opening, foregrounding and every 30 seconds. The map release remains separate.
- The signing sheet uses native PDFKit preview, page selection and placement, typed input, PencilKit drawing and explicit consent. The existing signing core runs in a bundled, nonpersistent WebKit context with network connections blocked.
- RSA PKCS#12 import and self-signed generation are supported. Password-protected IDs are stored per account in device-only Keychain items; passwords are memory-only. No key or password enters uploads, diagnostics or sync records.
- The durable queue atomically retains the operation UUID, exact signed bytes, hashes and later server receipt. It is account-partitioned, file-protected and excluded from backups. Offline signing uses a previously checked PDF snapshot; upload re-checks current access and the backend rejects obsolete sources. Pending rows can retry after app restart without signing again.
- Downloads retain URLSession's HTTP gzip decoding. Hashes and PDF validation use the decoded original bytes.
- Rebuild the bundled engine with `node native-signing/build.mjs <iOS Signing directory>` from `fieldops-maps` after installing the pinned lockfile dependencies.
- On the Mac, run `python3 Scripts/check_document_signing.py <fieldops-maps directory>` from the iOS project. This verifies the actual WebKit output with PDFKit and OpenSSL, including tampering, wrong passwords, expired IDs, queue persistence, uncertain-response retries, revoked access, hash mismatches and account switching. `DocumentSigningTests` additionally exercises the engine inside an iPhone simulator.
- Backend migrations: `20261114193559_native_document_signing.sql` and `20261114195111_signing_assignment_recheck.sql`. Both are applied to Shared Map. The private grant table intentionally has no direct client table access.
- Validation: iOS simulator build and signing test passed; 61 existing native integration checks passed; all 19 focused web tests passed. The full web suite had 10 existing failures, reproduced on the unchanged baseline, unrelated to this signing change.

Android signing, native Word conversion and native app distribution remain separate work.

## Browser Word conversion -- implemented and browser-verified

The desktop web app converts new `.doc` and `.docx` Supporting Files to PDF in the browser before upload. Only the validated PDF is stored. Existing Word attachments remain unchanged. The upload integration provides conversion progress, cancellation, PDF validation and verification of uploaded bytes.

The self-hosted engine is `@matbee/libreoffice-converter` 2.7.2, prepared by `fieldops-maps/scripts/prepare-office.mjs`. Two guarded JavaScript fixes resolve browser startup stalls: set Emscripten `noInitialRun:true` to avoid starting LibreOffice twice, and pre-create eight pthread workers to avoid worker-pool deadlock during synchronous initialization. These follow upstream pull requests #21 and #20 respectively. Verbose LibreOffice tracing is disabled. WASM/data bytes are unchanged and gzip-compressed for delivery.

The engine runs under `/maps/office/` in a separate isolated conversion tab so map tiles, authentication and the map UI retain their existing headers. First use downloads about 75 MiB; the service worker caches runtime assets only, never documents. Conversion preserves image resolution; Word font/layout fidelity can vary.

Verification on 15 November 2026: actual Edge browser converted a two-page DOCX, then a DOC/DOCX batch in the same engine session. PDF.js rendered both pages and extracted the expected text, table, headers and footers. Cached-engine batch conversion took 7.5 seconds (12.5 seconds when rendering the PDF while the production build ran). Sixteen focused conversion/upload/compression tests passed; production build passed. Synthetic test documents only; no customer files were changed. Diagnostic workers and local verification credentials are not shipped.

Native Word conversion remains separate work for the Mac/mobile repository. The shared attachment/signed-PDF version contract above is unchanged.
