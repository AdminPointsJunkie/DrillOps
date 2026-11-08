"""Recorded worked day costs with the same allocation rules as the EOS calendar."""
WORKED_DAYS_CTE = """
worked_days AS (
 SELECT d.id,d.contractor,d.person,d.work_date::text date,d.units,d.day_rate,
        d.units*d.day_rate AS line_cost, allocation.project_id,
        COALESCE(p.name,'') project,COALESCE(p.program,'') program,
        CASE WHEN d.allocation_locked THEN d.allocation_site ELSE '' END site_name,
        'Worked'::text status
 FROM day_rate_days d
 LEFT JOIN LATERAL (
  SELECT r.* FROM day_rate_rosters r
  WHERE r.project_id=d.project_id AND lower(trim(r.contractor))=lower(trim(d.contractor))
    AND lower(trim(r.person))=lower(trim(d.person)) AND r.effective_from<=d.work_date
  ORDER BY r.effective_from DESC,r.id DESC LIMIT 1
 ) r ON TRUE
 CROSS JOIN LATERAL (
  SELECT CASE WHEN d.allocation_locked THEN d.allocated_project_id
    WHEN r.allocation_default='unallocated' THEN NULL
    WHEN COALESCE(r.follow_rig,'')<>'' THEN (
      SELECT CASE WHEN count(DISTINCT (a.project,a.program))=1 AND count(DISTINCT p.id)=1 THEN min(p.id) END
      FROM activities a LEFT JOIN projects p ON p.name=a.project AND p.program=a.program AND p.year=left(a.date,4)
      WHERE a.date=d.work_date::text AND lower(trim(a.contractor))=lower(trim(r.follow_contractor))
        AND lower(trim(a.drill_rig))=lower(trim(r.follow_rig))
    ) ELSE d.project_id END project_id
 ) allocation
 LEFT JOIN projects p ON p.id=allocation.project_id
 WHERE d.status='Worked'
)
"""
