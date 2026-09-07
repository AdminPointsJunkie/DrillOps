import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_HTML = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
MAIN_PY = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")


class InvoiceControlTests(unittest.TestCase):
    def test_manual_invoice_allows_first_invoice_for_workspace_supplier(self):
        helper = re.search(
            r"function invoiceContractorsForWorkspace\(program\) \{(.*?)\n\}",
            INDEX_HTML,
            re.S,
        )
        self.assertIsNotNone(helper)
        self.assertIn("CONTRACTORS.forEach", helper.group(1))
        self.assertNotIn("filteredContractors()", helper.group(1))

        form = re.search(
            r"function populateManualInvoiceForm\(programChanged\)\{(.*?)\n\}",
            INDEX_HTML,
            re.S,
        )
        self.assertIsNotNone(form)
        self.assertIn("invoiceContractorsForWorkspace(program)", form.group(1))

    def test_invoice_register_queries_workspace_supplier_candidates(self):
        loader = re.search(
            r"async function loadInvoices\(preferredContractor\)\{(.*?)\n\}",
            INDEX_HTML,
            re.S,
        )
        self.assertIsNotNone(loader)
        self.assertIn("invoiceContractorsForWorkspace()", loader.group(1))

    def test_manual_invoice_persists_program(self):
        start = MAIN_PY.index('@app.post("/invoices/manual")')
        end = MAIN_PY.index('@app.get("/invoices")', start)
        route = MAIN_PY[start:end]
        self.assertIn('"program": str(payload.get("program")', route)
        self.assertIn("project,program,client", route)


if __name__ == "__main__":
    unittest.main()
