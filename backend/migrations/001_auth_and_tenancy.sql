-- DrillOps authentication and multi-tenant access foundation.
-- Run this once in the Supabase SQL Editor before deploying the authenticated API.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL DEFAULT '',
    system_role  TEXT NOT NULL DEFAULT 'user'
                 CHECK (system_role IN ('user', 'system_admin')),
    active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            TEXT NOT NULL CHECK (kind IN ('client', 'contractor')),
    name            TEXT NOT NULL,
    client_id       INTEGER UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
    contractor_name TEXT UNIQUE REFERENCES contractors(name) ON DELETE CASCADE,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT organization_source_matches_kind CHECK (
        (kind = 'client' AND client_id IS NOT NULL AND contractor_name IS NULL)
        OR
        (kind = 'contractor' AND contractor_name IS NOT NULL AND client_id IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS organization_memberships (
    user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role           TEXT NOT NULL CHECK (role IN (
                       'client_admin', 'project_manager', 'approver',
                       'contractor_admin', 'contractor_supervisor',
                       'field_user', 'finance', 'auditor'
                   )),
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, organization_id)
);

CREATE TABLE IF NOT EXISTS project_organizations (
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    relationship    TEXT NOT NULL CHECK (relationship IN ('client', 'contractor')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, organization_id)
);

CREATE TABLE IF NOT EXISTS project_memberships (
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN (
                   'project_manager', 'approver', 'contractor_supervisor',
                   'field_user', 'finance', 'auditor'
               )),
    active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
    id            BIGSERIAL PRIMARY KEY,
    actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    action        TEXT NOT NULL,
    entity_type   TEXT NOT NULL,
    entity_key    TEXT NOT NULL,
    details       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organization_memberships_user
    ON organization_memberships(user_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_project_memberships_user
    ON project_memberships(user_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_project_organizations_project
    ON project_organizations(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_project_created
    ON audit_events(project_id, created_at DESC);

-- Every Supabase Auth user receives a disabled-by-default application profile.
-- Access is granted only after an administrator adds a membership.
CREATE OR REPLACE FUNCTION public.handle_drillops_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.user_profiles (user_id, display_name)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(COALESCE(NEW.email, ''), '@', 1))
    )
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_drillops_auth_user_created ON auth.users;
CREATE TRIGGER on_drillops_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE PROCEDURE public.handle_drillops_auth_user();

INSERT INTO user_profiles (user_id, display_name)
SELECT id, COALESCE(raw_user_meta_data ->> 'full_name', split_part(COALESCE(email, ''), '@', 1))
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO organizations (kind, name, client_id)
SELECT 'client', name, id FROM clients
ON CONFLICT (client_id) DO UPDATE SET name = EXCLUDED.name, active = TRUE;

INSERT INTO organizations (kind, name, contractor_name)
SELECT 'contractor', name, name FROM contractors
ON CONFLICT (contractor_name) DO UPDATE SET name = EXCLUDED.name, active = TRUE;

INSERT INTO project_organizations (project_id, organization_id, relationship)
SELECT p.id, o.id, 'client'
FROM projects p
JOIN organizations o ON o.kind = 'client' AND o.client_id = p.client_id
ON CONFLICT DO NOTHING;

INSERT INTO project_organizations (project_id, organization_id, relationship)
SELECT DISTINCT p.id, o.id, 'contractor'
FROM projects p
JOIN cost_contracts cc ON cc.project_id = p.id
JOIN organizations o ON o.kind = 'contractor' AND o.contractor_name = cc.contractor
ON CONFLICT DO NOTHING;

-- Backfill contractor links where historic activities provide the only project evidence.
INSERT INTO project_organizations (project_id, organization_id, relationship)
SELECT DISTINCT p.id, o.id, 'contractor'
FROM projects p
JOIN activities a ON LOWER(BTRIM(a.project)) = LOWER(BTRIM(p.name))
JOIN organizations o ON o.kind = 'contractor' AND o.contractor_name = a.contractor
ON CONFLICT DO NOTHING;

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read their profile" ON user_profiles;
CREATE POLICY "users can read their profile" ON user_profiles
FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users can read their organization memberships" ON organization_memberships;
CREATE POLICY "users can read their organization memberships" ON organization_memberships
FOR SELECT TO authenticated USING (user_id = auth.uid() AND active);

DROP POLICY IF EXISTS "users can read their project memberships" ON project_memberships;
CREATE POLICY "users can read their project memberships" ON project_memberships
FOR SELECT TO authenticated USING (user_id = auth.uid() AND active);

DROP POLICY IF EXISTS "members can read their organizations" ON organizations;
CREATE POLICY "members can read their organizations" ON organizations
FOR SELECT TO authenticated USING (
    EXISTS (
        SELECT 1 FROM organization_memberships membership
        WHERE membership.organization_id = organizations.id
          AND membership.user_id = auth.uid()
          AND membership.active
    )
);

DROP POLICY IF EXISTS "members can read project organization links" ON project_organizations;
CREATE POLICY "members can read project organization links" ON project_organizations
FOR SELECT TO authenticated USING (
    EXISTS (
        SELECT 1 FROM project_memberships membership
        WHERE membership.project_id = project_organizations.project_id
          AND membership.user_id = auth.uid()
          AND membership.active
    )
    OR EXISTS (
        SELECT 1 FROM organization_memberships membership
        WHERE membership.organization_id = project_organizations.organization_id
          AND membership.user_id = auth.uid()
          AND membership.active
    )
);
