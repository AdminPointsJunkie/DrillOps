import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPORT_HTML = (ROOT / "docs" / "report.html").read_text(encoding="utf-8")
INDEX_HTML = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
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

    def test_mcc_hides_consumables_and_dates_personnel_hours(self):
        self.assertIn("document.getElementById('consumables-section').style.display='none'", REPORT_HTML)
        self.assertIn("contractor==='MCC Group'?[]", REPORT_HTML)
        self.assertIn("<th>Date</th><th>Name</th><th>Role</th><th>Hours Worked</th>", REPORT_HTML)
        self.assertIn("reportDateKey(a.date)-reportDateKey(b.date)", REPORT_HTML)

    def test_daily_evidence_explainer_is_removed(self):
        self.assertNotIn("Daily audit begins 10 Aug 2026; one Light Vehicle accepted per represented day", REPORT_HTML)

    def test_unexpected_construction_trade_charge_is_red(self):
        self.assertIn("unexpected_charge:'Unexpected weekly charge'", REPORT_HTML)
        self.assertIn("charged?'bad':'warn'", REPORT_HTML)

    def test_mcc_personnel_panel_searches_and_shows_daily_swipe_evidence(self):
        self.assertIn('id="mcc-personnel-search"', INDEX_HTML)
        self.assertIn('id="mcc-personnel-detail"', INDEX_HTML)
        self.assertIn("function filterMccPersonnel()", INDEX_HTML)
        self.assertIn("Submitted − swipe", INDEX_HTML)
        self.assertIn("Overlapping device records are counted once", INDEX_HTML)

    def test_mcc_site_log_has_dedicated_import_and_reconciliation_endpoints(self):
        self.assertIn('id="mcc-swipe-input"', INDEX_HTML)
        self.assertIn("/mcc/swipe-history/import", INDEX_HTML)
        self.assertIn('@app.post("/mcc/swipe-history/import")', MAIN_PY)
        self.assertIn('@app.get("/mcc/personnel")', MAIN_PY)
        self.assertIn("sf.file_type='mcc_weekly_xlsx'", MAIN_PY)


if __name__ == "__main__":
    unittest.main()
