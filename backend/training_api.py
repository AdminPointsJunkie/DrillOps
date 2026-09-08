"""Administrator-only, contractor-scoped training evidence and requirements."""
import json
import re
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from psycopg2.extras import Json

from audit import record_audit_event, record_import_batch
from security import current_auth_user
from training_parser import parse_report

MAX_REPORT_BYTES = 20 * 1024 * 1024
SCHEMA = """
CREATE TABLE IF NOT EXISTS training_workspaces (
    contractor TEXT PRIMARY KEY,
    settings JSONB NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS training_sources (
    contractor TEXT NOT NULL,
    source_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    payload BYTEA NOT NULL,
    uploaded_by UUID,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (contractor, source_id)
);
CREATE TABLE IF NOT EXISTS training_cardholders (
    contractor TEXT NOT NULL,
    card_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Unassigned',
    report JSONB NOT NULL,
    report_date DATE,
    source_id TEXT NOT NULL,
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (contractor, card_id),
    FOREIGN KEY (contractor, source_id) REFERENCES training_sources (contractor, source_id) ON UPDATE CASCADE
);
ALTER TABLE training_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_cardholders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON training_workspaces, training_sources, training_cardholders FROM PUBLIC, anon, authenticated;
"""


def ensure_training_schema(get_conn):
    # Like the existing DAR schema, this additive bootstrap runs on deployment.
    # Only the privileged backend connection has access; no Data API policies.
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)


def default_settings():
    return {
        'roles': {r: {} for r in ['Driller', 'Offsider', 'Fitter', 'Supervisor']},
        'columns': json.loads((Path(__file__).parent / 'data/training_columns.json').read_text(encoding='utf-8')),
    }


def validate_column(column):
    if not isinstance(column, dict):
        raise HTTPException(400, 'Training column must be an object.')
    for key in ['id', 'label', 'group']:
        if not isinstance(column.get(key), str) or not 0 < len(column[key].strip()) <= 200:
            raise HTTPException(400, 'Enter a training name and category (up to 200 characters).')
    aliases = column.get('aliases')
    if not isinstance(aliases, list) or len(aliases) > 100 or not all(isinstance(a, str) and 0 < len(a.strip()) < 500 for a in aliases):
        raise HTTPException(400, 'Use up to 100 exact competency mappings.')
    return {key: column[key].strip() for key in ['id', 'label', 'group']} | {
        'aliases': list(dict.fromkeys(a.strip() for a in aliases)),
        'note': str(column.get('note') or '')[:1000],
    }


def validate_requirements(name, requirements, columns):
    if not isinstance(name, str) or not name.strip() or name.strip() == 'Unassigned' or len(name.strip()) > 60:
        raise HTTPException(400, 'Enter a role name (up to 60 characters).')
    valid_ids = {c['id'] for c in columns}
    if not isinstance(requirements, dict) or any(k not in valid_ids or v not in ['minimum', 'optional', 'na'] for k, v in requirements.items()):
        raise HTTPException(400, 'Invalid training requirements.')
    return name.strip()


def matching_company(company, contractor):
    return contractor.casefold().strip() in [s.casefold().strip() for s in re.split(r'[,;]', company)]


def create_training_router(get_conn):
    router = APIRouter(prefix='/training', tags=['training'])

    def scope(cur, request, contractor):
        # Defence in depth: do not rely only on the global legacy-route middleware.
        auth = current_auth_user(request)
        cur.execute("SELECT 1 FROM user_profiles WHERE user_id=%s AND active=TRUE AND system_role='system_admin'", (auth.user_id,))
        if not cur.fetchone():
            raise HTTPException(403, 'System administrator access is required.')
        cur.execute('SELECT name FROM contractors WHERE name=%s', (contractor,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, 'Choose an existing contractor workspace.')
        return auth

    def lock_settings(cur, contractor):
        cur.execute('INSERT INTO training_workspaces (contractor,settings,revision) VALUES (%s,%s,0) ON CONFLICT DO NOTHING', (contractor, Json(default_settings())))
        cur.execute('SELECT settings,revision FROM training_workspaces WHERE contractor=%s FOR UPDATE', (contractor,))
        return cur.fetchone()

    def save_settings(cur, contractor, auth, payload, row):
        cur.execute('UPDATE training_workspaces SET settings=%s,revision=revision+1,updated_by=%s,updated_at=NOW() WHERE contractor=%s', (Json(payload), auth.user_id, contractor))

    def check_revision(body, row):
        if body.get('revision') != row['revision']:
            raise HTTPException(409, 'Requirements changed in another session. Reload the page and try again.')

    @router.get('/state')
    def state(request: Request, contractor: str = Query(..., min_length=1, max_length=200)):
        with get_conn(read_only=True) as conn:
            with conn.cursor() as cur:
                scope(cur, request, contractor)
                cur.execute('SELECT settings,revision FROM training_workspaces WHERE contractor=%s', (contractor,))
                workspace = cur.fetchone()
                settings = workspace['settings'] if workspace else default_settings()
                cur.execute('SELECT report,role FROM training_cardholders WHERE contractor=%s ORDER BY report->>\'name\'', (contractor,))
                people = [dict(row['report'], role=row['role']) for row in cur.fetchall()]
                cur.execute('SELECT name FROM contractors ORDER BY name')
                contractors = [row['name'] for row in cur.fetchall()]
        return dict(settings, people=people, contractor=contractor, contractors=contractors, revision=workspace['revision'] if workspace else 0)

    @router.post('/import')
    def import_pdf(request: Request, file: UploadFile = File(...), contractor: str = Query(..., min_length=1, max_length=200)):
        # Authenticate before parsing a potentially expensive document.
        with get_conn(read_only=True) as conn:
            with conn.cursor() as cur:
                auth = scope(cur, request, contractor)
        payload = file.file.read(MAX_REPORT_BYTES + 1)
        if len(payload) > MAX_REPORT_BYTES:
            raise HTTPException(413, 'PDF exceeds the 20 MB limit.')
        filename = (file.filename or 'Cardholder Report.pdf').replace('\\', '/').split('/')[-1][:200]
        try:
            person = parse_report(payload, filename)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        except Exception:
            raise HTTPException(422, 'Could not read this report. Use an unlocked, text-based Cardholder Report.')
        if not matching_company(person['company'], contractor):
            raise HTTPException(422, f"This report lists {person['company'] or 'no company'}. Select that contractor before importing.")
        with get_conn() as conn:
            with conn.cursor() as cur:
                scope(cur, request, contractor)
                lock_settings(cur, contractor)  # Serialises imports and edits in this workspace.
                cur.execute("SELECT role,report_date,report->>'reportPrintedAt' AS printed_at FROM training_cardholders WHERE contractor=%s AND card_id=%s", (contractor, person['id']))
                old = cur.fetchone()
                old_stamp = (old.get('printed_at') or old['report_date'].isoformat() + 'T00:00') if old and old['report_date'] else ''
                new_stamp = person.get('reportPrintedAt') or (person['reportDate'] + 'T00:00' if person['reportDate'] else '')
                if old_stamp and new_stamp < old_stamp:
                    raise HTTPException(409, 'This report is older than the saved report; the saved snapshot was kept.')
                cur.execute('INSERT INTO training_sources (contractor,source_id,filename,payload,uploaded_by) VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING', (contractor, person['sourceId'], filename, payload, auth.user_id))
                person['role'] = old['role'] if old else 'Unassigned'
                cur.execute('''INSERT INTO training_cardholders (contractor,card_id,role,report,report_date,source_id,updated_by)
                    VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (contractor,card_id) DO UPDATE SET
                    report=EXCLUDED.report,report_date=EXCLUDED.report_date,source_id=EXCLUDED.source_id,updated_by=EXCLUDED.updated_by,updated_at=NOW()''',
                    (contractor, person['id'], person['role'], Json(person), person['reportDate'], person['sourceId'], auth.user_id))
                record_import_batch(cur, filename=filename, import_kind='training_cardholder', contractor=contractor, row_counts={'personnel': 1, 'training_records': len(person['records'])}, details={'replaced': bool(old), 'source_id': person['sourceId']})
        return dict(name=person['name'], records=len(person['records']), replaced=bool(old))

    @router.post('/person')
    def assign_role(request: Request, body: dict, contractor: str = Query(..., min_length=1, max_length=200)):
        with get_conn() as conn:
            with conn.cursor() as cur:
                auth = scope(cur, request, contractor)
                workspace = lock_settings(cur, contractor)
                role = body.get('role')
                if role not in [*workspace['settings']['roles'], 'Unassigned']:
                    raise HTTPException(400, 'Unknown role.')
                cur.execute('UPDATE training_cardholders SET role=%s,updated_by=%s,updated_at=NOW() WHERE contractor=%s AND card_id=%s RETURNING card_id', (role, auth.user_id, contractor, str(body.get('id') or '')))
                if not cur.fetchone():
                    raise HTTPException(404, 'Cardholder not found in this workspace.')
                record_audit_event(cur, action='training.role_assigned', entity_type='training_cardholder', entity_key=body['id'], details={'contractor': contractor, 'role': role})
        return {'ok': True}

    @router.post('/role')
    def update_role(request: Request, body: dict, contractor: str = Query(..., min_length=1, max_length=200)):
        with get_conn() as conn:
            with conn.cursor() as cur:
                auth = scope(cur, request, contractor)
                row = lock_settings(cur, contractor)
                check_revision(body, row)
                settings = row['settings']
                name = validate_requirements(body.get('name'), body.get('requirements'), settings['columns'])
                if any(r.casefold() == name.casefold() and r != name for r in settings['roles']):
                    raise HTTPException(409, 'A role with this name already exists.')
                settings['roles'][name] = body['requirements']
                save_settings(cur, contractor, auth, settings, row)
                record_audit_event(cur, action='training.requirements_updated', entity_type='training_role', entity_key=name, details={'contractor': contractor, 'requirements': body['requirements']})
        return {'ok': True}

    @router.post('/column')
    def update_column(request: Request, body: dict, contractor: str = Query(..., min_length=1, max_length=200)):
        column = validate_column(body.get('column'))
        with get_conn() as conn:
            with conn.cursor() as cur:
                auth = scope(cur, request, contractor)
                row = lock_settings(cur, contractor)
                check_revision(body, row)
                settings = row['settings']
                old = next((c for c in settings['columns'] if c['id'] == column['id']), None)
                if old:
                    settings['columns'][settings['columns'].index(old)] = column
                else:
                    if len(settings['columns']) >= 200:
                        raise HTTPException(400, 'Maximum of 200 training columns per workspace.')
                    settings['columns'].append(column)
                save_settings(cur, contractor, auth, settings, row)
                record_audit_event(cur, action='training.mapping_updated', entity_type='training_column', entity_key=column['id'], details={'contractor': contractor, 'column': column})
        return {'ok': True}

    @router.get('/sources/{source_id}')
    def source_pdf(source_id: str, request: Request, contractor: str = Query(..., min_length=1, max_length=200)):
        with get_conn(read_only=True) as conn:
            with conn.cursor() as cur:
                scope(cur, request, contractor)
                cur.execute('SELECT payload FROM training_sources WHERE contractor=%s AND source_id=%s', (contractor, source_id))
                row = cur.fetchone()
                if not row:
                    raise HTTPException(404, 'Source PDF not found in this workspace.')
        return Response(bytes(row['payload']), media_type='application/pdf', headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="Cardholder Report.pdf"'})

    return router
