# DAR submissions and notifications

DrillOps supports native Daily Activity Reports (DARs) in the SwiftUI app and the project-scoped web portal at `/field.html`.

## Workflow

1. A contractor field user creates and saves a draft for an assigned project and contractor.
2. Submission validates the hole, rig, supervisor, driller, safety details, and activity codes.
3. Project managers and client approvers receive an in-app notification and an email-outbox item.
4. An approver can approve, raise a query, or reject the DAR. Queries and rejections require a reason.
5. The submitting contractor receives the decision. A corrected DAR is resubmitted as a new revision.
6. Approval materialises the DAR's activity, crew, and consumable rows into the existing project dashboards and locks the generated daily report.

Every state change is recorded in `dar_events` and the existing `audit_events` table. Notification inserts use an event/revision uniqueness key, so retries do not create duplicate alerts.

## Email delivery on Render

In-app notifications require no additional configuration. Email is kept in the persistent `email_outbox` until a provider is configured.

The recommended provider is Resend. Add these environment variables to the `drillops-api` Render service:

- `RESEND_API_KEY` — a Resend API key stored only in Render.
- `EMAIL_FROM` — a sender on a verified domain, for example `DrillOps <notifications@drillops.com.au>`.
- `EMAIL_REPLY_TO` — optional monitored reply address.
- `DRILLOPS_WEB_URL` — `https://www.drillops.com.au`.

Save the environment settings and deploy the service. DrillOps retries pending messages automatically when notifications are loaded or a DAR transition occurs. A system administrator can also run `POST /mobile/notifications/deliver-pending` to process up to 50 queued messages.

SMTP is supported as a fallback with `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and optional `SMTP_USE_SSL=true`.

Never add provider credentials to `render.yaml`, `config.js`, the iOS plist, or Git.

## Database migration

`backend/migrations/002_dar_notifications.sql` is idempotent and is applied by the API during startup. It creates the DAR, event, notification preference, notification, and email-outbox tables and links approved DAR rows to the existing operational tables.
