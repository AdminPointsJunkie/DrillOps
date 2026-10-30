# FieldMaps owner analytics

Open `/maps/?admin=1` while signed in to the existing John O'Leary platform-owner account. The analytics section sits above workspace administration. Reporting access requires both the live platform-admin permission and the single account ID stored in `maps_private.analytics_owner`. Other platform admins and workspace owners cannot read it. Public wrappers use invoker rights; private functions check the authenticated caller before privileged reads. Raw tables deny client access.

The report includes current database and object storage, map/layer/feature counts, published maps, measured active web users, requests, failures, known response sizes, median and p95 response times, daily activity and operation breakdowns. Existing workspace reporting supplies uploads, storage attribution, memberships, invitations and device reports. Choose a rolling 1-, 7- or 30-day window; daily groups use Australia/Brisbane.

## Measurement boundaries

- New signed-in web requests through the Supabase client are measured. Native apps, external basemap tiles, public website visits, authentication and telemetry requests are excluded.
- Response bytes are exposed Content-Length values, including API responses. Unknown sizes are counted separately and excluded from byte totals. These are browser diagnostics, not authoritative billed egress, completed download bytes or CDN cache accounting.
- Response time ends at response headers, includes network latency, and excludes body download and map rendering. Network failures and HTTP 4xx/5xx count as failed requests.
- Metrics begin at deployment, with no reconstructed history. Current storage counts include existing files. No local GeoTIFF content or other response bodies are collected.
- Queue capacity is 200 events, with batches of 50 every 15 seconds and when the document becomes hidden. Best-effort delivery may lose samples on tab close, authentication changes or errors. Server ingestion allows at most 10,000 events per user per rolling day. Old events are pruned after 30 days on the next successful ingestion.
- Events contain authenticated user ID, checked workspace ID, a generic service/operation label, response status, size and duration. No query strings, file names, response bodies or tokens are recorded. Client-reported diagnostics are untrusted and must not be used to bill customers.
- Supabase dashboard remains the source for billed egress, compute health, quota usage and costs. No management or service-role key is shipped to the browser.

## Verification

Run `node --test tests/*.test.mjs` and the Vite production build. Tests cover request behaviour, sensitive-data exclusion, account changes, failed requests, empty reports and owner-only UI rendering. Live transaction-only checks verified that even another platform admin cannot read analytics, raw table access fails, and known samples aggregate correctly; those samples were rolled back. The security advisor reports intentional deny-all RLS tables and the pre-existing leaked-password-protection setting.
