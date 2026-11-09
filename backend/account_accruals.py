"""Editable uninvoiced estimates, kept separate from invoice actuals."""
from datetime import date
from decimal import Decimal, InvalidOperation
from fastapi import APIRouter, HTTPException, Request
from psycopg2.errors import UniqueViolation
from audit import record_audit_event
from security import current_auth_user

SCHEMA = """
CREATE TABLE IF NOT EXISTS account_accruals (
 id BIGSERIAL PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES projects(id),
 supplier TEXT NOT NULL,po_id INTEGER REFERENCES purchase_orders(id),po_number TEXT NOT NULL DEFAULT '',
 period DATE NOT NULL CHECK(extract(day FROM period)=1),amount NUMERIC(16,2) NOT NULL CHECK(amount>0),
 status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Cleared','Voided')),
 description TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS account_accrual_open_identity ON account_accruals(project_id,lower(trim(supplier)),period,COALESCE(po_id,0)) WHERE status='Open';
ALTER TABLE account_accruals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_accruals FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE account_accruals_id_seq FROM PUBLIC,anon,authenticated;
"""
READ_SQL = """SELECT a.*,p.name project,p.program,p.year FROM account_accruals a JOIN projects p ON p.id=a.project_id"""

def ensure_accrual_schema(get_conn):
    with get_conn() as conn:
        with conn.cursor() as cur:cur.execute(SCHEMA)

def values(p):
    try:
        pid=int(p['project_id']);period=date.fromisoformat(str(p['period'])+'-01')
        amount=Decimal(str(p['amount']))
        if not amount.is_finite() or amount<=0 or amount>=Decimal('100000000000000'):raise ValueError()
        amount=amount.quantize(Decimal('.01'))
        if amount<=0:raise ValueError()
        po_id=int(p['po_id']) if p.get('po_id') else None
        if pid<=0 or (po_id is not None and po_id<=0):raise ValueError()
    except (KeyError,ValueError,TypeError,InvalidOperation):raise HTTPException(400,'Choose a project, month and positive amount.')
    supplier=str(p.get('supplier') or '').strip();description=str(p.get('description') or '').strip();status=p.get('status','Open')
    if not supplier or len(supplier)>200 or len(description)>2000 or status not in ('Open','Cleared'):raise HTTPException(400,'Check the supplier, status and description.')
    return dict(project_id=pid,period=period,amount=amount,po_id=po_id,supplier=supplier,description=description,status=status)

def create_accrual_router(get_conn):
    router=APIRouter(prefix='/account-accruals')
    def authorize(request):
        auth=current_auth_user(request)
        if not auth.owner and 'account' not in auth.apps:raise HTTPException(403,'Accounts access required.')
        return auth
    @router.get('/project-summary')
    def project_summary(project_id:int,request:Request):
        auth=current_auth_user(request)
        if not auth.owner and not set(auth.apps)&{'account','project'}:raise HTTPException(403,'Project access required.')
        with get_conn(read_only=True) as conn:
            with conn.cursor() as cur:
                cur.execute("""SELECT p.id,
                  COALESCE((SELECT sum(i.subtotal) FROM invoices i WHERE lower(trim(i.project))=lower(trim(p.name)) AND lower(trim(i.program))=lower(trim(p.program))),0) invoiced,
                  COALESCE((SELECT sum(a.amount) FROM account_accruals a WHERE a.project_id=p.id AND a.status='Open' AND left(a.period::text,4)=p.year::text),0) accruals,
                  (SELECT count(*) FROM invoices i WHERE lower(trim(i.project))=lower(trim(p.name)) AND lower(trim(i.program))=lower(trim(p.program)) AND i.subtotal IS NULL) missing_amounts
                  FROM projects p WHERE p.id=%s""",(project_id,));row=cur.fetchone()
                if not row:raise HTTPException(404,'Project not found.')
                return dict(row,combined=row['invoiced']+row['accruals'])
    @router.get('')
    def read(request:Request):
        """Read accruals and purchase order descriptions for monthly planning."""
        authorize(request)
        with get_conn(read_only=True) as conn:
            with conn.cursor() as cur:
                cur.execute(READ_SQL+" WHERE a.status<>'Voided' ORDER BY a.period DESC,a.supplier,a.id");rows=cur.fetchall()
                cur.execute('SELECT id,name,program,year FROM projects ORDER BY name,year,program');projects=cur.fetchall()
                cur.execute("SELECT name FROM contractors UNION SELECT contractor FROM invoices WHERE contractor<>'' UNION SELECT contractor FROM purchase_orders WHERE contractor<>'' ORDER BY 1");suppliers=[r['name'] for r in cur.fetchall()]
                cur.execute('SELECT id,po_number,contractor,project,program,status,po_value,description FROM purchase_orders ORDER BY po_number');pos=cur.fetchall()
                return dict(accruals=rows,projects=projects,suppliers=suppliers,pos=pos)
    @router.post('')
    async def save(request:Request):
        auth=authorize(request)
        try:p=await request.json()
        except Exception:raise HTTPException(400,'Invalid form.')
        if not isinstance(p,dict):raise HTTPException(400,'Invalid form.')
        v=values(p)
        try:
            rid=int(p['id']) if p.get('id') else None;revision=int(p.get('revision',0))
        except (ValueError,TypeError):raise HTTPException(400,'Invalid record.')
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    before=None
                    if rid:
                        cur.execute('SELECT * FROM account_accruals WHERE id=%s FOR UPDATE',(rid,));before=cur.fetchone()
                        if not before or before['status']=='Voided':raise HTTPException(404,'Accrual not found.')
                        if before['revision']!=revision:raise HTTPException(409,'This accrual changed. Refresh before editing.')
                    cur.execute('SELECT name,program FROM projects WHERE id=%s',(v['project_id'],));project=cur.fetchone()
                    if not project:raise HTTPException(400,'Project not found.')
                    v['po_number']=''
                    if v['po_id']:
                        cur.execute('SELECT * FROM purchase_orders WHERE id=%s',(v['po_id'],));po=cur.fetchone()
                        if not po:raise HTTPException(400,'Purchase order not found.')
                        if (not before or before['po_id']!=v['po_id']) and str(po['status']).lower() not in ('active','open','approved'):raise HTTPException(400,'Choose an open purchase order.')
                        if any(str(po.get(k) or '').strip().lower()!=str(project.get('name' if k=='project' else k) or '').strip().lower() for k in ('project','program')):raise HTTPException(400,'The purchase order belongs to another project.')
                        v['supplier']=po['contractor'];v['po_number']=po['po_number']
                    else:
                        cur.execute('SELECT 1 FROM contractors WHERE name=%s UNION ALL SELECT 1 FROM invoices WHERE contractor=%s UNION ALL SELECT 1 FROM purchase_orders WHERE contractor=%s LIMIT 1',(v['supplier'],)*3)
                        if not cur.fetchone():raise HTTPException(400,'Choose an existing supplier.')
                    columns=list(v)
                    if rid:cur.execute('UPDATE account_accruals SET '+','.join(k+'=%s' for k in columns)+',revision=revision+1,updated_at=now() WHERE id=%s RETURNING *',[v[k] for k in columns]+[rid])
                    else:cur.execute('INSERT INTO account_accruals ('+','.join(columns)+') VALUES ('+','.join(['%s']*len(columns))+') RETURNING *',[v[k] for k in columns])
                    row=cur.fetchone();record_audit_event(cur,actor_user_id=auth.user_id,project_id=row['project_id'],action='accrual.save',entity_type='account_accrual',entity_key=str(row['id']),details={'before':{k:str(x) for k,x in (before or {}).items()},'after':{k:str(x) for k,x in row.items()}})
                    return row
        except UniqueViolation:raise HTTPException(409,'An open accrual already exists for this supplier or PO in this month. Edit that entry.')
    @router.delete('/{rid}')
    def remove(rid:int,revision:int,request:Request):
        auth=authorize(request)
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE account_accruals SET status='Voided',revision=revision+1,updated_at=now() WHERE id=%s AND revision=%s AND status<>'Voided' RETURNING *",(rid,revision));row=cur.fetchone()
                if not row:raise HTTPException(409,'This accrual changed. Refresh before removing it.')
                record_audit_event(cur,actor_user_id=auth.user_id,project_id=row['project_id'],action='accrual.remove',entity_type='account_accrual',entity_key=str(rid),details={'amount':str(row['amount']),'revision':row['revision']})
                return {'removed':True}
    return router
