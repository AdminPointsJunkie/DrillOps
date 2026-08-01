-- Native Daily Activity Reports, in-app notifications, and transactional email outbox.
-- Safe to run repeatedly. The API also applies this migration at startup.

CREATE TABLE IF NOT EXISTS daily_activity_reports (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    contractor          TEXT NOT NULL REFERENCES contractors(name) ON DELETE RESTRICT,
    report_date         DATE NOT NULL DEFAULT CURRENT_DATE,
    shift               TEXT NOT NULL DEFAULT 'Day'
                        CHECK (shift IN ('Day', 'Night')),
    hole_id             TEXT NOT NULL DEFAULT '',
    site_name           TEXT NOT NULL DEFAULT '',
    rig_id              TEXT NOT NULL DEFAULT '',
    supervisor_name     TEXT NOT NULL DEFAULT '',
    driller_name        TEXT NOT NULL DEFAULT '',
    weather             TEXT NOT NULL DEFAULT '',
    metres_start        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (metres_start >= 0),
    metres_end          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (metres_end >= 0),
    total_metres        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_metres >= 0),
    operating_hours     NUMERIC(8,2) NOT NULL DEFAULT 0
                        CHECK (operating_hours >= 0 AND operating_hours <= 24),
    downtime_hours      NUMERIC(8,2) NOT NULL DEFAULT 0
                        CHECK (downtime_hours >= 0 AND downtime_hours <= 24),
    safety_summary      TEXT NOT NULL DEFAULT '',
    has_safety_incident BOOLEAN NOT NULL DEFAULT FALSE,
    delay_summary       TEXT NOT NULL DEFAULT '',
    geology_summary     TEXT NOT NULL DEFAULT '',
    notes               TEXT NOT NULL DEFAULT '',
    activities          JSONB NOT NULL DEFAULT '[]'::jsonb
                        CHECK (jsonb_typeof(activities) = 'array'),
    crew                JSONB NOT NULL DEFAULT '[]'::jsonb
                        CHECK (jsonb_typeof(crew) = 'array'),
    consumables         JSONB NOT NULL DEFAULT '[]'::jsonb
                        CHECK (jsonb_typeof(consumables) = 'array'),
    status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN (
                            'draft', 'submitted', 'approved', 'query', 'rejected', 'withdrawn'
                        )),
    revision            INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_by          UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    updated_by          UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    submitted_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    submitted_at        TIMESTAMPTZ,
    reviewed_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_at         TIMESTAMPTZ,
    review_reason       TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dars_project_date
    ON daily_activity_reports(project_id, report_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dars_contractor_status
    ON daily_activity_reports(contractor, status, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_dars_submitted
    ON daily_activity_reports(project_id, submitted_at DESC)
    WHERE status = 'submitted';

CREATE TABLE IF NOT EXISTS dar_events (
    id            BIGSERIAL PRIMARY KEY,
    dar_id        UUID NOT NULL REFERENCES daily_activity_reports(id) ON DELETE CASCADE,
    project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    event_type    TEXT NOT NULL,
    from_status   TEXT,
    to_status     TEXT,
    note          TEXT NOT NULL DEFAULT '',
    details       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dar_events_dar_created
    ON dar_events(dar_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    email_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_notifications (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    dar_id        UUID REFERENCES daily_activity_reports(id) ON DELETE CASCADE,
    event_type    TEXT NOT NULL,
    event_version INTEGER NOT NULL DEFAULT 1,
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,
    action_url    TEXT NOT NULL DEFAULT '',
    data          JSONB NOT NULL DEFAULT '{}'::jsonb,
    read_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, dar_id, event_type, event_version)
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_unread
    ON user_notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_notifications_project
    ON user_notifications(user_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS email_outbox (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id     UUID UNIQUE REFERENCES user_notifications(id) ON DELETE CASCADE,
    recipient           TEXT NOT NULL,
    subject             TEXT NOT NULL,
    html_body           TEXT NOT NULL,
    text_body           TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
    attempts            INTEGER NOT NULL DEFAULT 0,
    next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    provider_message_id TEXT NOT NULL DEFAULT '',
    last_error          TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_pending
    ON email_outbox(next_attempt_at, created_at)
    WHERE status IN ('pending', 'failed');

ALTER TABLE activities
    ADD COLUMN IF NOT EXISTS dar_id UUID REFERENCES daily_activity_reports(id) ON DELETE CASCADE;
ALTER TABLE activities
    ADD COLUMN IF NOT EXISTS dar_line_index INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_dar_line
    ON activities(dar_id, dar_line_index) WHERE dar_id IS NOT NULL;

ALTER TABLE crew
    ADD COLUMN IF NOT EXISTS dar_id UUID REFERENCES daily_activity_reports(id) ON DELETE CASCADE;
ALTER TABLE crew
    ADD COLUMN IF NOT EXISTS dar_line_index INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_crew_dar_line
    ON crew(dar_id, dar_line_index) WHERE dar_id IS NOT NULL;

ALTER TABLE consumables
    ADD COLUMN IF NOT EXISTS dar_id UUID REFERENCES daily_activity_reports(id) ON DELETE CASCADE;
ALTER TABLE consumables
    ADD COLUMN IF NOT EXISTS dar_line_index INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_consumables_dar_line
    ON consumables(dar_id, dar_line_index) WHERE dar_id IS NOT NULL;

ALTER TABLE daily_activity_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE dar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read their DAR projects" ON daily_activity_reports;
CREATE POLICY "users can read their DAR projects" ON daily_activity_reports
FOR SELECT TO authenticated USING (
    EXISTS (
        SELECT 1 FROM project_memberships membership
        WHERE membership.project_id = daily_activity_reports.project_id
          AND membership.user_id = auth.uid() AND membership.active
    ) OR EXISTS (
        SELECT 1
        FROM project_organizations project_org
        JOIN organization_memberships membership
          ON membership.organization_id = project_org.organization_id
        WHERE project_org.project_id = daily_activity_reports.project_id
          AND membership.user_id = auth.uid() AND membership.active
    )
);

DROP POLICY IF EXISTS "users can read their notification preferences" ON notification_preferences;
CREATE POLICY "users can read their notification preferences" ON notification_preferences
FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users can update their notification preferences" ON notification_preferences;
CREATE POLICY "users can update their notification preferences" ON notification_preferences
FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "users can read their notifications" ON user_notifications;
CREATE POLICY "users can read their notifications" ON user_notifications
FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users can mark their notifications read" ON user_notifications;
CREATE POLICY "users can mark their notifications read" ON user_notifications
FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
