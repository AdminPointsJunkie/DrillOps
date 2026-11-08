from day_rate_costs import WORKED_DAYS_CTE
# Read-only PostgreSQL fixture: locked allocations win, no fallback for unallocated,
# and Planned/Not working days cannot contribute to actual costs.
FIXTURE_SQL = """WITH
sample_projects(id,name,program,year) AS (VALUES(1,'Home','Exploration','2026'),(2,'Allocated','Exploration','2026')),
sample_activities(project,program,date,contractor,drill_rig) AS (SELECT ''::text,''::text,''::text,''::text,''::text WHERE false),
sample_rosters(id,project_id,contractor,person,effective_from,effective_to,allocation_default,follow_rig,follow_contractor) AS (VALUES
 (1,1,'Fortem','Person','2026-01-01'::date,NULL::date,'unallocated','','')),
sample_days(id,project_id,contractor,person,work_date,units,day_rate,status,allocation_locked,allocated_project_id,allocation_site) AS (VALUES
 (1,1,'Fortem','Person','2026-01-01'::date,1.0,1600,'Worked',true,2,'Site A'),
 (2,1,'Fortem','Person','2026-01-02'::date,0.5,1600,'Worked',true,NULL,''),
 (3,1,'Fortem','Person','2026-01-03'::date,1.0,1600,'Planned',true,2,''),
 (4,1,'Fortem','Person','2026-01-04'::date,1.0,1600,'Not working',true,2,''),
 (5,1,'Fortem','Person','2026-01-05'::date,1.0,1600,'Worked',false,NULL,''))
,"""+WORKED_DAYS_CTE.replace('FROM day_rate_days','FROM sample_days').replace('FROM day_rate_rosters','FROM sample_rosters').replace('FROM activities','FROM sample_activities').replace('JOIN projects','JOIN sample_projects')+"""
SELECT count(*)=3 AS worked_only,sum(line_cost)=4000 AS exact_cost,
 sum(line_cost) FILTER(WHERE project='Allocated')=1600 AS saved_allocation,
 sum(line_cost) FILTER(WHERE project='')=2400 AS unallocated_preserved
FROM worked_days;
"""

def test_fixture_is_read_only_and_independent():
    assert 'UPDATE ' not in FIXTURE_SQL and 'INSERT ' not in FIXTURE_SQL
    assert 'FROM day_rate_days' not in FIXTURE_SQL
