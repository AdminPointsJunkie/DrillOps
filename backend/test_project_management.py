import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_HTML = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
MAIN_PY = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")


class ProjectManagementTests(unittest.TestCase):
    def test_project_name_can_have_separate_programs(self):
        start = MAIN_PY.index('@app.post("/projects")')
        end = MAIN_PY.index('@app.patch("/projects/{project_id}")', start)
        create_route = MAIN_PY[start:end]

        self.assertNotIn("ON CONFLICT (contractor, name) DO UPDATE", create_route)
        self.assertIn("LOWER(BTRIM(name))=LOWER(BTRIM(%s))", create_route)
        self.assertIn("LOWER(BTRIM(COALESCE(program,'')))=LOWER(BTRIM(%s))", create_route)
        self.assertIn("already has a {program} program", create_route)
        self.assertIn("raise HTTPException(409", create_route)

    def test_project_schema_uniqueness_includes_program(self):
        self.assertIn("DROP CONSTRAINT IF EXISTS projects_contractor_name_key", MAIN_PY)
        self.assertIn("projects_contractor_name_program_key", MAIN_PY)
        self.assertIn("LOWER(BTRIM(program))", MAIN_PY)

    def test_ironbark_2026_gas_riser_program_is_seeded(self):
        self.assertIn("'Gas Riser', p.name, '2026'", MAIN_PY)
        self.assertIn("LOWER(BTRIM(p.name))='ironbark'", MAIN_PY)
        self.assertIn("ON CONFLICT DO NOTHING", MAIN_PY)

    def test_depco_ironbark_records_move_to_gas_riser(self):
        start = MAIN_PY.index("def assign_depco_ironbark_to_gas_riser")
        end = MAIN_PY.index("init_db()", start)
        migration = MAIN_PY[start:end]

        for table in ("activities", "invoices", "purchase_orders", "project_budgets", "cost_contracts", "boreholes"):
            self.assertIn(table, migration)
        self.assertIn("SET program='Gas Riser'", migration)
        self.assertIn("SET project='Ironbark'", migration)
        self.assertIn("LIKE 'IBGR%%'", migration)
        self.assertIn("LOWER(BTRIM(COALESCE(contractor, '')))='depco drilling'", migration)
        self.assertIn("assign_depco_ironbark_to_gas_riser()", MAIN_PY)

    def test_workspace_lists_every_program_for_a_project(self):
        start = INDEX_HTML.index("function populateWorkspaceProgramOptions()")
        end = INDEX_HTML.index("function updateWorkspaceContinueState()", start)
        program_options = INDEX_HTML[start:end]

        self.assertIn("matchingProjects = projects.filter", program_options)
        self.assertIn("matchingProjects.map", program_options)
        self.assertIn("workspaceProgramLabel(project, program)", program_options)

    def test_boreholes_and_project_contractors_are_program_scoped(self):
        self.assertIn("program         TEXT DEFAULT 'Exploration'", MAIN_PY)
        self.assertIn('program:activeProgram||\'Exploration\'', INDEX_HTML)
        self.assertIn("&program='+encodeURIComponent(activeProgram||'')", INDEX_HTML)

    def test_budget_allocations_are_unique_per_program(self):
        self.assertIn("project_budgets_program_allocation_key", MAIN_PY)
        self.assertIn("ON CONFLICT (contractor, project, program, section, vendor)", MAIN_PY)

    def test_project_register_has_full_edit_dialog(self):
        self.assertIn('id="entity-project-id"', INDEX_HTML)
        self.assertIn('id="entity-project-status"', INDEX_HTML)
        self.assertIn("function showEditProjectDialog(projectId)", INDEX_HTML)
        self.assertIn("onclick=\"showEditProjectDialog(", INDEX_HTML)
        self.assertIn("setEntityDialogMode('project-edit')", INDEX_HTML)

    def test_project_edit_uses_patch_and_shows_backend_error(self):
        self.assertIn("url = isProjectEdit ? API+'/projects/'", INDEX_HTML)
        self.assertIn("method:isProjectEdit?'PATCH':'POST'", INDEX_HTML)
        self.assertIn("saved.detail || 'Project save failed'", INDEX_HTML)

    def test_created_project_refreshes_program_options(self):
        start = INDEX_HTML.index("async function saveClientProjectDialog(event)")
        end = INDEX_HTML.index("function filterBoreholesByClient()", start)
        save_dialog = INDEX_HTML[start:end]

        self.assertIn("workspaceProject.value = payload.name;", save_dialog)
        self.assertIn("populateWorkspaceProgramOptions();", save_dialog)


if __name__ == "__main__":
    unittest.main()
