from eos_time_register import register_rows, numeric
from test_project_tracking_api import client, Cursor

def test_hours_and_day_units_remain_separate_and_dates_normalise():
    rows=register_rows([dict(id=1,date='10/11/2026',contractor='Mitchells Drilling',person='Crew A',hours='12.5',scopes=[dict(project='Ironbark',program='Exploration')])],[dict(id=2,date='2026-11-10',contractor='Fortem',person='Nuwan',units='1',project='Ironbark')])
    assert {r['date'] for r in rows}=={'2026-11-10'}
    crew=next(r for r in rows if r['basis']=='Crew hours');day=next(r for r in rows if r['basis']=='Worked days')
    assert crew['hours']==12.5 and crew['days'] is None
    assert day['hours'] is None and day['days']==1

def test_ambiguous_projects_are_not_duplicated_or_assigned():
    rows=register_rows([dict(id=1,contractor='Mitchells Drilling',date='bad',hours='N/A',scopes=[dict(project='A'),dict(project='B')])],[])
    assert len(rows)==1 and rows[0]['project']=='' and rows[0]['allocation']=='Multiple projects'
    assert rows[0]['hours'] is None and rows[0]['date']==''
    assert all(numeric(x) is None for x in ['NaN','Infinity','-1',None,''])

def test_read_requires_access_and_only_reads_worked_days():
    assert client(Cursor(False)).get('/crew/time-register').status_code==403
    cur=Cursor();response=client(cur).get('/crew/time-register')
    assert response.status_code==200 and response.json()['rows']==[]
    assert any("d.status='Worked'" in q for q,p in cur.calls)
