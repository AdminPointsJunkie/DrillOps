"""Project register imports, history and conservative integration with planning/labs."""
from fastapi import APIRouter,Request,UploadFile,File,Form,HTTPException
from psycopg2.extras import Json,execute_values
from security import current_auth_user
from audit import record_audit_event
from project_register_parser import parse_workbook

SCHEMA="""
CREATE TABLE IF NOT EXISTS project_register_imports (
 id BIGSERIAL PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES projects(id),kind TEXT NOT NULL,
 filename TEXT NOT NULL,sha256 TEXT NOT NULL,summary JSONB NOT NULL,payload JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS project_register_records (
 id BIGSERIAL PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES projects(id),kind TEXT NOT NULL,source_key TEXT NOT NULL,
 sheet TEXT NOT NULL,identifier TEXT NOT NULL,hole_id TEXT,site_id TEXT,year TEXT,record_date DATE,status TEXT,
 fields JSONB NOT NULL,metrics JSONB NOT NULL,source_row INTEGER,import_id BIGINT REFERENCES project_register_imports(id),
 active BOOLEAN NOT NULL DEFAULT TRUE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(project_id,kind,source_key)
);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='lab_rates'::regclass AND conname='lab_rates_category_check' AND pg_get_constraintdef(oid) NOT LIKE '%Spon Comb%') THEN
 ALTER TABLE lab_rates DROP CONSTRAINT lab_rates_category_check;
 ALTER TABLE lab_rates ADD CONSTRAINT lab_rates_category_check CHECK(category IN ('Gas','Geotech','CQ','FI','Spon Comb'));
 END IF;
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='lab_samples'::regclass AND conname='lab_samples_category_check' AND pg_get_constraintdef(oid) NOT LIKE '%Spon Comb%') THEN
 ALTER TABLE lab_samples DROP CONSTRAINT lab_samples_category_check;
 ALTER TABLE lab_samples ADD CONSTRAINT lab_samples_category_check CHECK(category IN ('Gas','Geotech','CQ','FI','Spon Comb'));
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS project_register_scope ON project_register_records(project_id,kind,active);
ALTER TABLE project_register_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_register_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON project_register_records,project_register_imports FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE project_register_records_id_seq,project_register_imports_id_seq FROM PUBLIC,anon,authenticated;
"""
def ensure_register_schema(get_conn):
    with get_conn() as conn:
        with conn.cursor() as cur:cur.execute(SCHEMA)

def access(cur,request,pid):
    auth=current_auth_user(request)
    if not (getattr(auth,'owner',False) or 'project' in getattr(auth,'apps',())):
        cur.execute("SELECT 1 FROM user_profiles WHERE user_id=%s AND active AND system_role='system_admin'",(auth.user_id,))
        if not cur.fetchone():raise HTTPException(403,'Project access required.')
    cur.execute('SELECT id,name,program,year FROM projects WHERE id=%s',(pid,));p=cur.fetchone()
    if not p:raise HTTPException(404,'Project not found.')
    return p

def planner_changes(records,holes,project):
    changes=[];conflicts=[]
    # Only authoritative master rows, current project year and exact hole IDs can update the live planner.
    for r in records:
        if r['kind']!='boreholes' or r['sheet']!='All Holes Final' or r['year']!=str(project['year']):continue
        matches=[h for h in holes if h['hole_id'].upper()==r['hole_id'].upper()]
        if len(matches)!=1:
            if len(matches)>1:conflicts.append(r['hole_id']+': multiple planner records')
            continue
        h=matches[0]
        if str(h.get('status','')).lower()=='cancelled':conflicts.append(r['hole_id']+': cancelled status preserved');continue
        vals={k:r['metrics'][k] for k in ('eoh_depth','total_core') if r['metrics'].get(k) is not None and r['metrics'][k]>=0}
        # Survey coordinates and planned geometry remain intact; actuals are fully retained in the master register.
        raw=r['metrics'].get('rig','').lower();rig='1218' if '1218' in raw else 'DR17' if 'depco' in raw and '17' in raw else None
        if rig:vals['assigned_rig']=rig
        vals={k:v for k,v in vals.items() if h.get(k)!=v}
        if vals:changes.append({'id':h['id'],'hole_id':h['hole_id'],'before':{k:h.get(k) for k in vals},'after':vals})
    return changes,conflicts

def sync_labs(cur,records,project):
    count=0
    for r in records:
        if r['kind']!='samples' or r['year']!=str(project['year']):continue
        for b in r['metrics'].get('batches',[]):
            sample_id=r['hole_id']+' · '+b['category']+' batch'
            ref=r['sheet']+' row '+str(r['source_row'])
            status=b['status'] if b['status']!='Partial results' else 'Testing'
            notes='Imported hole-level sample batch; individual sample IDs and quantities are not provided. '+ref
            if b['report_notes']:notes+='; reports: '+'; '.join(b['report_notes'])
            cur.execute("""INSERT INTO lab_samples(project_id,sample_id,hole_id,category,lab,status,sent_on,results_on,result_reference,notes)
            VALUES (%s,%s,%s,%s,'',%s,%s,%s,%s,%s)
            ON CONFLICT(project_id,(lower(trim(sample_id)))) DO UPDATE SET status=EXCLUDED.status,sent_on=EXCLUDED.sent_on,
            results_on=EXCLUDED.results_on,result_reference=EXCLUDED.result_reference,revision=lab_samples.revision+1,updated_at=NOW()
            WHERE lab_samples.status IS DISTINCT FROM EXCLUDED.status OR lab_samples.sent_on IS DISTINCT FROM EXCLUDED.sent_on
              OR lab_samples.results_on IS DISTINCT FROM EXCLUDED.results_on OR lab_samples.result_reference IS DISTINCT FROM EXCLUDED.result_reference
            RETURNING id""",(project['id'],sample_id,r['hole_id'],b['category'],status,b['sent_on'],b['results_on'],ref,notes))
            if cur.fetchone():count+=1
    return count

def preview(cur,parsed,project):
    cur.execute('SELECT * FROM boreholes WHERE project=%s AND program=%s AND planned_year=%s FOR UPDATE',(project['name'],project['program'],str(project['year'])));holes=cur.fetchall()
    changes,conflicts=planner_changes(parsed['records'],holes,project)
    cur.execute('SELECT source_key,fields,metrics FROM project_register_records WHERE project_id=%s AND kind=%s AND active',(project['id'],parsed['kind']));old={r['source_key']:r for r in cur.fetchall()}
    new=sum(r['source_key'] not in old for r in parsed['records']);changed=sum(r['source_key'] in old and (r['fields']!=old[r['source_key']]['fields'] or r['metrics']!=old[r['source_key']]['metrics']) for r in parsed['records'])
    return {'filename':parsed['filename'],'kind':parsed['kind'],'label':parsed['label'],'records':len(parsed['records']),'new':new,'changed':changed,'unchanged':len(parsed['records'])-new-changed,'sheets':parsed['sheets'],'ignored_sheets':parsed['ignored_sheets'],'warnings':parsed['warnings']+conflicts,'borehole_updates':changes}

def save_import(cur,parsed,project):
    cur.execute('SELECT pg_advisory_xact_lock(%s,%s)',(94732,project['id']))
    summary=preview(cur,parsed,project)
    cur.execute('INSERT INTO project_register_imports(project_id,kind,filename,sha256,summary,payload) VALUES (%s,%s,%s,%s,%s,%s) RETURNING id',(project['id'],parsed['kind'],parsed['filename'],parsed['sha256'],Json(summary),Json(parsed)));iid=cur.fetchone()['id']
    cur.execute('UPDATE project_register_records SET active=FALSE WHERE project_id=%s AND kind=%s AND sheet=ANY(%s)',(project['id'],parsed['kind'],parsed['sheets']))
    values=[(project['id'],r['kind'],r['source_key'],r['sheet'],r['identifier'],r['hole_id'],r['site_id'],r['year'],r['record_date'],r['status'],Json(r['fields']),Json(r['metrics']),r['source_row'],iid) for r in parsed['records']]
    execute_values(cur,"""INSERT INTO project_register_records(project_id,kind,source_key,sheet,identifier,hole_id,site_id,year,record_date,status,fields,metrics,source_row,import_id) VALUES %s
    ON CONFLICT(project_id,kind,source_key) DO UPDATE SET sheet=EXCLUDED.sheet,identifier=EXCLUDED.identifier,hole_id=EXCLUDED.hole_id,
    site_id=EXCLUDED.site_id,year=EXCLUDED.year,record_date=EXCLUDED.record_date,status=EXCLUDED.status,fields=EXCLUDED.fields,
    metrics=EXCLUDED.metrics,source_row=EXCLUDED.source_row,import_id=EXCLUDED.import_id,active=TRUE,updated_at=NOW()""",values,page_size=500)
    for change in summary['borehole_updates']:
        vals=change['after'];cur.execute('UPDATE boreholes SET '+','.join(k+'=%s' for k in vals)+',updated_at=NOW() WHERE id=%s',list(vals.values())+[change['id']])
    summary['lab_batches_synced']=sync_labs(cur,parsed['records'],project)
    cur.execute('UPDATE project_register_imports SET summary=%s WHERE id=%s',(Json(summary),iid))
    record_audit_event(cur,action='import',entity_type='project_register',entity_key=str(iid),project_id=project['id'],details=summary)
    return summary

def create_register_router(get_conn):
    router=APIRouter(tags=['Project registers'])
    @router.get('/project-registers')
    def get_registers(request:Request,project_id:int):
        with get_conn() as conn:
            with conn.cursor() as cur:
                access(cur,request,project_id)
                cur.execute('SELECT r.*,i.filename FROM project_register_records r JOIN project_register_imports i ON i.id=r.import_id WHERE r.project_id=%s AND r.active ORDER BY r.kind,r.identifier,r.sheet',(project_id,));rows=cur.fetchall()
                cur.execute('SELECT id,kind,filename,summary,created_at FROM project_register_imports WHERE project_id=%s ORDER BY id DESC LIMIT 20',(project_id,));imports=cur.fetchall()
                return {'records':rows,'imports':imports}
    @router.post('/project-registers/import')
    async def import_register(request:Request,project_id:int=Form(...),commit:bool=Form(False),file:UploadFile=File(...)):
        with get_conn() as conn:
            with conn.cursor() as cur:
                project=access(cur,request,project_id)
                if project['name'].lower()!='ironbark' or project['program']!='Exploration':raise HTTPException(400,'These workbook templates contain Ironbark records. Select Ironbark / Exploration.')
                content=await file.read(20*1024*1024+1)
                try:parsed=parse_workbook(content,file.filename or 'Workbook.xlsx')
                except Exception as e:raise HTTPException(400,str(e) if isinstance(e,ValueError) else 'Workbook could not be read. Upload an .xlsx workbook.')
                return save_import(cur,parsed,project) if commit else preview(cur,parsed,project)
    return router
