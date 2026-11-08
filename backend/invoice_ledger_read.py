"""Read the actuals ledger and PO values in one round trip, without PDFs or line audits."""
LEDGER_SQL = """
WITH ledger AS (
 SELECT id, source_file, contractor, invoice_number, project, program,
        service_start, service_end, invoice_date, due_date, po_reference,
        client, abn, subtotal, gst, total_aud, amount_paid, amount_due,
        status, notes, billing_month, query_notes, version
 FROM invoices
 WHERE (%(project)s='' OR LOWER(TRIM(COALESCE(project,'')))=LOWER(TRIM(%(project)s)))
   AND (%(program)s='' OR COALESCE(program,'')='' OR program=%(program)s)
), pos AS (
 SELECT id, po_number, contractor, project, program, po_value
 FROM purchase_orders
 WHERE (%(project)s='' OR LOWER(TRIM(COALESCE(project,'')))=LOWER(TRIM(%(project)s)))
   AND (%(program)s='' OR program=%(program)s)
)
SELECT COALESCE((SELECT jsonb_agg(ledger ORDER BY invoice_date,id) FROM ledger),'[]'::jsonb) invoices,
       COALESCE((SELECT jsonb_agg(pos) FROM pos),'[]'::jsonb) purchase_orders
"""
