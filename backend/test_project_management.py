import unittest
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_HTML = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
MAIN_PY = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
IRONBARK_BUDGET = json.loads(
    (ROOT / "backend" / "data" / "ironbark_2026_budget_v5_4.json").read_text(encoding="utf-8")
)


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

    def test_bulk_report_assignment_respects_active_program(self):
        start = MAIN_PY.index('@app.post("/activities/assign-project")')
        end = MAIN_PY.index('@app.post("/activities")', start)
        route = MAIN_PY[start:end]

        self.assertIn('payload.get("program")', route)
        self.assertIn("AND (%s='' OR p.program=%s)", route)
        self.assertIn("program:activeProgram", INDEX_HTML)

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

    def test_ironbark_current_plan_excludes_cancelled_scope(self):
        current = [
            borehole for borehole in IRONBARK_BUDGET["boreholes"]
            if borehole["source_status"] != "Cancelled"
        ]
        self.assertEqual(len(current), 41)
        self.assertAlmostEqual(sum(borehole["budget_total"] for borehole in current), 3868074.75)
        self.assertIn("def is_visible_borehole_plan_row", MAIN_PY)
        self.assertIn("def is_current_borehole_budget_row", MAIN_PY)
        self.assertIn("IRONBARK_2026_STATUS_OVERRIDES", MAIN_PY)
        self.assertIn("def ironbark_budget_import_status", MAIN_PY)
        self.assertIn("if normalized in {\"drilled\", \"abandoned\"}", MAIN_PY)

    def test_borehole_planning_keeps_cancelled_holes_visible_for_audit(self):
        self.assertIn('<option value="" selected>All boreholes</option>', INDEX_HTML)
        self.assertIn('<option value="current">Active plan only</option>', INDEX_HTML)
        self.assertIn("b.status!=='Cancelled'", INDEX_HTML)
        self.assertIn("b.current_budget_scope!==false", INDEX_HTML)
        self.assertIn("renderBhMapFiltered(filtered);", INDEX_HTML)

    def test_borehole_planning_collapses_site_duplicates_into_identified_hole(self):
        start = MAIN_PY.index("def is_placeholder_borehole_row")
        end = MAIN_PY.index('@app.get("/boreholes")', start)
        helpers = {}
        exec(MAIN_PY[start:end], helpers)
        rows = [
            {"site_id": "26-002", "hole_id": "26-002", "budget_total": 100185, "current_budget_scope": True},
            {"site_id": "26-002", "hole_id": "IB652C", "budget_total": 100190, "drilling_cost": 75853},
        ]
        result = helpers["dedupe_borehole_plan_rows"](rows, {"budget_total"})
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["hole_id"], "IB652C")
        self.assertEqual(result[0]["budget_total"], 100190)
        self.assertTrue(result[0]["current_budget_scope"])
        self.assertEqual(result[0]["activity_hole_ids"], ["26-002", "IB652C"])

    def test_borehole_planning_uses_activity_reports_for_actuals_and_completion_dates(self):
        self.assertIn("def current_ironbark_plan_site_ids", MAIN_PY)
        self.assertIn("ACTIVITY_REPORT_DATE_AS_ISO_SQL", MAIN_PY)
        self.assertIn("COMPANY_BOREHOLE_ACTIVITY_MATCH_SQL", MAIN_PY)
        self.assertIn("FROM boreholes mapped_borehole", MAIN_PY)
        self.assertIn("MAX({ACTIVITY_REPORT_DATE_AS_ISO_SQL})", MAIN_PY)

    def test_borehole_planning_has_monthly_completion_view(self):
        self.assertIn('id="bh-completions-chart"', INDEX_HTML)
        self.assertIn("function renderBoreholeCompletionChart", INDEX_HTML)
        self.assertIn("AS completion_date", MAIN_PY)

    def test_user_confirmed_statuses_have_all_18_completed_holes(self):
        start = MAIN_PY.index("IRONBARK_2026_STATUS_OVERRIDES = {")
        end = MAIN_PY.index("\n}\n\n\ndef is_visible_borehole_plan_row", start)
        overrides = MAIN_PY[start:end]
        self.assertEqual(overrides.count('"Complete"'), 18)
        self.assertIn('"26-021": "Complete"', overrides)
        self.assertIn('"26-021R": "Complete"', overrides)
        self.assertIn('"26-026": "Complete"', overrides)
        self.assertIn('"26-057": "Complete"', overrides)
        self.assertIn('"26-025": "In Progress"', overrides)

    def test_period_report_uses_current_borehole_statuses(self):
        start = INDEX_HTML.index("function periodRelevantProjectHoles")
        end = INDEX_HTML.index("function buildPeriodProjectOptions", start)
        period_status_logic = INDEX_HTML[start:end]
        self.assertIn("return uniqueBoreholesById(projectHoles||[]);", period_status_logic)
        self.assertIn("Current Borehole Planning status", INDEX_HTML)

    def test_period_report_reloads_and_reconciles_operating_hole_ids(self):
        self.assertIn("await ensureReportBoreholes(true);", INDEX_HTML)
        self.assertIn("function boreholeMatchValues", INDEX_HTML)
        self.assertIn("function renderPeriodReconciliation", INDEX_HTML)
        self.assertIn("Actual not loaded", INDEX_HTML)
        self.assertIn("projectNamesMatch(r.project,activeProjectName)", INDEX_HTML)


if __name__ == "__main__":
    unittest.main()
