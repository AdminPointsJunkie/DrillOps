import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_HTML = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")


class ReportMCCChargeTests(unittest.TestCase):
    def test_report_loads_authoritative_mcc_activity_rows(self):
        self.assertIn("periodMccActivitiesData=[]", INDEX_HTML)
        self.assertIn("activities?contractor='+encodeURIComponent('MCC Group')", INDEX_HTML)
        self.assertIn("periodMccActivitiesData=Array.isArray(results[5])?results[5]:[]", INDEX_HTML)

    def test_mcc_summary_adds_only_unbilled_balance(self):
        match = re.search(
            r"function periodMccChargeSummary\(invoices\)\{(.*?)\n\}",
            INDEX_HTML,
            re.S,
        )
        self.assertIsNotNone(match)
        summary = match.group(1)
        self.assertIn("weeklyTotal-invoiceTotal", summary)
        self.assertIn("actual:invoiceTotal+unbilled", summary)
        self.assertNotIn("actual:invoiceTotal+weeklyTotal", summary)

    def test_report_total_and_contractor_card_use_unbilled_only(self):
        self.assertIn("supportCost=supportInvoiceCost+mccChargeSummary.unbilled", INDEX_HTML)
        self.assertIn("item.spent+=mccUnbilled", INDEX_HTML)
        self.assertIn("Total support actuals", INDEX_HTML)
        self.assertIn("Unbilled accrual", INDEX_HTML)

    def test_non_authoritative_mcc_rows_are_excluded(self):
        match = re.search(
            r"function periodFilteredMccCharges\(\)\{(.*?)\n\}",
            INDEX_HTML,
            re.S,
        )
        self.assertIsNotNone(match)
        self.assertIn("row.is_cost_source", match.group(1))


if __name__ == "__main__":
    unittest.main()
