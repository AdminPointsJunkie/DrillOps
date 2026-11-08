"""Project/rig bookings, including separate visits and roster breaks."""
from datetime import date
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
        authorize(request)
        with get_conn(read_only=True) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM rig_schedule WHERE status<>'Cancelled' ORDER BY scheduled_start,id");entries=cur.fetchall()
                cur.execute("SELECT id,contractor,hole_id,site_id,project,program,planned_year,status,assigned_rig,scheduled_start,scheduled_end,days_budgeted,notes FROM boreholes WHERE contractor='Company'");planner=cur.fetchall()
                cur.execute('SELECT id,name,program,year FROM projects ORDER BY name,year,program');projects=cur.fetchall()
                return dict(entries=active_entries(entries,planner),planner=planner,projects=projects)
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
