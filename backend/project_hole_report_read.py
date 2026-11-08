"""Project report evidence in one read, without invoice attachments or crew records."""
from day_rate_costs import WORKED_DAYS_CTE

REPORT_SQL = "WITH " + WORKED_DAYS_CTE + "," + """
all_activity AS MATERIALIZED (
 SELECT id, contractor, project, program, source_file, date, hole_num, site_name,
        site_id, drill_rig, shift, time_from, time_to, total_time, bit_type, code,
        notes, total_metres, unit_rate, line_cost, rate_basis
 FROM activities WHERE contractor IN ('Mitchells Drilling','DEPCO Drilling')
), scoped_activity AS (
 SELECT * FROM all_activity
 WHERE lower(trim(project))=lower(trim(%(project)s))
   AND lower(trim(program))=lower(trim(%(program)s))
), material_scope AS (
 SELECT c.id,c.contractor,c.source_file,c.date,c.hole_num,c.site_name,c.line_cost,
        m.project,m.program,m.scope_count
 FROM consumables c
 JOIN LATERAL (
   SELECT min(a.project) project,min(a.program) program,
          count(DISTINCT (COALESCE(a.project,''),COALESCE(a.program,''))) scope_count,
          bool_or(lower(trim(a.project))=lower(trim(%(project)s))
            AND lower(trim(a.program))=lower(trim(%(program)s))) touches_scope
   FROM all_activity a
   WHERE a.contractor=c.contractor AND a.source_file=c.source_file AND a.date=c.date
     AND COALESCE(trim(c.source_file),'')<>''
     AND (COALESCE(trim(c.hole_num),'')='' OR lower(trim(a.hole_num))=lower(trim(c.hole_num)))
 ) m ON m.touches_scope
 WHERE c.contractor IN ('Mitchells Drilling','DEPCO Drilling')
), ledger AS (
 SELECT id,contractor,project,program,invoice_number,invoice_date,billing_month,
        service_start,service_end,po_reference,subtotal
 FROM invoices
 WHERE lower(trim(project))=lower(trim(%(project)s))
   AND (COALESCE(trim(program),'')='' OR lower(trim(program))=lower(trim(%(program)s)))
), lines AS (
 SELECT l.id,l.invoice_id,l.hole_num,l.site_name,l.amount
 FROM invoice_lines l JOIN ledger i ON i.id=l.invoice_id
)
SELECT COALESCE((SELECT jsonb_agg(d ORDER BY date,id) FROM worked_days d WHERE lower(trim(d.project))=lower(trim(%(project)s)) AND lower(trim(d.program))=lower(trim(%(program)s))),'[]'::jsonb) day_rates,
       COALESCE((SELECT jsonb_agg(a ORDER BY date,id) FROM scoped_activity a),'[]'::jsonb) activities,
       COALESCE((SELECT jsonb_agg(m ORDER BY date,id) FROM material_scope m WHERE scope_count=1),'[]'::jsonb) consumables,
       COALESCE((SELECT jsonb_agg(m ORDER BY date,id) FROM material_scope m WHERE scope_count<>1),'[]'::jsonb) ambiguous_consumables,
       COALESCE((SELECT jsonb_agg(i ORDER BY invoice_date,id) FROM ledger i),'[]'::jsonb) invoices,
       COALESCE((SELECT jsonb_agg(l ORDER BY invoice_id,id) FROM lines l),'[]'::jsonb) invoice_lines
"""
