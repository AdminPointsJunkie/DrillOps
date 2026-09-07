-- Allow one project/site to contain independently scoped programs.
-- Safe to run repeatedly and mirrored by backend/main.py startup migrations.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS program TEXT DEFAULT 'Exploration';

UPDATE projects
SET program = 'Exploration'
WHERE program IS NULL OR BTRIM(program) = '';

ALTER TABLE projects
    DROP CONSTRAINT IF EXISTS projects_contractor_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS projects_contractor_name_program_key
    ON projects (contractor, LOWER(BTRIM(name)), LOWER(BTRIM(program)));

ALTER TABLE boreholes
    ADD COLUMN IF NOT EXISTS program TEXT DEFAULT 'Exploration';

UPDATE boreholes
SET program = 'Exploration'
WHERE program IS NULL OR BTRIM(program) = '';

ALTER TABLE purchase_orders
    ADD COLUMN IF NOT EXISTS program TEXT DEFAULT 'Exploration';

UPDATE purchase_orders
SET program = 'Exploration'
WHERE program IS NULL OR BTRIM(program) = '';

ALTER TABLE project_budgets
    ADD COLUMN IF NOT EXISTS program TEXT DEFAULT 'Exploration';

UPDATE project_budgets
SET program = 'Exploration'
WHERE program IS NULL OR BTRIM(program) = '';

ALTER TABLE project_budgets
    DROP CONSTRAINT IF EXISTS project_budgets_contractor_project_section_vendor_key;

CREATE UNIQUE INDEX IF NOT EXISTS project_budgets_program_allocation_key
    ON project_budgets (contractor, project, program, section, vendor);
