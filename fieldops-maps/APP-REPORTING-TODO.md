# iPhone app reporting checklist

The website and database now accept device reports. Existing app releases do not send them; an empty report means unknown, not that the operator has never synced.

- [ ] Generate a random UUID per installation. Persist it locally; use no hardware serial, advertising identifier or session token. Reports are automatically attributed to the authenticated account, separately for each company.
- [ ] After sign-in and when entering an authorised company, call `report_map_device` using the user's Supabase session. Refresh on foreground (throttle to once per five minutes). Do not use a service-role key.
- [ ] Include `client: "ios"`, a device model, OS version, and the app's version/build in `p_details`. These are client-reported details, not verified hardware identity.
- [ ] After all release assets and the manifest are downloaded, validated and atomically saved locally, report the exact **release UUID** with `p_mode: "offline"`. Never report completion when the user merely taps SYNC, downloads partially, or opens a previously cached map.
- [ ] Set `p_completed_at` to the actual completion time in ISO 8601 UTC. Queue the receipt locally when offline and retry once connected. Preserve its original time and release ID. The server records receipt time separately. Timestamps before publication or over five minutes in the future are rejected; show a clock-correction error rather than claiming a sync succeeded.
- [ ] Keep the pending queue scoped by account/company/device/project. Clear or segregate it at logout; never submit another account's queued receipts. Retry network errors with backoff. Stop retrying access-denied reports after suspension/removal.
- [ ] Test multiple devices, partial failure, offline completion, a newer publication, retries, switching accounts and companies, suspension, and out-of-order queued receipts. The latest completion wins per device/project/mode; duplicate receipt retries do not create extra rows.
- [ ] If a user removes an offline copy, add a separate cache-removal status/API before claiming that the dashboard represents files **currently** on the phone. For now it records the last successfully downloaded version.

## RPC contract

Authenticated POST `/rest/v1/rpc/report_map_device` (or Supabase client `.rpc`):

```json
{
  "p_workspace": "COMPANY-UUID",
  "p_device": "INSTALLATION-UUID",
  "p_details": {
    "client": "ios",
    "model": "iPhone 16",
    "os": "iOS 26.1",
    "app_version": "1.2.0 (42)"
  },
  "p_release": "DOWNLOADED-RELEASE-UUID",
  "p_mode": "offline",
  "p_completed_at": "2026-10-29T01:15:00Z"
}
```

For a device check-in omit `p_release` and `p_completed_at`; use default `p_mode: "viewed"`. A check-in alone never creates a map receipt. All successful calls return void. Identity comes from the session, never a submitted user ID. Only assigned/authorised published maps in that company are accepted.

Admins read `workspace_member_report(p_workspace)`; the server restricts this to that company's owners/admins and the DrillOps platform admin. Website location: Workspace settings → Usage & devices, or Platform administration → View company → Member usage & devices.

## Reporting definitions

- Last login: Supabase's account-wide last sign-in time; token refresh is not another login.
- Last seen: server receipt of a device check-in in this company. It is not continuous online status.
- Device version: last client-reported successful download, compared with latest published version. Draft changes are excluded.
- Viewed: a complete web load, not persistent/offline storage.
- Storage: current company-linked files attributed by uploader path, deduplicated. Unattributed/removed-member files remain shown separately. Monthly cumulative uploads, storage allowances and billing enforcement are still a separate pending implementation. Deleting a file must not refund that future monthly upload ledger.

Historical app downloads cannot be reconstructed. After upgrading, the app may report an existing cached release only if it validates that the complete release is still available and has its true recorded completion time; otherwise leave its history unknown.
