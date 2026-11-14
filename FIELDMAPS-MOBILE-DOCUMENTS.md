# DrillOps FieldMaps: mobile document signing handoff

The native app source is on John's Mac. Native implementation is intentionally pending; the web implementation and shared backend are in this repository.

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
7. Desktop Supporting Files refreshes on opening/focus and every 30 seconds while visible. Current published map releases still require Sync. The native implementation must fetch the shared current document/version separately from its cached release: do not let an offline app overwrite a newer version. Add a deliberate operator signing permission and authorized current-document endpoint before wiring the native workflow; editor-only web permissions are not sufficient for operators.

The RPC currently requires map editing rights. If operators/viewers should sign, add a deliberate signing capability and matching storage/RPC checks; do not give them blanket map-edit rights. Re-check account/map access before completing an offline upload. Map deletion cascades private signature receipts.

## Native implementation work

- Add PDF preview, page selection, signature placement, explicit signing consent, draw/type inputs and PKCS#12 import/generation.
- Use native secure key storage (Keychain/Secure Enclave where suitable). Never include keys/passwords in diagnostics, analytics, cloud storage or sync payloads.
- Use a PDF signing library that produces compatible CMS signatures. Validate with an independent PDF reader and OpenSSL, including tampering, wrong password, expired IDs and retries.
- Queue exact output bytes and operation ID for offline signing; show pending upload and receipt status separately. Test revoked access and account switching.
- Preserve losslessly compressed downloads through the existing attachment download path. Signature validation must use decoded original PDF bytes.

## Browser Word conversion -- pending

The browser LibreOffice engine did not pass startup checks in Edge. It is **not deployed**. New Word uploads are stopped with a message to save and upload a PDF, so unconverted Word files are not stored. Existing Word attachments remain unchanged.

The upload integration supports conversion progress, cancellation, PDF validation and verified uploads. Conversion must pass an actual browser check before enabling it. Local diagnostic work is in `fieldops-maps/preview-check/word-conversion-pending/`, `word-conversion-pending.js` and `scripts/prepare-office.mjs` (not published). The pinned engine tested was @matbee/libreoffice-converter 2.7.2; its Node worker converted the two-page fixture successfully, but its browser worker stalled during LibreOfficeKit initialization. Development-server watcher crashes were also isolated; startup still stalled with a stable server. Do not ship the diagnostic worker or assume Node success proves browser success.

The intended engine is self-hosted under `/maps/office/` in an isolated conversion tab. It downloads about 75 MiB on first use. Cache runtime assets only, never documents. Preserve image resolution and review Word font/layout fidelity before release. Native Word conversion is separate work.
