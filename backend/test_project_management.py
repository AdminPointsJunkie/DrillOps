import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_HTML = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
MAIN_PY = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")


class ProjectManagementTests(unittest.TestCase):
    def test_creating_duplicate_project_does_not_update_existing_project(self):
        start = MAIN_PY.index('@app.post("/projects")')
        end = MAIN_PY.index('@app.patch("/projects/{project_id}")', start)
        create_route = MAIN_PY[start:end]

        self.assertNotIn("ON CONFLICT (contractor, name) DO UPDATE", create_route)
        self.assertIn("LOWER(BTRIM(name))=LOWER(BTRIM(%s))", create_route)
        self.assertIn("already exists. Open it from Projects and use Edit", create_route)
        self.assertIn("raise HTTPException(409", create_route)

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
