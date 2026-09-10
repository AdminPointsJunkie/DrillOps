"""Administrator-only shared requirements and contractor-scoped training evidence."""
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
SECTION_COLOURS = ('teal', 'blue', 'purple', 'gold', 'sky', 'indigo', 'clay', 'green', 'slate')
LEGACY_SECTION_COLOURS = dict(zip(['Core / Site', 'Drilling', 'Supervisor', 'Driving', 'Gas Testing', 'Lifting', 'Loading Crane'], SECTION_COLOURS))
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
CREATE TABLE IF NOT EXISTS training_configuration (
    id INTEGER PRIMARY KEY CHECK (id=1),
    settings JSONB NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE training_configuration ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON training_configuration FROM PUBLIC, anon, authenticated;
-- Retain old workspaces as a migration backup. Seed once, never overwrite edits.
INSERT INTO training_configuration (id,settings,revision,updated_by)
SELECT 1,settings,revision+1,updated_by FROM training_workspaces
ORDER BY updated_at DESC,contractor LIMIT 1
ON CONFLICT DO NOTHING;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contractors' AND column_name='training_enabled') THEN
        ALTER TABLE contractors ADD COLUMN training_enabled BOOLEAN NOT NULL DEFAULT FALSE;
        UPDATE contractors SET training_enabled=TRUE
        WHERE name IN ('Mitchells Drilling','DEPCO Drilling','MCC Group','Fortem');
    END IF;
END $$;
"""


def ensure_training_schema(get_conn):
    # Like the existing DAR schema, this additive bootstrap runs on deployment.
    # Only the privileged backend connection has access; no Data API policies.
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
            cur.execute('INSERT INTO training_configuration (id,settings) VALUES (1,%s) ON CONFLICT DO NOTHING', (Json(default_settings()),))


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
    evidence_type = column.get('evidenceType') or None
    if evidence_type not in [None, 'qualification', 'site_authorisation', 'voc', 'site_training', 'licence', 'medical', 'transcript', 'other']:
        raise HTTPException(400, 'Choose a valid evidence type.')
    return {key: column[key].strip() for key in ['id', 'label', 'group']} | {
        'aliases': list(dict.fromkeys(a.strip() for a in aliases)),
        'note': str(column.get('note') or '')[:1000],
        'evidenceType': evidence_type,
    }


def training_sections(settings):
    """Keep saved empty sections and infer categories from pre-section settings."""
    sections = [dict(s) for s in settings.get('sections', [])]
    for column in settings['columns']:
        if not any(s['name'] == column['group'] for s in sections):
            name = column['group']
            sections.append({'name': name, 'colour': LEGACY_SECTION_COLOURS.get(name, SECTION_COLOURS[len(sections) % len(SECTION_COLOURS)])})
    return sections


def validate_section_name(name):
    if not isinstance(name, str) or not 0 < len(name.strip()) <= 200 or name.strip().casefold() == 'all training':
        raise HTTPException(400, 'Enter a section name up to 200 characters, other than All training.')
    return name.strip()


def validate_requirements(name, requirements, columns):
    if not isinstance(name, str) or not name.strip() or name.strip() == 'Unassigned' or len(name.strip()) > 60:
        raise HTTPException(400, 'Enter a role name (up to 60 characters).')
    valid_ids = {c['id'] for c in columns}
    if not isinstance(requirements, dict) or any(k not in valid_ids or v not in ['minimum', 'optional', 'na'] for k, v in requirements.items()):
        raise HTTPException(400, 'Invalid training requirements.')
    return name.strip()


def matching_company(company, contractor):
    return contractor.casefold().strip() in [s.casefold().strip() for s in re.split(r'[,;]', company)]


def preserve_individual_evidence(person, previous):
    """A new cardholder snapshot must not remove separately supplied certificates."""
    previous = previous or {}
    person['records'].extend(r for r in previous.get('records', []) if r.get('origin') == 'individual_document')
    if previous.get('documents'):
        person['documents'] = previous['documents']
    return person


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

    def lock_settings(cur):
        cur.execute('SELECT settings,revision FROM training_configuration WHERE id=1 FOR UPDATE')
        return cur.fetchone()

    def save_settings(cur, auth, payload):
        cur.execute('UPDATE training_configuration SET settings=%s,revision=revision+1,updated_by=%s,updated_at=NOW() WHERE id=1', (Json(payload), auth.user_id))

    def check_revision(body, row):
        if body.get('revision') != row['revision']:
            raise HTTPException(409, 'Requirements changed in another session. Reload the page and try again.')

    @router.get('/state')
    def state(request: Request, contractor: str = Query(..., min_length=1, max_length=200)):
        with get_conn(read_only=True) as conn:
            with conn.cursor() as cur:
                scope(cur, request, contractor)
                cur.execute('SELECT settings,revision FROM training_configuration WHERE id=1')
                workspace = cur.fetchone()
                settings = workspace['settings'] if workspace else default_settings()
                cur.execute('SELECT report,role FROM training_cardholders WHERE contractor=%s ORDER BY report->>\'name\'', (contractor,))
                people = [dict(row['report'], role=row['role']) for row in cur.fetchall()]
                cur.execute('SELECT name FROM contractors WHERE active=TRUE AND training_enabled=TRUE ORDER BY name')
                contractors = [row['name'] for row in cur.fetchall()]
        return dict(settings, sections=training_sections(settings), people=people, contractor=contractor, contractors=contractors, revision=workspace['revision'] if workspace else 0, requirementsScope='global')

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
                lock_settings(cur)  # Serialises imports with global role removal and assignment.
                cur.execute("SELECT role,report_date,report,report->>'reportPrintedAt' AS printed_at FROM training_cardholders WHERE contractor=%s AND card_id=%s", (contractor, person['id']))
                old = cur.fetchone()
                old_stamp = (old.get('printed_at') or old['report_date'].isoformat() + 'T00:00') if old and old['report_date'] else ''
                new_stamp = person.get('reportPrintedAt') or (person['reportDate'] + 'T00:00' if person['reportDate'] else '')
                if old_stamp and new_stamp < old_stamp:
                    raise HTTPException(409, 'This report is older than the saved report; the saved snapshot was kept.')
                cur.execute('INSERT INTO training_sources (contractor,source_id,filename,payload,uploaded_by) VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING', (contractor, person['sourceId'], filename, payload, auth.user_id))
                person['role'] = old['role'] if old else 'Unassigned'
                preserve_individual_evidence(person, old.get('report') if old else None)
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
                workspace = lock_settings(cur)
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
                row = lock_settings(cur)
                check_revision(body, row)
                settings = row['settings']
                name = validate_requirements(body.get('name'), body.get('requirements'), settings['columns'])
                if any(r.casefold() == name.casefold() and r != name for r in settings['roles']):
                    raise HTTPException(409, 'A role with this name already exists.')
                settings['roles'][name] = body['requirements']
                save_settings(cur, auth, settings)
                record_audit_event(cur, action='training.requirements_updated', entity_type='training_role', entity_key=name, details={'scope': 'global', 'requirements': body['requirements']})
        return {'ok': True}

    @router.post('/column')
    def update_column(request: Request, body: dict, contractor: str = Query(..., min_length=1, max_length=200)):
        column = validate_column(body.get('column'))
        with get_conn() as conn:
            with conn.cursor() as cur:
                auth = scope(cur, request, contractor)
                row = lock_settings(cur)
                check_revision(body, row)
                settings = row['settings']
                sections = training_sections(settings)
                group = validate_section_name(column['group'])
                section = next((s for s in sections if s['name'].casefold() == group.casefold()), None)
                if section:
                    column['group'] = section['name']
                else:
                    if len(sections) >= 100:
                        raise HTTPException(400, 'Maximum of 100 shared training sections.')
                    sections.append({'name': group, 'colour': SECTION_COLOURS[len(sections) % len(SECTION_COLOURS)]})
                settings['sections'] = sections
                old = next((c for c in settings['columns'] if c['id'] == column['id']), None)
                if old:
                    settings['columns'][settings['columns'].index(old)] = column
                else:
                    if len(settings['columns']) >= 200:
                        raise HTTPException(400, 'Maximum of 200 shared training columns.')
                    settings['columns'].append(column)
                save_settings(cur, auth, settings)
                record_audit_event(cur, action='training.mapping_updated', entity_type='training_column', entity_key=column['id'], details={'scope': 'global', 'column': column})
        return {'ok': True}

    @router.post('/section')
    def update_section(request: Request, body: dict, contractor: str = Query(..., min_length=1, max_length=200)):
        name = validate_section_name(body.get('name'))
        colour = body.get('colour')
        if colour not in SECTION_COLOURS:
            raise HTTPException(400, 'Choose a section colour.')
        with get_conn() as conn:
            with conn.cursor() as cur:
                auth = scope(cur, request, contractor)
                row = lock_settings(cur)
                check_revision(body, row)
                settings = row['settings']
                sections = training_sections(settings)
                previous = body.get('previousName')
                old = next((s for s in sections if s['name'] == previous), None)
                if previous is not None and old is None:
                    raise HTTPException(404, 'Section not found. Reload the page and try again.')
                if any(s is not old and s['name'].casefold() == name.casefold() for s in sections):
                    raise HTTPException(409, 'A section with this name already exists.')
                if old:
                    old.update(name=name, colour=colour)
                    for column in settings['columns']:
                        if column['group'] == previous:
                            column['group'] = name
                else:
                    if len(sections) >= 100:
                        raise HTTPException(400, 'Maximum of 100 shared training sections.')
                    sections.append({'name': name, 'colour': colour})
                settings['sections'] = sections
                save_settings(cur, auth, settings)
                record_audit_event(cur, action='training.section_updated', entity_type='training_section', entity_key=name, details={'scope': 'global', 'previous_name': previous, 'colour': colour})
        return {'ok': True}

    @router.post('/order')
    def update_order(request: Request, body: dict, contractor: str = Query(..., min_length=1, max_length=200)):
        with get_conn() as conn:
            with conn.cursor() as cur:
                auth = scope(cur, request, contractor)
                row = lock_settings(cur)
                check_revision(body, row)
                settings = row['settings']
                sections = {s['name']: s for s in training_sections(settings)}
                columns = {c['id']: c for c in settings['columns']}
                for key, existing in [('sections', sections), ('columns', columns)]:
                    order = body.get(key)
                    if not isinstance(order, list) or not all(isinstance(v, str) for v in order) or len(order) != len(existing) or set(order) != set(existing):
                        raise HTTPException(400, 'Include every section and training column exactly once when reordering.')
                settings['sections'] = [sections[name] for name in body['sections']]
                settings['columns'] = [columns[id] for id in body['columns']]
                save_settings(cur, auth, settings)
                record_audit_event(cur, action='training.order_updated', entity_type='training_configuration', entity_key='1', details={'scope': 'global', 'sections': body['sections'], 'columns': body['columns']})
        return {'ok': True}

    @router.delete('/role')
    def remove_role(request: Request, body: dict, contractor: str = Query(..., min_length=1, max_length=200)):
        with get_conn() as conn:
            with conn.cursor() as cur:
                auth = scope(cur, request, contractor)
                row = lock_settings(cur)
                check_revision(body, row)
                name = body.get('name')
                if not isinstance(name, str) or name not in row['settings']['roles']:
                    raise HTTPException(404, 'Role not found in the shared role list.')
                settings = row['settings']
                previous = settings['roles'].pop(name)
                cur.execute("UPDATE training_cardholders SET role='Unassigned',updated_by=%s,updated_at=NOW() WHERE role=%s", (auth.user_id, name))
                reassigned = cur.rowcount
                save_settings(cur, auth, settings)
                record_audit_event(cur, action='training.role_removed', entity_type='training_role', entity_key=name, details={'scope': 'global', 'previous_requirements': previous, 'personnel_moved_to_unassigned': reassigned})
        return {'ok': True, 'reassigned': reassigned}

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
