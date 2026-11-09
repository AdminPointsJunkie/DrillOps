"""Read-only personnel time register. Day units never imply hours."""
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from day_rate_costs import WORKED_DAYS_CTE

CREW_SQL = """
SELECT c.id,c.date,c.contractor,c.name person,c.role,c.hours,c.site_name,c.source_file,
       scope.scopes
FROM crew c
LEFT JOIN (
 SELECT contractor,source_file,date,
 jsonb_agg(DISTINCT jsonb_build_object('project',COALESCE(project,''),'program',COALESCE(program,''))) scopes
 FROM activities WHERE contractor IN ('Mitchells Drilling','DEPCO Drilling')
 GROUP BY contractor,source_file,date
) scope ON scope.contractor=c.contractor AND scope.source_file=c.source_file AND scope.date=c.date
WHERE c.contractor IN ('Mitchells Drilling','DEPCO Drilling')
ORDER BY c.date,c.contractor,c.name,c.id
"""

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
            hours=numeric(r.get('hours')),days=None,site=r.get('site_name') or '',
            source=r.get('source_file') or '',basis='Crew hours',allocation='Multiple projects' if len(scopes)>1 else ''))
    for r in days:
        rows.append(dict(id='day-'+str(r['id']),date=iso_date(r.get('date')),contractor=r['contractor'],person=r['person'],
            role='',project=r.get('project') or '',program=r.get('program') or '',hours=None,days=numeric(r.get('units')),
            site=r.get('site_name') or '',source='Worked day entry',basis='Worked days',allocation=''))
    return sorted(rows,key=lambda r:(r['date'],r['contractor'],r['person']),reverse=True)

def load_register(cur):
    cur.execute(CREW_SQL);crew=cur.fetchall()
    cur.execute('WITH '+WORKED_DAYS_CTE+' SELECT * FROM worked_days ORDER BY date,contractor,person');days=cur.fetchall()
    return {'rows':register_rows(crew,days),'contractors':sorted(set(['Mitchells Drilling','DEPCO Drilling']+[r['contractor'] for r in days]))}
