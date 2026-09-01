# DrillOps authentication rollout

DrillOps now uses Supabase Auth for the iPhone/iPad app and web management portal. FastAPI verifies every access-token JWT and performs project and organisation permission checks before returning mobile data.

## 1. Apply the database migration

Open the Supabase SQL Editor and run the migrations in order:

1. `backend/migrations/001_auth_and_tenancy.sql`
2. `backend/migrations/002_dar_notifications.sql`
3. `backend/migrations/003_user_audit_trail.sql`

The migration creates application profiles, client and contractor organisations, memberships, project links, and audit events. Existing clients, cost contracts and activities are used to seed the initial project relationships.

## 2. Create the first administrator

Create or invite the user under Supabase Authentication → Users. Then run this in the SQL Editor, replacing the email:

```sql
UPDATE user_profiles profile
SET system_role = 'system_admin',
    display_name = 'Workspace Admin',
    active = TRUE,
    updated_at = NOW()
FROM auth.users auth_user
WHERE profile.user_id = auth_user.id
  AND LOWER(auth_user.email) = LOWER('your-admin@company.com');
```

Use the web management portal only with a `system_admin` account until its legacy operational screens have all moved to project-scoped endpoints.

## 3. Add project users

After the first administrator is active, open **Users & Change Log** in the DrillOps management portal and choose **Invite user**. Set the person's account type, project role, and project access before sending the invitation. The user will receive a Supabase invite and set their password on the DrillOps sign-in page.

Configure a custom SMTP provider under Supabase Authentication before inviting external users; Supabase's default email service is intended only for limited testing.

The SQL below remains available as an emergency/manual alternative.

Example client project manager:

```sql
INSERT INTO organization_memberships (user_id, organization_id, role)
SELECT auth_user.id, organization.id, 'project_manager'
FROM auth.users auth_user
JOIN organizations organization
  ON organization.kind = 'client' AND organization.name = 'Argo NR'
WHERE LOWER(auth_user.email) = LOWER('manager@client.com')
ON CONFLICT (user_id, organization_id)
DO UPDATE SET role = EXCLUDED.role, active = TRUE;
```

Example drilling supervisor:

```sql
INSERT INTO organization_memberships (user_id, organization_id, role)
SELECT auth_user.id, organization.id, 'contractor_supervisor'
FROM auth.users auth_user
JOIN organizations organization
  ON organization.kind = 'contractor'
 AND organization.contractor_name = 'Allianz Drilling'
WHERE LOWER(auth_user.email) = LOWER('supervisor@contractor.com')
ON CONFLICT (user_id, organization_id)
DO UPDATE SET role = EXCLUDED.role, active = TRUE;
```

An organisation membership only grants access to projects linked through `project_organizations`. Use `project_memberships` for an exception limited to one project.

## 4. Configure Render

Set these environment variables on the API service:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Existing Supabase PostgreSQL connection string |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | Server-only Supabase secret key used to send invitations |
| `SUPABASE_JWT_AUDIENCE` | `authenticated` |
| `SUPABASE_INVITE_REDIRECT_URL` | Optional invite landing URL; defaults to `https://drillops.com.au/` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated permitted web origins |

Deploy after the migration has completed. Anonymous API calls are intentionally rejected. Existing unscoped endpoints require `system_admin`; tenant users use the project-scoped `/mobile` routes.

## 5. Configure the web portal

Edit `docs/config.js`:

```js
window.DRILLOPS_CONFIG = {
  supabaseUrl: 'https://<project-ref>.supabase.co',
  supabasePublishableKey: '<publishable-key>'
};
```

The portal signs in through Supabase, refreshes sessions, attaches bearer tokens to API calls, removes the browser-only shared password and fake local accounts, and protects its detail pages with the same session.

## 6. Configure the iOS app

Set the same URL and publishable key in `DrillOps/Configuration/DrillOpsConfiguration.plist` in the iOS repository.

The app stores its session in Keychain using `AfterFirstUnlockThisDeviceOnly`, restores the session at launch, refreshes expiring tokens, and signs out through Supabase.

## Security notes

- The publishable key is safe in public clients. Never place a secret/service-role key in `docs` or the iOS app.
- Keep `SUPABASE_SECRET_KEY` only in the Render API environment. It must never be exposed by the web portal.
- Use Supabase asymmetric JWT signing keys so FastAPI can validate tokens through JWKS.
- Enable MFA for administrators, approvers and finance users before production use.
- Apply the migration and create the first administrator before deploying the API changes.
- Database-owner connections can bypass RLS. FastAPI's project checks remain mandatory.

## Audit trail

Migration 003 adds server-stamped `created_by`, `updated_by`, `created_at`, and `updated_at` columns to operational records. It also records field-level before/after changes in `audit_events` and writes one concise `import_batches` record per imported file. The actor comes from the verified Supabase JWT and cannot be supplied by the browser.

Existing records remain valid but show an unknown/legacy actor until they are changed. New imports record the user, timestamp, file type, workspace, and row counts. Review these in **Users & Change Log**.
