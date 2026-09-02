import unittest

from mcc_invoice import parse_mcc_invoice_pdf, reconcile_mcc_invoice_lines


INVOICE_TEXT = """MCC Group Pty Ltd
Tax Invoice
INVOICE TO INVOICE ARG-EXP-0826/4
DATE 27/08/2026
DUE DATE 26/09/2026
PO REF NO
I124540 17 to 23 August 2026
ACTIVITY QTY RATE GST AMOUNT
Labour Services 51 120.00 GST 6,120.00
Supervisor
Hire - Ancillary Equipment 18.80 85.00 GST 1,598.00
Backhoe
Hire - Ancillary Equipment 3 1,500.00 GST 4,500.00
Vac Truck
Hire - Light Vehicles 7 105.00 GST 735.00
Hire - Ancillary Equipment 1 4,647.70 GST 4,647.70
Coates Hire Inv 24998595 - Trash Pump
SUBTOTAL 17,600.70
GST TOTAL 1,760.07
TOTAL 19,360.77
"""


class MCCInvoiceTests(unittest.TestCase):
    def test_parses_number_period_and_rate_items(self):
        invoice = parse_mcc_invoice_pdf(INVOICE_TEXT, "invoice.pdf")

        self.assertEqual(invoice["invoice_number"], "ARG-EXP-0826/4")
        self.assertEqual((invoice["service_start"], invoice["service_end"]), ("2026-08-17", "2026-08-23"))
        self.assertEqual(invoice["po_reference"], "I124540")
        self.assertEqual(invoice["subtotal"], 17600.70)
        self.assertEqual([line["activity_code"] for line in invoice["lines"][:4]], [
            "MCC_SUPERVISOR", "MCC_BACKHOE", "MCC_VAC_TRUCK", "MCC_LIGHT_VEHICLE",
        ])
        self.assertIsNone(invoice["lines"][4]["activity_code"])

    def test_reconciliation_flags_invoice_rates_without_changing_contract_rates(self):
        invoice = parse_mcc_invoice_pdf(INVOICE_TEXT, "invoice.pdf")
        weekly = [
            {"date": "17/08/2026", "code": "MCC_SUPERVISOR", "quantity": 51, "notes": "Charge type: Labour"},
            {"date": "17/08/2026", "code": "MCC_BACKHOE", "quantity": 27, "notes": "SMU: 100 to 118.8 (18.8) | Charge type: Equipment"},
            {"date": "19/08/2026", "code": "MCC_VAC_TRUCK", "quantity": 1, "notes": "Charge type: Equipment"},
            {"date": "22/08/2026", "code": "MCC_VAC_TRUCK", "quantity": 1, "notes": "Charge type: Equipment"},
            {"date": "22/08/2026", "code": "MCC_VAC_TRUCK", "quantity": 0, "notes": "Charge type: Equipment"},
            {"date": "23/08/2026", "code": "MCC_VAC_TRUCK", "quantity": 1, "notes": "Charge type: Equipment"},
        ]

        result = reconcile_mcc_invoice_lines(invoice["lines"], weekly)
        by_code = {line.get("activity_code") or "extra": line for line in result}

        self.assertEqual(by_code["MCC_SUPERVISOR"]["match_status"], "rate_error")
        self.assertEqual(by_code["MCC_SUPERVISOR"]["matched_eos_rate"], 38.5)
        self.assertEqual(by_code["MCC_BACKHOE"]["match_status"], "rate_error")
        self.assertEqual(by_code["MCC_BACKHOE"]["matched_eos_rate"], 65.0)
        self.assertEqual(by_code["MCC_BACKHOE"]["matched_eos_quantity"], 18.8)
        self.assertEqual(by_code["MCC_VAC_TRUCK"]["match_status"], "rate_error")
        self.assertEqual(by_code["MCC_VAC_TRUCK"]["matched_eos_rate"], 810.0)
        self.assertEqual(by_code["MCC_VAC_TRUCK"]["matched_eos_quantity"], 3.0)
        self.assertEqual(by_code["MCC_LIGHT_VEHICLE"]["match_status"], "no_weekly_evidence")
        self.assertEqual(by_code["extra"]["match_status"], "supporting_document_required")


if __name__ == "__main__":
    unittest.main()
