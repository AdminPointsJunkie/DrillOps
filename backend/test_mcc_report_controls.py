import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPORT_HTML = (ROOT / "docs" / "report.html").read_text(encoding="utf-8")
MAIN_PY = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")


class MCCReportControlTests(unittest.TestCase):
    def test_report_uses_arg_workgroup_dropdown_and_allocation(self):
        for code in ("ARG-002", "ARG-003", "ARG-004", "ARG-005"):
            self.assertIn(code, REPORT_HTML)
        self.assertIn('class="mcc-workgroup-select"', REPORT_HTML)
        self.assertIn('class="mcc-allocation-input"', REPORT_HTML)
        self.assertIn("allocation_percent:value", REPORT_HTML)
        self.assertIn("mccAllocatedCost(row)", REPORT_HTML)

    def test_report_uses_lightweight_planned_hole_options(self):
        self.assertIn("/boreholes/options?", REPORT_HTML)
        self.assertIn('class="mcc-hole-select"', REPORT_HTML)
        self.assertIn("hole_num:holeChoice.hole_id", REPORT_HTML)
        self.assertIn("site_name:holeChoice.site_id||holeChoice.hole_id", REPORT_HTML)
        self.assertIn('@app.get("/boreholes/options")', MAIN_PY)

    def test_assignment_edits_do_not_reprice_rates(self):
        match = re.search(
            r"async function saveMccAssignmentPatch\(.*?\)\{(.*?)\n\}",
            REPORT_HTML,
            re.S,
        )
        self.assertIsNotNone(match)
        self.assertIn("method:'PATCH'", match.group(1))
        self.assertNotIn("/reprice", match.group(1))

    def test_allocation_is_persisted_separately_from_line_cost(self):
        self.assertIn("allocation_percent FLOAT DEFAULT 100", MAIN_PY)
        self.assertIn('"allocation_percent"', MAIN_PY)


if __name__ == "__main__":
    unittest.main()
