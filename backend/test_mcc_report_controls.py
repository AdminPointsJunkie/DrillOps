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

    def test_mcc_line_items_hide_rate_basis_column(self):
        match = re.search(
            r"function renderMccSiteServiceLineItems\(rows\)\{(.*?)\n\}",
            REPORT_HTML,
            re.S,
        )
        self.assertIsNotNone(match)
        self.assertNotIn("<th>Rate Basis</th>", match.group(1))
        self.assertNotIn("esc(row.rate_basis", match.group(1))
        self.assertIn('colspan="8"', match.group(1))

    def test_mcc_report_hides_earthworks_cost_summary(self):
        self.assertNotIn("Earthworks Cost Summary", REPORT_HTML)
        self.assertIn("document.getElementById('timeline').style.display='none'", REPORT_HTML)

    def test_mcc_personnel_report_shows_rate_list_cost(self):
        self.assertIn("/rates/hourly?contractor=", REPORT_HTML)
        self.assertIn("function mccCrewCost(row)", REPORT_HTML)
        self.assertIn("<th>Hours Worked</th><th>Cost</th>", REPORT_HTML)

    def test_mcc_weekly_personnel_only_shows_arg_005_exploration(self):
        self.assertIn('id="personnel-title"', REPORT_HTML)
        self.assertIn("function mccExplorationCrew(crew,rows)", REPORT_HTML)
        self.assertIn("Personnel — ARG-005 Exploration", REPORT_HTML)
        self.assertIn("weekly?mccExplorationCrew(reportCrewRows,rows):reportCrewRows", REPORT_HTML)

    def test_weekly_kpi_boxes_are_replaced_by_invoice_style_cost_hours_summary(self):
        self.assertNotIn('id="weekly-facts"', REPORT_HTML)
        self.assertNotIn("['Represented workdays',String(context.workdays)]", REPORT_HTML)
        self.assertIn("Costs &amp; Hours Summary", REPORT_HTML)
        self.assertIn("function renderWeeklyCostHoursSummary(context)", REPORT_HTML)
        self.assertIn("weekly-cost-subtotal", REPORT_HTML)
        self.assertIn("Weekly total", REPORT_HTML)

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
        self.assertIn('id="mcc-swipe-evidence-dialog"', INDEX_HTML)
        self.assertIn("openMccSwipeEvidence", INDEX_HTML)
        self.assertIn("overlapping device events", INDEX_HTML)
        self.assertIn("submitted hours are used when the recorded total exceeds 15 h", INDEX_HTML)
        self.assertIn("Recorded swipe over 15 hours", INDEX_HTML)
        self.assertIn("Overlapping device records are counted once", INDEX_HTML)

    def test_mcc_site_log_has_dedicated_import_and_reconciliation_endpoints(self):
        self.assertIn('id="mcc-swipe-input"', INDEX_HTML)
        self.assertIn("/mcc/swipe-history/import", INDEX_HTML)
        self.assertIn('@app.post("/mcc/swipe-history/import")', MAIN_PY)
        self.assertIn('@app.get("/mcc/personnel")', MAIN_PY)
        self.assertIn("sf.file_type='mcc_weekly_xlsx'", MAIN_PY)

    def test_mcc_daily_register_hides_drilling_and_cost_columns(self):
        self.assertIn("#report-table.mcc-earthworks .mcc-drilling-only{display:none;}", INDEX_HTML)
        for heading in ("Rig", "Driller", "Depth (m)", "Total Cost"):
            self.assertIn(f'<th class="mcc-drilling-only">{heading}</th>', INDEX_HTML)
        self.assertIn("reportTable.classList.toggle('mcc-earthworks',isMccEarthworks)", INDEX_HTML)

    def test_mcc_daily_csv_omits_drilling_and_cost_fields(self):
        start = INDEX_HTML.index("function downloadDailyReportsCSV()")
        end = INDEX_HTML.index("// ── Consumables", start)
        csv_export = INDEX_HTML[start:end]
        self.assertIn("if(!isMccEarthworks)", csv_export)
        for field in ("row.rig", "row.driller", "row.metres", "row.cost"):
            self.assertIn(field, csv_export)

    def test_main_importer_routes_site_log_csv_to_swipe_history(self):
        self.assertIn("async function isMccSiteLogCsv(file)", INDEX_HTML)
        self.assertIn("async function mccOnlySiteLogFile(file)", INDEX_HTML)
        self.assertIn("toLowerCase()==='mcc group'", INDEX_HTML)
        self.assertIn("fd.append('file',mccUpload.file)", INDEX_HTML)
        self.assertIn("isMccSiteLog:await isMccSiteLogCsv(file)", INDEX_HTML)
        self.assertIn("if(hasOperationalReports&&(!importScope.client||!importScope.project))", INDEX_HTML)
        self.assertIn("API+'/mcc/swipe-history/import'", INDEX_HTML)
        self.assertIn("MCC swipe records", INDEX_HTML)

    def test_swipe_import_error_remains_visible_in_personnel_panel(self):
        start = INDEX_HTML.index("async function importMccSwipeHistory(file)")
        end = INDEX_HTML.index("function toggleMccCombinedAudit()", start)
        importer = INDEX_HTML[start:end]
        self.assertIn("Uploading and checking", importer)
        self.assertIn("Site Log import failed:", importer)

    def test_mcc_personnel_csv_download_is_available(self):
        self.assertIn('onclick="downloadMccPersonnelCSV()"', INDEX_HTML)
        self.assertIn("function downloadMccPersonnelCSV()", INDEX_HTML)
        self.assertIn("mcc-personnel-reconciliation.csv", INDEX_HTML)
        self.assertIn("numVal(person.submitted_hours)>0", INDEX_HTML)


if __name__ == "__main__":
    unittest.main()
