"""Project lab samples and EOS day-rate planning; privileged API only."""
from datetime import date
from decimal import Decimal, InvalidOperation
from fastapi import APIRouter, HTTPException, Request
from psycopg2.extras import Json
from psycopg2.errors import UniqueViolation
from security import current_auth_user
from audit import record_audit_event
from eos_time_register import load_register

SCHEMA = """
CREATE TABLE IF NOT EXISTS lab_rates (
 id BIGSERIAL PRIMARY KEY, lab TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('Gas','Geotech','CQ')),
 test_name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'sample', unit_price NUMERIC(14,2) NOT NULL CHECK(unit_price>=0),
 active BOOLEAN NOT NULL DEFAULT TRUE, revision INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS lab_rates_identity ON lab_rates(lower(trim(lab)),category,lower(trim(test_name)),lower(trim(unit)));
CREATE TABLE IF NOT EXISTS lab_samples (
 id BIGSERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), sample_id TEXT NOT NULL, hole_id TEXT NOT NULL DEFAULT '',
 category TEXT NOT NULL CHECK(category IN ('Gas','Geotech','CQ')), lab TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Collected',
 taken_on DATE, sent_on DATE, due_on DATE, results_on DATE, result_reference TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
 tests JSONB NOT NULL DEFAULT '[]', projected_cost NUMERIC(16,2), revision INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS lab_samples_identity ON lab_samples(project_id,lower(trim(sample_id)));
CREATE TABLE IF NOT EXISTS day_rate_rosters (
 id BIGSERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), contractor TEXT NOT NULL, person TEXT NOT NULL,
 effective_from DATE NOT NULL, effective_to DATE, anchor_date DATE NOT NULL, days_on INTEGER NOT NULL CHECK(days_on BETWEEN 1 AND 90),
 days_off INTEGER NOT NULL CHECK(days_off BETWEEN 0 AND 90), day_rate NUMERIC(14,2) NOT NULL CHECK(day_rate>=0),
 revision INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(effective_to IS NULL OR effective_to>=effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS day_rate_roster_identity ON day_rate_rosters(project_id,lower(trim(contractor)),lower(trim(person)),effective_from);
CREATE TABLE IF NOT EXISTS day_rate_days (
 id BIGSERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), contractor TEXT NOT NULL, person TEXT NOT NULL, work_date DATE NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('Planned','Worked','Not working')), units NUMERIC(6,3) NOT NULL CHECK(units>=0 AND units<=2),
 day_rate NUMERIC(14,2) NOT NULL CHECK(day_rate>=0), notes TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS day_rate_days_identity ON day_rate_days(project_id,lower(trim(contractor)),lower(trim(person)),work_date);
ALTER TABLE day_rate_rosters ADD COLUMN IF NOT EXISTS follow_contractor TEXT NOT NULL DEFAULT '';
ALTER TABLE day_rate_rosters ADD COLUMN IF NOT EXISTS follow_rig TEXT NOT NULL DEFAULT '';
ALTER TABLE day_rate_rosters ADD COLUMN IF NOT EXISTS allocation_default TEXT NOT NULL DEFAULT 'project';
ALTER TABLE day_rate_days ADD COLUMN IF NOT EXISTS allocation_locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE day_rate_days ADD COLUMN IF NOT EXISTS allocated_project_id INTEGER REFERENCES projects(id);
ALTER TABLE day_rate_days ADD COLUMN IF NOT EXISTS allocation_site TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_rate_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_rate_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lab_rates,lab_samples,day_rate_rosters,day_rate_days FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE lab_rates_id_seq,lab_samples_id_seq,day_rate_rosters_id_seq,day_rate_days_id_seq FROM PUBLIC,anon,authenticated;
"""

def ensure_tracking_schema(get_conn):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)

CATEGORIES = {'Gas','Geotech','CQ'}
STATUSES = {'Collected','Dispatched','Received by lab','Testing','Results received','Reviewed','Cancelled'}

def text(payload, key, required=False, maximum=500):
    value=payload.get(key, '')
    if not isinstance(value,str) or len(value.strip())>maximum:
        raise HTTPException(400, f'Invalid {key}.')
    value=value.strip()
    if required and not value: raise HTTPException(400,f'Enter {key.replace("_"," ")}.')
    return value

def day(value, required=False):
    if not value and not required:return None
    try:return date.fromisoformat(value).isoformat()
    except (ValueError,TypeError):raise HTTPException(400,'Enter a valid date.')

def amount(value, maximum='1000000000', minimum='0'):
    try:
        value=Decimal(str(value))
        if not value.is_finite() or value<Decimal(minimum) or value>Decimal(maximum):raise ValueError()
        return value
    except (ValueError,InvalidOperation):raise HTTPException(400,'Enter a valid non-negative amount or quantity.')

def integer(value, minimum=1, maximum=2147483647):
    try:
        if isinstance(value,bool) or str(int(value))!=str(value):raise ValueError()
        result=int(value)
        if not minimum<=result<=maximum:raise ValueError()
        return result
    except (ValueError,TypeError):raise HTTPException(400,'Invalid record identifier or day count.')

def sample_values(payload):
    category=text(payload,'category',True)
    status=text(payload,'status',True)
    if category not in CATEGORIES or status not in STATUSES:raise HTTPException(400,'Choose a sample category and status.')
    v={k:text(payload,k,k=='sample_id',4000 if k=='notes' else 500) for k in ['sample_id','hole_id','lab','result_reference','notes']}
    v.update(category=category,status=status)
    for k in ['taken_on','sent_on','due_on','results_on']:v[k]=day(payload.get(k))
    if v['taken_on'] and any(v[k] and v[k]<v['taken_on'] for k in ['sent_on','results_on']):raise HTTPException(400,'Dispatch and results cannot precede sampling.')
    if status in {'Results received','Reviewed'} and not v['results_on']:raise HTTPException(400,'Enter the results received date.')
    return v

def price_tests(items, rates, lab, category, previous=()):
    if not isinstance(items,list) or len(items)>100:raise HTTPException(400,'Invalid test selection.')
    saved={int(r['rate_id']):r for r in previous};seen=set();result=[]
    for item in items:
        if not isinstance(item,dict):raise HTTPException(400,'Invalid test.')
        rid=integer(item.get('rate_id'))
        if rid in seen:raise HTTPException(400,'Select each test once; use quantity for repeated tests.')
        seen.add(rid);qty=amount(item.get('quantity'),'1000000','0.001')
        old=saved.get(rid)
        if old and old.get('lab')==lab and old.get('category')==category:rate=old
        else:
            rate=rates.get(rid)
            if not rate or not rate['active'] or rate['lab']!=lab or rate['category']!=category:raise HTTPException(400,'Choose active rates from the selected lab and category.')
        unit=amount(rate['unit_price']);total=(qty*unit).quantize(Decimal('0.01'))
        result.append({'rate_id':rid,'lab':lab,'category':category,'test_name':rate['test_name'],'unit':rate['unit'],'unit_price':str(unit),'quantity':str(qty),'total':str(total)})
    total=sum((Decimal(r['total']) for r in result),Decimal('0')) if result else None
    if total is not None:amount(total,'99999999999999.99')
    return result,total

async def payload(request):
    try:
        value = await request.json()
    except ValueError:
        raise HTTPException(400, 'Invalid request data.')
    if not isinstance(value, dict):
        raise HTTPException(400, 'Invalid request data.')
    return value

def create_tracking_router(get_conn):
    router=APIRouter(tags=['project tracking'])
    def access(cur,request,project_id=None):
        auth=current_auth_user(request)
        cur.execute("SELECT 1 FROM user_profiles WHERE user_id=%s AND active=TRUE AND system_role='system_admin'",(auth.user_id,))
        if not cur.fetchone() and not (getattr(auth,'owner',False) or set(getattr(auth,'apps',())) & {'eos','project'}):raise HTTPException(403,'App access is required.')
        if project_id is not None:
            cur.execute('SELECT id,name,program FROM projects WHERE id=%s',(project_id,));project=cur.fetchone()
            if not project:raise HTTPException(404,'Project not found.')
            return project
    def existing(cur,table,rid,revision,project_id=None):
        query=f'SELECT * FROM {table} WHERE id=%s';params=[rid]
        if project_id is not None:query+=' AND project_id=%s';params.append(project_id)
        cur.execute(query+' FOR UPDATE',params);row=cur.fetchone()
        if not row:raise HTTPException(404,'Record not found in this project.')
        if row['revision']!=integer(revision):raise HTTPException(409,'This record changed. Refresh before editing again.')
        return row
    def persist(cur,table,values,rid=None):
        keys=list(values)
        if rid:
            cur.execute(f'UPDATE {table} SET '+','.join(k+'=%s' for k in keys)+',revision=revision+1,updated_at=NOW() WHERE id=%s RETURNING *',[values[k] for k in keys]+[rid])
        else:cur.execute(f'INSERT INTO {table} ('+','.join(keys)+') VALUES ('+','.join(['%s']*len(keys))+') RETURNING *',[values[k] for k in keys])
        return cur.fetchone()
    def audit(cur,row,kind):record_audit_event(cur,action='save',entity_type=kind,entity_key=str(row['id']),project_id=row.get('project_id'),details={'revision':row['revision']})

    @router.get('/project-labs')
    def labs(request:Request,project_id:int):
        with get_conn() as conn:
            with conn.cursor() as cur:
                access(cur,request,project_id)
                cur.execute('SELECT * FROM lab_samples WHERE project_id=%s ORDER BY taken_on DESC NULLS LAST,id DESC',(project_id,));samples=cur.fetchall()
                cur.execute('SELECT * FROM lab_rates ORDER BY lab,category,test_name');rates=cur.fetchall()
                return {'samples':samples,'rates':rates}

    @router.post('/project-labs/rates')
    async def save_rate(request:Request):
        p=await payload(request);rid=integer(p['id']) if p.get('id') else None
        v={k:text(p,k,True,200) for k in ['lab','category','test_name','unit']}
        if v['category'] not in CATEGORIES:raise HTTPException(400,'Choose a category.')
        if not isinstance(p.get('active',True),bool):raise HTTPException(400,'Invalid active setting.')
        v.update(unit_price=amount(p.get('unit_price')).quantize(Decimal('0.01')),active=p.get('active',True))
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    access(cur,request)
                    if rid:existing(cur,'lab_rates',rid,p.get('revision'))
                    row=persist(cur,'lab_rates',v,rid);audit(cur,row,'lab_rate');return row
        except UniqueViolation:raise HTTPException(409,'This lab test and unit already exist. Edit the existing rate.')

    @router.post('/project-labs/samples')
    async def save_sample(request:Request):
        p=await payload(request);pid=integer(p.get('project_id'));rid=integer(p['id']) if p.get('id') else None;v=sample_values(p)
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    project=access(cur,request,pid);old=existing(cur,'lab_samples',rid,p.get('revision'),pid) if rid else None
                    if v['hole_id']:
                        cur.execute('SELECT 1 FROM boreholes WHERE hole_id=%s AND project=%s AND program=%s LIMIT 1',(v['hole_id'],project['name'],project['program']))
                        if not cur.fetchone():raise HTTPException(400,'Choose a hole from the selected project.')
                    cur.execute('SELECT * FROM lab_rates');rates={r['id']:r for r in cur.fetchall()}
                    tests,total=price_tests(p.get('tests',[]),rates,v['lab'],v['category'],old['tests'] if old else [])
                    v.update(project_id=pid,tests=Json(tests),projected_cost=total);row=persist(cur,'lab_samples',v,rid);audit(cur,row,'lab_sample');return row
        except UniqueViolation:raise HTTPException(409,'This sample ID already exists in the project.')

    @router.get('/crew/time-register', description='Personnel dates, reported crew hours and confirmed worked days across EOS projects.')
    def time_register(request:Request):
        with get_conn() as conn:
            with conn.cursor() as cur:
                access(cur,request)
                return load_register(cur)

    @router.get('/day-rate-tracking', description='Includes editable daily project allocations and saved historical locations.')
    def day_rates(request:Request):
        with get_conn() as conn:
            with conn.cursor() as cur:
                access(cur,request);cur.execute('SELECT * FROM day_rate_rosters ORDER BY contractor,person,effective_from');rosters=cur.fetchall()
                cur.execute('SELECT * FROM day_rate_days ORDER BY work_date');days=cur.fetchall()
                cur.execute('SELECT id,name,program,year FROM projects ORDER BY name,year,program');projects=cur.fetchall()
                cur.execute("""SELECT DISTINCT a.date,a.contractor,a.drill_rig,a.project,a.program,
                    COALESCE(NULLIF(a.site_id,''),NULLIF(a.site_name,''),NULLIF(a.location,''),a.hole_num,'') AS site,
                    p.id AS project_id
                    FROM activities a LEFT JOIN projects p ON p.name=a.project AND p.program=a.program AND p.year=left(a.date,4)
                    WHERE EXISTS (SELECT 1 FROM day_rate_rosters r WHERE r.follow_contractor=a.contractor AND r.follow_rig=a.drill_rig)
                    ORDER BY a.date""");locations=cur.fetchall()
                cur.execute("SELECT DISTINCT contractor,drill_rig FROM activities WHERE COALESCE(drill_rig,'')<>'' ORDER BY contractor,drill_rig");rigs=cur.fetchall()
                return {'rosters':rosters,'days':days,'projects':projects,'locations':locations,'rigs':rigs}

    @router.post('/day-rate-tracking/rosters')
    async def save_roster(request:Request):
        p=await payload(request);pid=integer(p.get('project_id'));rid=integer(p['id']) if p.get('id') else None
        v={k:text(p,k,True,200) for k in ['contractor','person']}
        v.update(follow_contractor=text(p,'follow_contractor',False,200),follow_rig=text(p,'follow_rig',False,200))
        if 'allocation_default' in p:
            if p['allocation_default'] not in {'project','unallocated'}:raise HTTPException(400,'Invalid default allocation.')
            v['allocation_default']=p['allocation_default']
        if bool(v['follow_contractor'])!=bool(v['follow_rig']):raise HTTPException(400,'Choose a contractor and rig to follow.')
        v.update(project_id=pid,effective_from=day(p.get('effective_from'),True),effective_to=day(p.get('effective_to')),anchor_date=day(p.get('anchor_date'),True),days_on=integer(p.get('days_on'),1,90),days_off=integer(p.get('days_off'),0,90),day_rate=amount(p.get('day_rate')).quantize(Decimal('0.01')))
        if v['effective_to'] and v['effective_to']<v['effective_from']:raise HTTPException(400,'End date must follow the effective date.')
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    access(cur,request,pid)
                    if rid:
                        existing(cur,'day_rate_rosters',rid,p.get('revision'),pid)
                        if 'follow_contractor' not in p and 'follow_rig' not in p:
                            v.pop('follow_contractor');v.pop('follow_rig')
                    row=persist(cur,'day_rate_rosters',v,rid);audit(cur,row,'day_rate_roster');return row
        except UniqueViolation:raise HTTPException(409,'This person already has a roster version from that date.')

    @router.post('/day-rate-tracking/days')
    async def save_day(request:Request):
        p=await payload(request);pid=integer(p.get('project_id'));rid=integer(p['id']) if p.get('id') else None
        v={k:text(p,k,True,200) for k in ['contractor','person']};status=text(p,'status',True)
        if status not in {'Planned','Worked','Not working'}:raise HTTPException(400,'Choose a day status.')
        v.update(project_id=pid,status=status,work_date=day(p.get('work_date'),True),units=amount(p.get('units'),'2'),day_rate=amount(p.get('day_rate')).quantize(Decimal('0.01')),notes=text(p,'notes',False,4000))
        if status=='Not working':v['units']=Decimal(0)
        if 'allocation_locked' in p:
            if not isinstance(p['allocation_locked'],bool):raise HTTPException(400,'Invalid allocation setting.')
            v.update(allocation_locked=p['allocation_locked'],allocated_project_id=integer(p['allocated_project_id']) if p.get('allocated_project_id') else None,allocation_site=text(p,'allocation_site',False,2000))
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    access(cur,request,pid)
                    if v.get('allocated_project_id'):access(cur,request,v['allocated_project_id'])
                    if rid:existing(cur,'day_rate_days',rid,p.get('revision'),pid)
                    row=persist(cur,'day_rate_days',v,rid);audit(cur,row,'day_rate_day');return row
        except UniqueViolation:raise HTTPException(409,'A day entry already exists. Refresh and edit that entry.')
    return router
