import unittest
from datetime import datetime
from io import BytesIO

from openpyxl import Workbook

from mcc_weekly import build_mcc_daily_weekly_audit, parse_mcc_weekly_xlsx


HEADERS_WITHOUT_SHIFT_END = [
    "Created by",
    "Shift Time Start",
    "Site Location",
    "Job Description - Role",
    "Job Description - Location",
    "Job Description - Hours",
    "Job Description - Description of Work Performed",
    "Job Description - Equipment",
    "Job Description - SMU Start",
    "Job Description - SMU Finish",
    "Job Description - SMU Total",
]


def workbook_bytes(rows, duplicate_sheet=False):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Weekly"
    sheet.append(HEADERS_WITHOUT_SHIFT_END)
    for row in rows:
        sheet.append(row)
    if duplicate_sheet:
        copy = workbook.create_sheet("Workstream")
        copy.append(HEADERS_WITHOUT_SHIFT_END)
        for row in rows:
            copy.append(row)
    stream = BytesIO()
    workbook.save(stream)
    return stream.getvalue()


class MCCWeeklyTests(unittest.TestCase):
    def test_imports_new_format_without_shift_end(self):
        content = workbook_bytes([[
            "Kristy Faram",
            datetime(2026, 7, 20, 5, 30),
            "Ironbark 1",
            "Multi Skilled Operator",
            "ARG-004 - SIS Drill Watercart Works",
            2.5,
            "Water MG08-02L sumps",
            "WT01 - Hino FM500 13kL Watercart",
            100,
            102,
            2,
        ]])

        header, activities, _, crew, _ = parse_mcc_weekly_xlsx(
            content, "20260726-MCC-ARG-TimeSheetReport.xlsx"
        )

        self.assertEqual(header["date"], "20/07/2026")
        self.assertEqual(len(activities), 2)
        self.assertEqual({row["program"] for row in activities}, {"SIS"})
        self.assertEqual({row["code"] for row in activities}, {
            "MCC_MULTI_SKILLED_OPERATOR",
            "MCC_BODY_WATER_TRUCK",
        })
        self.assertEqual(sum(row["line_cost"] for row in activities), 450.0)
        self.assertTrue(all(row["time_to"] == "" for row in activities))
        self.assertEqual(len(crew), 1)

    def test_deduplicates_summary_and_workstream_sheets(self):
        row = [
            "Michael Chilby",
            datetime(2026, 7, 21, 5, 30),
            "Ironbark 1",
            "Supervisor",
            "ARG-002 - Gas Riser Civil Works",
            4,
            "Empty GR21 sumps",
            "MCC39 - Vac Truck - PER DAY",
            0,
            1,
            1,
        ]
        _, activities, _, crew, _ = parse_mcc_weekly_xlsx(
            workbook_bytes([row], duplicate_sheet=True), "weekly.xlsx"
        )

        self.assertEqual(len(activities), 2)
        self.assertEqual(len(crew), 1)
        self.assertEqual(sum(item["line_cost"] for item in activities), 1290.0)

    def test_prefers_arg_workstream_tabs_over_stale_summary(self):
        summary_row = [
            "Adam Vine", datetime(2026, 6, 22, 6), "Ironbark 1", "Supervisor",
            "ARG-003 - SIS Drill Civil Works", 8, "Provide supervision", None,
            None, None, None,
        ]
        corrected_row = list(summary_row)
        corrected_row[5] = 12.5
        corrected_row[6] = "Supervise spotter catcher works"
        workbook = Workbook()
        summary = workbook.active
        summary.title = "20260621-ARG-WeeklySheets"
        summary.append(HEADERS_WITHOUT_SHIFT_END)
        summary.append(summary_row)
        workstream = workbook.create_sheet("ARG-003 SIS Civils")
        workstream.append(HEADERS_WITHOUT_SHIFT_END)
        workstream.append(corrected_row)
        stream = BytesIO()
        workbook.save(stream)

        _, activities, _, _, _ = parse_mcc_weekly_xlsx(stream.getvalue(), "weekly.xlsx")

        self.assertEqual(len(activities), 1)
        self.assertEqual(activities[0]["quantity"], 12.5)
        self.assertEqual(activities[0]["line_cost"], 1500.0)

    def test_uses_smu_total_when_nightshift_hours_are_blank(self):
        content = workbook_bytes([[
            "Kristy Faram", datetime(2026, 8, 23, 5, 30), "Ironbark 1",
            "Multi Skilled Operator", "ARG-004 - SIS Drill Watercart Works", None,
            "Nightshift watercart hours", "WT01 - Hino FM500 13kL Watercart",
            1752.1, 1753.8, 1.7,
        ]])

        _, activities, _, crew, _ = parse_mcc_weekly_xlsx(content, "weekly.xlsx")

        self.assertEqual({row["quantity"] for row in activities}, {1.7})
        self.assertEqual(sum(row["line_cost"] for row in activities), 306.0)
        self.assertEqual(crew[0]["hours"], "1.7")

    def test_audit_keeps_weekly_cost_as_authoritative(self):
        rows = [
            {
                "date": "20/07/2026",
                "code": "MCC_BODY_WATER_TRUCK",
                "quantity": 8,
                "line_cost": 640,
                "source_file": "daily.pdf",
                "source_file_type": "mcc_site_services_pdf",
                "rate_description": "Body Water Truck",
                "rate_unit": "hour",
            },
            {
                "date": "20/07/2026",
                "code": "MCC_BODY_WATER_TRUCK",
                "quantity": 7.5,
                "line_cost": 600,
                "source_file": "weekly.xlsx",
                "source_file_type": "mcc_weekly_xlsx",
                "rate_description": "Body Water Truck",
                "rate_unit": "hour",
            },
        ]

        audit = build_mcc_daily_weekly_audit(rows)

        self.assertEqual(audit["totals"]["weekly_cost"], 600.0)
        self.assertEqual(audit["totals"]["daily_estimate"], 640.0)
        self.assertEqual(audit["totals"]["cost_variance"], -40.0)
        self.assertEqual(audit["comparison"][0]["status"], "variance")


if __name__ == "__main__":
    unittest.main()
