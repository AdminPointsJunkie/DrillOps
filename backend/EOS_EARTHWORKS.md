# EOS native earthworks API

EOS uses the existing canonical DrillOps Supabase login and `DrillOpsAuthMiddleware`. No new identities, password database or user grants are created. The routes require the EOS app grant and `X-Workspace-ID`, `X-Business-Project-ID`, `X-Campaign-ID`, `X-DrillOps-App: eos` scope headers. Every endpoint resolves the selected campaign's read/write permission explicitly; the database also applies `business_private.allowed` policies through `drillops_business`.

## Routes

- `GET /eos/earthworks/catalog`: campaign site/overhead codes and caller permissions.
- `PUT /eos/earthworks/codes/{id}`: workspace admins create codes or change their label/active state. Code, type and chargeability are immutable once created; archive and create a new code for changed accounting treatment.
- `PUT /eos/earthworks/reviewers/{user_id}`: workspace admins assign/remove a campaign supervisor (`{"active":true}`). The member must already be active with EOS access, and still needs editor access to the campaign. No account or project access is implicitly granted.
- `GET /eos/earthworks/reports?after={uuid}`: paginated reports (10 per page), visible to their author or assigned reviewer. Reviewers see submitted/returned/approved reports, not another author's private draft.
- `PUT /eos/earthworks/reports/{id}`: save an author's draft/returned report. Body is `{expectedRevision, mutationID, report}`. Repeated last mutation IDs are idempotent. Stale revisions return 409; the client preserves local work.
- `POST /eos/earthworks/reports/{id}/transition`: `{expectedRevision, mutationID, action, reason}`. Authors submit; workspace admins or assigned supervisors approve/return. Self-approval is prohibited, including for admins. Return requires a reason. Review history, owner and state are stamped server-side.

## Data and rollout

Migration: `supabase/migrations/20261125214707_eos_earthworks_reports.sql`. Three additive tables contain codes, reviewer assignments and reports. No existing operational data is migrated or reclassified. Direct `anon`/`authenticated` Data API grants are revoked; all access uses the DrillOps API.

Reports contain separate labour intervals, machine operating/standby minutes, asset IDs, optional meter readings, completion states, notes and bounded JPEG evidence. Maximum 100 activities, five photos per activity, 30 photos per report, 200 KB per JPEG and 9 MB per request. Photos are compressed by the phone and stored privately with the report document; no public photo URLs are issued. CSV includes machine hours, allocation, notes, evidence counts and review history; photos themselves are viewed in EOS.

Site completion is recorded as activity evidence; this change does not alter the existing drilling pad register or automatically post payroll/costs. There are no email/push notifications in this release. Supervisors refresh the campaign inbox in EOS.

Verification: `python -m pytest backend/test_earthworks.py backend/test_business_platform.py backend/test_app_access.py -q`. `tests_earthworks_rls.sql` checks actual PostgreSQL RLS inside a rollback-only fixture transaction. Native SwiftUI compilation and device acceptance testing require Xcode on a Mac.
