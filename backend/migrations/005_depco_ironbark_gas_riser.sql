-- Assign all DEPCO work at Ironbark to the Gas Riser program.
-- Safe to run repeatedly and mirrored by backend/main.py startup maintenance.

UPDATE activities
SET program = 'Gas Riser',
    client = COALESCE(NULLIF(client, ''), 'Argo NR')
WHERE LOWER(BTRIM(COALESCE(contractor, ''))) = 'depco drilling'
  AND LOWER(BTRIM(COALESCE(project, ''))) = 'ironbark'
  AND COALESCE(program, '') IS DISTINCT FROM 'Gas Riser';

UPDATE invoices
SET program = 'Gas Riser'
WHERE LOWER(BTRIM(COALESCE(contractor, ''))) = 'depco drilling'
  AND LOWER(BTRIM(COALESCE(project, ''))) = 'ironbark'
  AND COALESCE(program, '') IS DISTINCT FROM 'Gas Riser';

UPDATE purchase_orders
SET program = 'Gas Riser'
WHERE LOWER(BTRIM(COALESCE(contractor, ''))) = 'depco drilling'
  AND LOWER(BTRIM(COALESCE(project, ''))) = 'ironbark'
  AND COALESCE(program, '') IS DISTINCT FROM 'Gas Riser';

INSERT INTO project_budgets
    (contractor, program, project, section, vendor, budget_amount,
     allocation, notes, updated_at)
SELECT DISTINCT ON (contractor, project, section, vendor)
       contractor, 'Gas Riser', project, section, vendor, budget_amount,
       allocation, notes, NOW()
FROM project_budgets
WHERE LOWER(BTRIM(COALESCE(project, ''))) = 'ironbark'
  AND LOWER(BTRIM(COALESCE(vendor, ''))) LIKE 'depco%'
  AND COALESCE(program, '') IS DISTINCT FROM 'Gas Riser'
ORDER BY contractor, project, section, vendor,
         updated_at DESC NULLS LAST, id DESC
ON CONFLICT (contractor, project, program, section, vendor)
DO UPDATE SET
    budget_amount = EXCLUDED.budget_amount,
    allocation = EXCLUDED.allocation,
    notes = EXCLUDED.notes,
    updated_at = NOW();

DELETE FROM project_budgets
WHERE LOWER(BTRIM(COALESCE(project, ''))) = 'ironbark'
  AND LOWER(BTRIM(COALESCE(vendor, ''))) LIKE 'depco%'
  AND COALESCE(program, '') IS DISTINCT FROM 'Gas Riser';

UPDATE cost_contracts cc
SET project_id = target.id,
    client_id = target.client_id,
    updated_at = NOW()
FROM projects source, projects target
WHERE cc.project_id = source.id
  AND LOWER(BTRIM(COALESCE(cc.contractor, ''))) LIKE 'depco%'
  AND LOWER(BTRIM(source.name)) = 'ironbark'
  AND source.id <> target.id
  AND target.contractor = source.contractor
  AND LOWER(BTRIM(target.name)) = 'ironbark'
  AND LOWER(BTRIM(COALESCE(target.program, ''))) = 'gas riser'
  AND NOT EXISTS (
      SELECT 1
      FROM cost_contracts duplicate
      WHERE duplicate.project_id = target.id
        AND LOWER(BTRIM(duplicate.contractor)) = LOWER(BTRIM(cc.contractor))
        AND LOWER(BTRIM(duplicate.name)) = LOWER(BTRIM(cc.name))
  );

UPDATE boreholes b
SET program = 'Gas Riser'
WHERE LOWER(BTRIM(COALESCE(b.project, ''))) = 'ironbark'
  AND COALESCE(b.program, '') IS DISTINCT FROM 'Gas Riser'
  AND (
      LOWER(BTRIM(COALESCE(b.assigned_rig, ''))) LIKE 'depco%'
      OR EXISTS (
          SELECT 1
          FROM activities a
          WHERE LOWER(BTRIM(COALESCE(a.contractor, ''))) = 'depco drilling'
            AND LOWER(BTRIM(COALESCE(a.project, ''))) = 'ironbark'
            AND a.program = 'Gas Riser'
            AND COALESCE(BTRIM(a.hole_num), '') <> ''
            AND (
                UPPER(BTRIM(COALESCE(b.hole_id, ''))) = UPPER(BTRIM(a.hole_num))
                OR UPPER(BTRIM(COALESCE(b.site_id, ''))) = UPPER(BTRIM(a.hole_num))
            )
      )
  );
