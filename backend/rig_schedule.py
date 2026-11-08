"""Project/rig bookings, including separate visits and roster breaks."""
from datetime import date, timedelta
import hashlib
from fastapi import APIRouter, HTTPException, Request
from audit import record_audit_event
from security import current_auth_user

SCHEMA = """
CREATE TABLE IF NOT EXISTS rig_schedule (
 id BIGSERIAL PRIMARY KEY, project TEXT NOT NULL, program TEXT NOT NULL DEFAULT 'Exploration',
 planned_year TEXT NOT NULL, assigned_rig TEXT NOT NULL, hole_id TEXT NOT NULL DEFAULT '',
 site_id TEXT NOT NULL DEFAULT '', scheduled_start DATE NOT NULL, scheduled_end DATE NOT NULL,
 kind TEXT NOT NULL DEFAULT 'Drilling' CHECK(kind IN ('Drilling','Break','Other')),
 status TEXT NOT NULL DEFAULT 'Planned' CHECK(status IN ('Planned','In Progress','Complete','Cancelled')),
 notes TEXT NOT NULL DEFAULT '', source_key TEXT UNIQUE, source_reference TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK(scheduled_end>=scheduled_start)
);
CREATE INDEX IF NOT EXISTS rig_schedule_year ON rig_schedule(planned_year,scheduled_start);
ALTER TABLE rig_schedule ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rig_schedule FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE rig_schedule_id_seq FROM PUBLIC,anon,authenticated;
"""

# One compact row per reported hole/day, not the raw activity register.
EOS_SQL = """SELECT contractor,project,program,drill_rig,date,hole_num,
 array_agg(DISTINCT NULLIF(trim(site_id),'')) site_ids,
 array_agg(DISTINCT NULLIF(trim(source_file),'')) sources
 FROM activities
 WHERE contractor IN ('Mitchells Drilling','DEPCO Drilling')
 AND trim(drill_rig) IN ('1218','DR17')
 AND lower(COALESCE(trim(program),''))<>'gas riser'
 GROUP BY contractor,project,program,drill_rig,date,hole_num"""

def report_date(value):
    value=str(value or '').strip()
    try:
        if '/' in value:
            day,month,year=value.split('/');return date(int(year),int(month),int(day))
        return date.fromisoformat(value)
    except (TypeError,ValueError):return None

def reported_bookings(rows,planner):
    """Consecutive reported dates only; a gap or year boundary starts a new visit."""
    daily={}
    for r in rows:
        day=report_date(r.get('date'));hole=str(r.get('hole_num') or '').strip()
        if not day or hole.upper() in ('','NA','N/A','NONE','UNKNOWN','NOT RECORDED','NO HOLE','OOO','-'):continue
        rig=str(r.get('drill_rig') or '').strip()
        if rig not in ('1218','DR17') or str(r.get('program') or '').strip().lower()=='gas riser':continue
        project=str(r.get('project') or '').strip() or 'Unallocated'
        program=str(r.get('program') or '').strip() or 'Exploration'
        key=(project,program,rig,hole.upper(),day)
        if key not in daily:daily[key]=dict(project=project,program=program,assigned_rig=rig,hole_id=hole,day=day,sites=set(),sources=set())
        daily[key]['sites'].update(v for v in r.get('site_ids',[]) if v)
        daily[key]['sources'].update(v for v in r.get('sources',[]) if v)
    visits=[]
    for _,r in sorted(daily.items()):
        sites=r['sites']
        # Use a site ID from the planner only when the hole has one unambiguous match.
        if not sites:sites={str(p['site_id']).strip() for p in planner if p.get('site_id') and p.get('project')==r['project'] and p.get('program')==r['program'] and identity(p.get('hole_id'))==identity(r['hole_id'])}
        sid=next(iter(sites)) if len(sites)==1 else ''
        prev=visits[-1] if visits else None
        if prev and all(prev[k]==r[k] for k in ('project','program','assigned_rig','hole_id')) and prev['site_id']==sid and prev['end']+timedelta(days=1)==r['day'] and prev['end'].year==r['day'].year:
            prev['end']=r['day'];prev['reported_days']+=1;prev['sources'].update(r['sources'])
        else:visits.append({k:r[k] for k in ('project','program','assigned_rig','hole_id')}|dict(site_id=sid,start=r['day'],end=r['day'],reported_days=1,sources=set(r['sources'])))
    result=[]
    for v in visits:
        start=v.pop('start');end=v.pop('end');sources=v.pop('sources')
        key='|'.join([v['project'],v['program'],v['assigned_rig'],v['hole_id'],start.isoformat()])
        result.append(dict(v,id='eos-'+hashlib.sha256(key.encode()).hexdigest()[:20],scheduled_start=start.isoformat(),scheduled_end=end.isoformat(),planned_year=str(start.year),status='Reported',kind='Drilling',is_reported=True,report_count=len(sources),source_reference='EOS reports',notes=''))
    return active_entries(result,planner)

def ensure_schedule_schema(get_conn):
    with get_conn() as conn:
        with conn.cursor() as cur:cur.execute(SCHEMA)

def identity(value):
    import re
    return re.sub(r'^(IB|CD)-(?=\d{2}-)', '', str(value or '').strip().upper())

def active_entries(entries, planner):
    cancelled=set()
    for b in planner:
        if str(b.get('status','')).strip().lower() in ('cancelled','canceled'):
            for value in (b.get('hole_id'),b.get('site_id')):
                if value:cancelled.add((b.get('project'),b.get('program'),identity(value)))
    return [r for r in entries if r['status']!='Cancelled' and not any(
        (r['project'],r['program'],identity(r.get(k))) in cancelled for k in ('hole_id','site_id') if r.get(k))]

def values(p):
    v={k:str(p.get(k) or '').strip() for k in ('project','program','planned_year','assigned_rig','hole_id','site_id','kind','status','notes')}
    try:
        v['scheduled_start']=date.fromisoformat(p['scheduled_start']);v['scheduled_end']=date.fromisoformat(p['scheduled_end'])
        if v['scheduled_end']<v['scheduled_start'] or (v['scheduled_end']-v['scheduled_start']).days>1096:raise ValueError()
        if not 2000<=int(v['planned_year'])<=2100:raise ValueError()
    except (KeyError,ValueError,TypeError):raise HTTPException(400,'Enter valid start and end dates and a schedule year.')
    if not v['project'] or not v['assigned_rig'] or not v['program'] or any(len(v[k])>200 for k in ('project','program','assigned_rig','hole_id','site_id')) or len(v['notes'])>4000:raise HTTPException(400,'Check the project, rig and booking details.')
    if v['kind'] not in ('Drilling','Break','Other') or v['status'] not in ('Planned','In Progress','Complete','Cancelled'):raise HTTPException(400,'Choose a booking type and status.')
    if v['kind']=='Drilling' and not (v['hole_id'] or v['site_id']):raise HTTPException(400,'Enter a hole or site ID.')
    return v

def create_schedule_router(get_conn):
    router=APIRouter(prefix='/rig-schedule')
    def authorize(request):
        auth=current_auth_user(request)
        if not auth.owner and 'project' not in auth.apps:raise HTTPException(403,'Project access required.')
        return auth
    @router.get('')
    def read(request:Request):
        """Load planned bookings and live EOS-reported hole visits for the rig timeline."""
        authorize(request)
        with get_conn(read_only=True) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM rig_schedule WHERE status<>'Cancelled' ORDER BY scheduled_start,id");entries=cur.fetchall()
                cur.execute("SELECT id,contractor,hole_id,site_id,project,program,planned_year,status,assigned_rig,scheduled_start,scheduled_end,days_budgeted,notes FROM boreholes WHERE contractor='Company'");planner=cur.fetchall()
                cur.execute('SELECT id,name,program,year FROM projects ORDER BY name,year,program');projects=cur.fetchall()
                cur.execute(EOS_SQL);reported=reported_bookings(cur.fetchall(),planner)
                return dict(entries=active_entries(entries,planner),planner=planner,projects=projects,reported=reported)
    @router.post('')
    async def save(request:Request):
        auth=authorize(request)
        try:
            p=await request.json()
            if not isinstance(p,dict):raise ValueError()
            rid=int(p['id']) if p.get('id') else None;revision=int(p.get('revision',0))
        except (TypeError,ValueError):raise HTTPException(400,'Invalid booking.')
        v=values(p)
        with get_conn() as conn:
            with conn.cursor() as cur:
                before=None
                if rid:
                    cur.execute('SELECT * FROM rig_schedule WHERE id=%s FOR UPDATE',(rid,));before=cur.fetchone()
                    if not before:raise HTTPException(404,'Booking not found.')
                    if before['revision']!=revision:raise HTTPException(409,'This booking changed. Refresh before editing.')
                cur.execute("SELECT project,program,hole_id,site_id,status FROM boreholes WHERE contractor='Company' AND project=%s AND program=%s AND lower(status) IN ('cancelled','canceled')",(v['project'],v['program']))
                if v['status']!='Cancelled' and not active_entries([v],cur.fetchall()):raise HTTPException(409,'This hole is cancelled in BH Planner.')
                columns=list(v)
                if rid:cur.execute('UPDATE rig_schedule SET '+','.join(k+'=%s' for k in columns)+',revision=revision+1,updated_at=now() WHERE id=%s RETURNING *',[v[k] for k in columns]+[rid])
                else:cur.execute('INSERT INTO rig_schedule ('+','.join(columns)+') VALUES ('+','.join(['%s']*len(columns))+') RETURNING *',[v[k] for k in columns])
                row=cur.fetchone()
                record_audit_event(cur,actor_user_id=auth.user_id,action='rig_schedule.save',entity_type='rig_schedule',entity_key=str(row['id']),details={'before':{k:str(x) for k,x in (before or {}).items()},'after':{k:str(x) for k,x in row.items()}})
                return row
    return router
