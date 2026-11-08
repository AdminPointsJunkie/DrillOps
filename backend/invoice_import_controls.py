"""Validate explicit import destinations and detect duplicates before inserting."""
import hashlib
import re

def normalise(value):
    return re.sub(r'\s+', '', str(value or '')).lower()

def destination(cur, project_id, po_id):
    cur.execute('SELECT id,name,program,year FROM projects WHERE id=%s', (project_id,))
    project = cur.fetchone()
    cur.execute('SELECT id,po_number,contractor,project,program FROM purchase_orders WHERE id=%s', (po_id,))
    po = cur.fetchone()
    if not project or not po:
        raise ValueError('Choose an existing project and purchase order.')
    if normalise(project['name']) != normalise(po['project']) or normalise(project['program']) != normalise(po['program']):
        raise ValueError('The purchase order does not belong to the selected project and program.')
    return {'contractor':po['contractor'], 'project':project['name'], 'program':project['program'], 'po_reference':po['po_number']}

def find_duplicate(cur, contractor, invoice_number, content):
    # Serialize identical PDFs and imports for the same supplier, including renamed uploads.
    for key in ['invoice-pdf:'+hashlib.sha256(content).hexdigest(), 'invoice-supplier:'+normalise(contractor)]:
        cur.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', (key,))
    cur.execute(r"""
        SELECT id,invoice_number,contractor,project,program,po_reference
        FROM invoices
        WHERE (%s<>'' AND regexp_replace(lower(COALESCE(contractor,'')), '\s+', '', 'g')=%s
           AND regexp_replace(lower(COALESCE(invoice_number,'')), '\s+', '', 'g')=%s)
           OR pdf_data=%s
        ORDER BY id LIMIT 1
    """, (normalise(invoice_number),normalise(contractor),normalise(invoice_number),content))
    row=cur.fetchone()
    return dict(row) if row else None
