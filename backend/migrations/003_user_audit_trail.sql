-- DrillOps user administration and immutable operational audit trail.
-- Apply after 001_auth_and_tenancy.sql and 002_dar_notifications.sql.
-- Safe to run repeatedly.

CREATE SCHEMA IF NOT EXISTS drillops_private;
REVOKE ALL ON SCHEMA drillops_private FROM PUBLIC;

ALTER TABLE audit_events
    ADD COLUMN IF NOT EXISTS request_id UUID,
    ADD COLUMN IF NOT EXISTS request_method TEXT,
    ADD COLUMN IF NOT EXISTS request_path TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_events_actor_created
    ON audit_events(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_action_created
    ON audit_events(action, created_at DESC);

CREATE TABLE IF NOT EXISTS import_batches (
    id            BIGSERIAL PRIMARY KEY,
    actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    filename      TEXT NOT NULL,
    import_kind   TEXT NOT NULL,
    contractor    TEXT NOT NULL DEFAULT '',
    client        TEXT NOT NULL DEFAULT '',
    project       TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'imported'
                  CHECK (status IN ('imported', 'skipped', 'failed')),
    row_counts    JSONB NOT NULL DEFAULT '{}'::jsonb,
    details       JSONB NOT NULL DEFAULT '{}'::jsonb,
    request_id    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_batches_created
    ON import_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batches_actor_created
    ON import_batches(actor_user_id, created_at DESC);

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

-- These are the human-facing ownership columns used throughout the portal.
-- The trigger fills them from the verified access-token subject placed in the
-- transaction by FastAPI; callers never provide these values themselves.
DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'activities', 'consumables', 'crew', 'contractors', 'clients',
        'projects', 'cost_contracts', 'cost_contract_rates', 'project_budgets',
        'cost_centre_forecasts', 'invoices', 'invoice_lines',
        'invoice_attachments', 'boreholes', 'purchase_orders', 'drilling_rates',
        'hourly_rates', 'consumable_rates', 'report_approvals',
        'activity_sheet_locks', 'minimum_shift_topup_preferences'
    ]
    LOOP
        IF to_regclass('public.' || table_name) IS NOT NULL THEN
            EXECUTE format(
                'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL',
                table_name
            );
            EXECUTE format(
                'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL',
                table_name
            );
            EXECUTE format(
                'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ',
                table_name
            );
            EXECUTE format(
                'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ',
                table_name
            );
        END IF;
    END LOOP;
END;
$$;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['imported_files', 'source_files', 'invoice_imports']
    LOOP
        IF to_regclass('public.' || table_name) IS NOT NULL THEN
            EXECUTE format(
                'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS imported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL',
                table_name
            );
            EXECUTE format(
                'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ',
                table_name
            );
        END IF;
    END LOOP;
END;
$$;

-- Preserve reliable dates for historic source-file imports. Older invoice
-- markers did not retain a timestamp, so they intentionally remain unknown.
UPDATE source_files
SET imported_at=uploaded_at
WHERE imported_at IS NULL AND uploaded_at IS NOT NULL;

UPDATE imported_files AS marker
SET imported_at=source.uploaded_at
FROM source_files AS source
WHERE marker.imported_at IS NULL
  AND source.filename=marker.filename
  AND source.contractor IS NOT DISTINCT FROM marker.contractor
  AND source.uploaded_at IS NOT NULL;

CREATE OR REPLACE FUNCTION drillops_private.current_actor_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    actor_text TEXT;
BEGIN
    actor_text := NULLIF(current_setting('app.actor_user_id', TRUE), '');
    IF actor_text IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN actor_text::UUID;
EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION drillops_private.stamp_operational_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    actor_id UUID := drillops_private.current_actor_id();
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.created_by := COALESCE(NEW.created_by, actor_id);
        NEW.updated_by := COALESCE(NEW.updated_by, actor_id);
        NEW.created_at := COALESCE(NEW.created_at, NOW());
        NEW.updated_at := COALESCE(NEW.updated_at, NEW.created_at, NOW());
    ELSE
        NEW.created_by := COALESCE(NEW.created_by, OLD.created_by);
        NEW.created_at := COALESCE(NEW.created_at, OLD.created_at);
        NEW.updated_by := COALESCE(actor_id, NEW.updated_by, OLD.updated_by);
        NEW.updated_at := NOW();
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION drillops_private.stamp_import_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.imported_by := COALESCE(NEW.imported_by, drillops_private.current_actor_id());
    NEW.imported_at := COALESCE(NEW.imported_at, NOW());
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION drillops_private.capture_operational_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    actor_id       UUID := drillops_private.current_actor_id();
    request_id     UUID;
    request_method TEXT := NULLIF(current_setting('app.request_method', TRUE), '');
    request_path   TEXT := NULLIF(current_setting('app.request_path', TRUE), '');
    before_row     JSONB := '{}'::jsonb;
    after_row      JSONB := '{}'::jsonb;
    changes        JSONB := '{}'::jsonb;
    row_key        TEXT;
    linked_project INTEGER;
    request_text   TEXT := NULLIF(current_setting('app.request_id', TRUE), '');
BEGIN
    IF request_text IS NOT NULL THEN
        BEGIN
            request_id := request_text::UUID;
        EXCEPTION WHEN invalid_text_representation THEN
            request_id := NULL;
        END;
    END IF;

    -- Bulk source imports get one concise import_batches entry from the API.
    -- Do not generate hundreds of near-identical INSERT audit rows for them.
    IF TG_OP = 'INSERT' AND request_path IN (
        '/import', '/import/ocr', '/invoices/import', '/boreholes/import_budget'
    ) THEN
        RETURN NULL;
    END IF;

    -- Attachment payloads can be many megabytes. Audit their metadata without
    -- ever converting the binary file_data column to JSON.
    IF TG_TABLE_NAME = 'invoice_attachments' THEN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
            before_row := jsonb_build_object(
                'id', OLD.id,
                'invoice_id', OLD.invoice_id,
                'filename', OLD.filename,
                'content_type', OLD.content_type,
                'file_size', OLD.file_size,
                'uploaded_at', OLD.uploaded_at
            );
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            after_row := jsonb_build_object(
                'id', NEW.id,
                'invoice_id', NEW.invoice_id,
                'filename', NEW.filename,
                'content_type', NEW.content_type,
                'file_size', NEW.file_size,
                'uploaded_at', NEW.uploaded_at
            );
        END IF;
    ELSE
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
            before_row := to_jsonb(OLD) - ARRAY[
                'pdf_data', 'file_data', 'created_by', 'updated_by',
                'created_at', 'updated_at'
            ];
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            after_row := to_jsonb(NEW) - ARRAY[
                'pdf_data', 'file_data', 'created_by', 'updated_by',
                'created_at', 'updated_at'
            ];
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        SELECT COALESCE(
            jsonb_object_agg(
                item.key,
                jsonb_build_object('from', before_row -> item.key, 'to', item.value)
            ),
            '{}'::jsonb
        )
        INTO changes
        FROM jsonb_each(after_row) AS item
        WHERE before_row -> item.key IS DISTINCT FROM item.value;

        IF changes = '{}'::jsonb THEN
            RETURN NULL;
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        changes := after_row;
    ELSE
        changes := before_row;
    END IF;

    row_key := COALESCE(
        after_row ->> 'id', before_row ->> 'id',
        after_row ->> 'hole_id', before_row ->> 'hole_id',
        after_row ->> 'name', before_row ->> 'name',
        after_row ->> 'filename', before_row ->> 'filename',
        after_row ->> 'report_date', before_row ->> 'report_date',
        'unknown'
    );

    IF COALESCE(after_row ->> 'project_id', before_row ->> 'project_id', '') ~ '^[0-9]+$' THEN
        linked_project := COALESCE(after_row ->> 'project_id', before_row ->> 'project_id')::INTEGER;
    ELSIF COALESCE(after_row ->> 'project', before_row ->> 'project', '') <> '' THEN
        SELECT project.id
        INTO linked_project
        FROM public.projects AS project
        WHERE LOWER(project.name) = LOWER(COALESCE(after_row ->> 'project', before_row ->> 'project'))
        ORDER BY project.id
        LIMIT 1;
    END IF;

    INSERT INTO public.audit_events (
        actor_user_id, project_id, action, entity_type, entity_key, details,
        request_id, request_method, request_path
    )
    VALUES (
        actor_id,
        linked_project,
        TG_TABLE_NAME || '.' || LOWER(TG_OP),
        TG_TABLE_NAME,
        row_key,
        jsonb_build_object(
            'changes', changes,
            'before', CASE WHEN TG_OP = 'DELETE' THEN before_row ELSE NULL END,
            'after', CASE WHEN TG_OP = 'INSERT' THEN after_row ELSE NULL END
        ),
        request_id,
        request_method,
        request_path
    );
    RETURN NULL;
END;
$$;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'activities', 'consumables', 'crew', 'contractors', 'clients',
        'projects', 'cost_contracts', 'cost_contract_rates', 'project_budgets',
        'cost_centre_forecasts', 'invoices', 'invoice_lines',
        'invoice_attachments', 'boreholes', 'purchase_orders', 'drilling_rates',
        'hourly_rates', 'consumable_rates', 'report_approvals',
        'activity_sheet_locks', 'minimum_shift_topup_preferences'
    ]
    LOOP
        IF to_regclass('public.' || table_name) IS NOT NULL THEN
            EXECUTE format('DROP TRIGGER IF EXISTS drillops_stamp_actor ON public.%I', table_name);
            EXECUTE format(
                'CREATE TRIGGER drillops_stamp_actor BEFORE INSERT OR UPDATE ON public.%I '
                'FOR EACH ROW EXECUTE FUNCTION drillops_private.stamp_operational_actor()',
                table_name
            );
            EXECUTE format('DROP TRIGGER IF EXISTS drillops_capture_change ON public.%I', table_name);
            EXECUTE format(
                'CREATE TRIGGER drillops_capture_change AFTER INSERT OR UPDATE OR DELETE ON public.%I '
                'FOR EACH ROW EXECUTE FUNCTION drillops_private.capture_operational_change()',
                table_name
            );
        END IF;
    END LOOP;
END;
$$;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['imported_files', 'source_files', 'invoice_imports']
    LOOP
        IF to_regclass('public.' || table_name) IS NOT NULL THEN
            EXECUTE format('DROP TRIGGER IF EXISTS drillops_stamp_import_actor ON public.%I', table_name);
            EXECUTE format(
                'CREATE TRIGGER drillops_stamp_import_actor BEFORE INSERT ON public.%I '
                'FOR EACH ROW EXECUTE FUNCTION drillops_private.stamp_import_actor()',
                table_name
            );
        END IF;
    END LOOP;
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA drillops_private FROM PUBLIC;
