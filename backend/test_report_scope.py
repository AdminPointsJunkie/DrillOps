import unittest
from pathlib import Path


INDEX_HTML = Path(__file__).resolve().parents[1] / "docs" / "index.html"


class ReportScopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = INDEX_HTML.read_text(encoding="utf-8")

    def function_body(self, name: str, next_name: str) -> str:
        start = self.html.index(f"function {name}(")
        end = self.html.index(f"function {next_name}(", start)
        return self.html[start:end]

    def test_period_report_contractor_comes_from_project_not_activity_selection(self):
        body = self.function_body("reportDrillingContractor", "contractorInProgram")

        self.assertIn("projectContractorsData", body)
        self.assertIn("activity_rows", body)
        self.assertNotIn("activeContractor", body)
        self.assertNotIn("drillops_report_drilling_contractor", body)

    def test_only_activity_reports_use_selected_contractor(self):
        self.assertIn("function pageUsesContractorSwitcher(page){return page==='activities';}", self.html)
        self.assertIn("var p=new URLSearchParams({contractor:activeContractor});", self.html)
        self.assertIn("const suffix='contractor='+encodeURIComponent(drillingContractor)", self.html)

    def test_workspace_requires_client_project_and_program(self):
        self.assertIn('id="workspace-client-select"', self.html)
        self.assertIn('id="workspace-project-select"', self.html)
        self.assertIn('id="workspace-program-select"', self.html)
        self.assertIn("function populateWorkspaceProgramOptions()", self.html)
        self.assertIn("workspaceProgramLabel(project, program)", self.html)
        self.assertIn("program:activeProgram", self.html)

    def test_period_report_uses_selected_program_year(self):
        self.assertIn("const reportYear=activeProjectYear();", self.html)
        self.assertIn("'&year='+encodeURIComponent(reportYear)", self.html)
        self.assertIn("const programLabel=activeWorkspaceProgramLabel();", self.html)
        self.assertIn("projectLabel+' - '+programLabel+' Drilling Report'", self.html)


if __name__ == "__main__":
    unittest.main()
