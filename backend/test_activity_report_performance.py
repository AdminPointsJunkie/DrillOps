import re
import unittest
from pathlib import Path


INDEX_HTML = Path(__file__).resolve().parents[1] / "docs" / "index.html"


class ActivityReportPerformanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = INDEX_HTML.read_text(encoding="utf-8")

    def function_body(self, name, next_name):
        match = re.search(
            rf"async function {name}\(.*?\)\{{(.*?)\n\}}\n\nasync function {next_name}",
            self.html,
            re.S,
        )
        self.assertIsNotNone(match, f"Could not locate {name}")
        return match.group(1)

    def test_activity_reports_do_not_wait_for_combined_mcc_audit(self):
        body = self.function_body("loadActivities", "addActivityRow")

        self.assertNotIn("/mcc/weekly-audit", body)
        self.assertNotIn("await ensureReportBoreholes()", body)
        self.assertNotIn("ensureReportBoreholes().then(renderPeriodReport)", body)
        self.assertIn("renderActivities(activitiesData)", body)

    def test_collapsed_raw_tables_are_rendered_only_when_opened(self):
        self.assertIn("const opening=panel.classList.contains('collapsed')", self.html)
        self.assertIn("if(panelId==='activity-log-panel')renderActivities(activitiesData)", self.html)
        self.assertIn("if(panel&&panel.classList.contains('collapsed'))", self.html)
        self.assertGreaterEqual(
            self.html.count("if(panel&&panel.classList.contains('collapsed'))"),
            3,
        )

    def test_combined_mcc_audit_loads_only_when_opened(self):
        self.assertIn("if(opening)loadMccWeeklyAudit();", self.html)
        self.assertIn("Combined exceptions are calculated only when opened", self.html)

    def test_activity_register_does_not_render_the_hidden_period_report(self):
        self.assertIn("if(isPageActive('reports'))renderPeriodReport();", self.html)

    def test_portal_startup_does_not_preload_activity_reports(self):
        match = re.search(
            r"async function initializePortal\(\)\{(.*?)\n\}",
            self.html,
            re.S,
        )
        self.assertIsNotNone(match, "Could not locate initializePortal")
        self.assertNotIn("await loadActivities()", match.group(1))
        self.assertIn("drawerNav(savedPageButton)", match.group(1))


if __name__ == "__main__":
    unittest.main()
