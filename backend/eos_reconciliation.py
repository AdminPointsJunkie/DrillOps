"""Monthly recorded EOS charges and invoice actuals; no extrapolated accruals."""

def month_sql(field):
    # Text dates are stored in both ISO and Australian formats. Unknown stays visible.
    return f"""CASE
      WHEN trim({field}) ~ '^\\d{{4}}-(0[1-9]|1[0-2])($|-)' THEN left(trim({field}),7)
      WHEN trim({field}) ~ '^(0?[1-9]|1[0-2])/\\d{{4}}$'
        THEN right(trim({field}),4)||'-'||lpad(split_part(trim({field}),'/',1),2,'0')
      WHEN trim({field}) ~ '^\\d{{1,2}}/(0?[1-9]|1[0-2])/\\d{{4}}$'
        THEN right(trim({field}),4)||'-'||lpad(split_part(trim({field}),'/',2),2,'0')
      ELSE 'Unknown month' END"""

EOS_MONTH = month_sql('date')
INVOICE_MONTH = month_sql("COALESCE(NULLIF(trim(billing_month),''),invoice_date)")
# Consumables have no project/rig fields: only attach when the report evidence is unique.
MONTHLY_SQL = f"""
WITH a AS (
 SELECT contractor, COALESCE(project,'') project, COALESCE(program,'') program,
        COALESCE(NULLIF(trim(drill_rig),''),'Unassigned rig') rig,
        date, source_file, hole_num, shift, line_cost
 FROM activities WHERE contractor IN ('Mitchells Drilling','DEPCO Drilling')
), materials AS (
 SELECT c.contractor, COALESCE(m.project,'') project, COALESCE(m.program,'') program,
        COALESCE(m.rig,'Unassigned rig') rig, c.date, c.source_file, c.line_cost
 FROM consumables c
 LEFT JOIN LATERAL (
   SELECT CASE WHEN count(DISTINCT (project,program))=1 THEN min(project) END project,
          CASE WHEN count(DISTINCT (project,program))=1 THEN min(program) END program,
          CASE WHEN count(DISTINCT (project,program,rig))=1 THEN min(rig) END rig
   FROM a WHERE a.contractor=c.contractor AND a.source_file=c.source_file AND a.date=c.date
     AND (COALESCE(c.hole_num,'')='' OR a.hole_num=c.hole_num)
 ) m ON TRUE
 WHERE c.contractor IN ('Mitchells Drilling','DEPCO Drilling')
), charges AS (
 SELECT contractor,project,program,rig,date,source_file,line_cost,'activity' kind FROM a
 UNION ALL
 SELECT contractor,project,program,rig,date,source_file,line_cost,'material' kind FROM materials
), eos AS (
 SELECT contractor, project, program, rig, {EOS_MONTH} AS month,
   SUM(line_cost) eos_total, count(*) FILTER (WHERE line_cost IS NULL) unpriced,
   count(*) line_count,
   count(DISTINCT (date,source_file)) FILTER (WHERE kind='activity') report_count
 FROM charges GROUP BY 1,2,3,4,5
), inv AS (
 SELECT CASE WHEN contractor='DEPCO' THEN 'DEPCO Drilling' ELSE contractor END contractor,
   COALESCE(project,'') project, COALESCE(program,'') program,
   {INVOICE_MONTH} AS month,
   SUM(subtotal) invoice_total, count(*) invoice_count,
   count(*) FILTER (WHERE subtotal IS NULL) missing_amounts,
   count(*) FILTER (WHERE COALESCE(trim(billing_month),'')='') date_fallbacks
 FROM invoices WHERE contractor IN ('Mitchells Drilling','DEPCO Drilling','DEPCO')
 GROUP BY 1,2,3,4
)
SELECT COALESCE((SELECT jsonb_agg(eos ORDER BY month,project,contractor,rig) FROM eos),'[]'::jsonb) eos,
       COALESCE((SELECT jsonb_agg(inv ORDER BY month,project,contractor) FROM inv),'[]'::jsonb) invoices
"""
