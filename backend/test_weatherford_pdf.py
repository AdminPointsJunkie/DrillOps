import asyncio
import unittest
from unittest.mock import patch, MagicMock, AsyncMock
from weatherford_pdf import read_weatherford_pdf
from test_weatherford_reports import sample_tables

TEXT = """Precision Energy Services
CLIENT: ARGO Site Number:
IRONBARK
Site: ARGO Well Number:
IB-666C
Logging Operations Summary Eticket Reference: GDB123
"""


def page(date="22/Aug/2026", ticket="GDB123", scanned=False):
    p = MagicMock()
    text = TEXT.replace("GDB123", ticket)
    tables = sample_tables([["L300 Prestart Checks", "", date, "05:30", "", "", "", "00:30", ""]], date=date)
    p.extract_text.return_value = "" if scanned else text
    p.extract_tables.return_value = tables
    return p, {"text": text, "tables": tables}


class PdfTests(unittest.IsolatedAsyncioTestCase):
    async def read(self, pages, responses=()):
        pdf = MagicMock()
        pdf.__enter__.return_value.pages = pages
        ocr = AsyncMock(side_effect=[(r, "") for r in responses])
        with patch("weatherford_pdf.pdfplumber.open", return_value=pdf):
            result = await read_weatherford_pdf(b"pdf", "scan.pdf", ocr)
        return result, ocr

    async def test_digital_pages_keep_dates_and_charge_each_day(self):
        a, _ = page()
        b, _ = page("23/Aug/2026", "GDB456")
        (header, rows, crew, _), ocr = await self.read([a, b])
        self.assertEqual(header["report_count"], 2)
        self.assertEqual({r["date"] for r in rows}, {"22/Aug/2026", "23/Aug/2026"})
        self.assertEqual(sum(r["code"] == "WFD_Callout_Day" for r in rows), 2)
        self.assertEqual(len(crew), 2)
        self.assertTrue(all(r["total_metres"] is None for r in rows))
        ocr.assert_not_called()

    async def test_scan_uses_ocr_and_warns(self):
        p, data = page(scanned=True)
        (header, rows, _, _), ocr = await self.read([p], [data])
        ocr.assert_awaited_once()
        self.assertTrue(any("Scanned report" in w for w in header["pricing_warnings"]))
        self.assertIn("Source page 1", rows[0]["notes"])

    async def test_bad_second_page_rejects_entire_batch(self):
        p, _ = page()
        bad, _ = page(scanned=True)
        with self.assertRaisesRegex(ValueError, "Page 2"):
            await self.read([p, bad], [{"text": "Unrelated invoice", "tables": []}])

    async def test_duplicate_ticket_rejected(self):
        p, _ = page()
        with self.assertRaisesRegex(ValueError, "repeated e-ticket"):
            await self.read([p, p])

    async def test_same_unit_day_does_not_double_bill(self):
        p, _ = page()
        q, _ = page(ticket="GDB456")
        p.extract_tables.return_value[3][1][2] = "07:30"
        q.extract_tables.return_value[3][1][2] = "04:00"
        p.extract_tables.return_value[3][1][4] = "150"
        q.extract_tables.return_value[3][1][4] = "100"
        q.extract_tables.return_value[3][1][5] = "-61"
        (_, rows, crew, _), _ = await self.read([p, q])
        self.assertEqual(sum(r["code"] == "WFD_Callout_Day" for r in rows), 1)
        charges = {r["code"]: r for r in rows if r["code"].startswith("WFD_")}
        self.assertEqual(charges["WFD_Additional_Hours"]["quantity"], 1.5)
        self.assertEqual(charges["WFD_Excess_Kilometres"]["quantity"], 150)
        self.assertEqual(sum(p["hours"] for p in crew), 11.5)

    async def test_expired_quote_warning(self):
        p, _ = page("12/Oct/2026")
        (header, _, _, _), _ = await self.read([p])
        self.assertTrue(any("renewed rates" in w for w in header["pricing_warnings"]))

    async def test_unreadable_time_rejected(self):
        p, data = page(scanned=True)
        data["tables"][-1][-1][7] = ""
        with self.assertRaisesRegex(ValueError, "unreadable time"):
            await self.read([p], [data])

    async def test_blank_reverse_page_is_skipped(self):
        p, _ = page()
        blank, _ = page(scanned=True)
        (header, _, _, _), _ = await self.read([p, blank], [{"text": "BLANK_PAGE", "tables": []}])
        self.assertEqual(header["report_count"], 1)
