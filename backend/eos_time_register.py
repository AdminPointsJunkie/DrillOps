"""Read-only personnel time register. Day units never imply hours."""
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from day_rate_costs import WORKED_DAYS_CTE

CREW_SQL = """
SELECT c.id,c.date,c.contractor,c.name person,c.role,c.hours,c.site_name,c.source_file,
       scope.scopes,scope.rigs
FROM crew c
LEFT JOIN (
 SELECT contractor,source_file,date,
 jsonb_agg(DISTINCT jsonb_build_object('project',COALESCE(project,''),'program',COALESCE(program,''))) scopes,
 array_agg(DISTINCT NULLIF(trim(drill_rig),'')) FILTER (WHERE NULLIF(trim(drill_rig),'') IS NOT NULL) rigs
 FROM activities WHERE contractor IN ('Mitchells Drilling','DEPCO Drilling')
 GROUP BY contractor,source_file,date
) scope ON scope.contractor=c.contractor AND scope.source_file=c.source_file AND scope.date=c.date
WHERE c.contractor IN ('Mitchells Drilling','DEPCO Drilling')
ORDER BY c.date,c.contractor,c.name,c.id
"""

RIG_SQL = """
SELECT id,date,contractor,drill_rig,project,program,site_name,source_file,total_time,code
FROM activities
WHERE contractor IN ('Mitchells Drilling','DEPCO Drilling')
ORDER BY date,contractor,drill_rig,id
"""

def rig_register_rows(activities):
    groups={}
    for r in activities:
        if r.get('code') == 'H_Min_Shift':
            continue
        value=str(r.get('total_time') or '').strip()
        if ':' in value:
            parts=value.split(':')
            hours=numeric(parts[0]) if len(parts)==2 else None
            minutes=numeric(parts[1]) if len(parts)==2 else None
            hours=hours+minutes/60 if hours is not None and minutes is not None and minutes<60 else None
        else:
            hours=numeric(value)
        if hours is None or hours<=0:
            continue
        rig=str(r.get('drill_rig') or '').strip()
        key=(iso_date(r.get('date')),r['contractor'],rig,r.get('project') or '',r.get('program') or '',r.get('site_name') or '')
        if key not in groups:
            groups[key]=dict(id='rig-'+str(r['id']),date=key[0],contractor=key[1],
                person=rig or 'Unassigned rig',role='Rig hours',project=key[3],program=key[4],
                rigs=[rig] if rig else [],hours=0,days=None,site=key[5],
                source='',basis='Rig hours',allocation='',sources=set())
        entry=groups[key]
        entry['hours']+=hours
        if r.get('source_file'):entry['sources'].add(r['source_file'])
    for entry in groups.values():
        entry['hours']=round(entry['hours'],4)
        entry['source']=' / '.join(sorted(entry.pop('sources')))
    return list(groups.values())

def iso_date(value):
    value=str(value or '').strip()
    for fmt in ('%Y-%m-%d','%d/%m/%Y'):
        try:return datetime.strptime(value,fmt).date().isoformat()
        except ValueError:pass
    return ''

def numeric(value):
    try:
        n=Decimal(str(value).strip())
        return float(n) if n.is_finite() and n>=0 else None
    except (InvalidOperation,ValueError,TypeError):return None

def register_rows(crew,days):
    rows=[]
    for r in crew:
        scopes=r.get('scopes') or []
        scope=scopes[0] if len(scopes)==1 else {}
        rows.append(dict(id='crew-'+str(r['id']),date=iso_date(r.get('date')),contractor=r['contractor'],
            person=r.get('person') or 'Name not recorded',role=r.get('role') or '',
            project=scope.get('project') or '',program=scope.get('program') or '',
            rigs=sorted(set(r.get('rigs') or [])),hours=numeric(r.get('hours')),days=None,site=r.get('site_name') or '',
            source=r.get('source_file') or '',basis='Crew hours',allocation='Multiple projects' if len(scopes)>1 else ''))
    for r in days:
        rows.append(dict(id='day-'+str(r['id']),date=iso_date(r.get('date')),contractor=r['contractor'],person=r['person'],
            role='',rigs=[],project=r.get('project') or '',program=r.get('program') or '',hours=None,days=numeric(r.get('units')),
            site=r.get('site_name') or '',source='Worked day entry',basis='Worked days',allocation=''))
    return sorted(rows,key=lambda r:(r['date'],r['contractor'],r['person']),reverse=True)

def load_register(cur):
    cur.execute(RIG_SQL);rigs=rig_register_rows(cur.fetchall())
    cur.execute('WITH '+WORKED_DAYS_CTE+' SELECT * FROM worked_days ORDER BY date,contractor,person');days=cur.fetchall()
    return {'rows':sorted(rigs+register_rows([],days),key=lambda r:(r['date'],r['contractor'],r['person']),reverse=True),'contractors':sorted(set(['Mitchells Drilling','DEPCO Drilling']+[r['contractor'] for r in days]))}
