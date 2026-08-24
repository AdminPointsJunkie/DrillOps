import unittest

from weatherford_reports import is_weatherford_gdb, parse_weatherford_gdb


def sample_tables(operation_rows, date="22/Aug/2026", total_time="11:30",
                  distance="", distance_over_100=""):
    return [
        [["Date:", "Engineer:", "Unit:"], [date, "Balan, George", "WV11603"]],
        [["Breakfast", "Lunch", "Dinner", "Accom"], ["WFT Supplied", "WFT Supplied", "WFT Supplied", "WFT Supplied"]],
        [["Driller Depth", "Logger TD"], ["249.4 m", "249.0 m"]],
        [["Shift Start\n(hh:mm)", "Shift Length\n(hh:mm)", "Total Time\n(hh:mm)", "Travel Time\n(hh:mm)", "Distance\n(km)", "Distance\n>100 km"],
         ["6:30", "10:00", total_time, "4:30", distance, distance_over_100]],
        [
            ["Operation", "Sonde\nSerial#", "Date", "Start Time\n(hh:mm)", "Depth/Int. (metres)", None, "Lost Time\n(mins)", "Total Time\n(hh:mm)", "Task Comments"],
            [None, None, None, None, "From", "To", None, None, None],
            *operation_rows,
        ],
    ]


class WeatherfordReportTests(unittest.TestCase):
    def test_logging_report_preserves_intervals_without_creating_drilled_metres(self):
        text = """Precision Energy Services (Australia) P/L
CLIENT: ARGO Site Number:
IRONBARK NO1
Site: ARGO Well Number:
IB-666C
Logging Operations Summary Eticket Reference: GDB08220530
"""
        tables = sample_tables([
            ["L300 Prestart Checks", "", "22/Aug/2026", "05:30", "", "", "", "00:30", ""],
            ["P200 Logging Run", "DUMM", "22/Aug/2026", "08:45", "1.0", "249.0", "", "00:45", ""],
            ["P200 Logging Run", "ATV071606", "22/Aug/2026", "13:00", "247.6", "125.0", "", "01:45", ""],
            ["End Job", "", "22/Aug/2026", "17:00", "", "", "", "", ""],
        ])

        header, activities, crew = parse_weatherford_gdb(text, tables, "GDB IB-666C.pdf")

        self.assertTrue(is_weatherford_gdb(text, "GDB IB-666C.pdf"))
        self.assertEqual(header["hole_num"], "IB-666C")
        self.assertEqual(header["site_name"], "IRONBARK NO1")
        self.assertEqual(header["eticket"], "GDB08220530")
        operation_rows = [row for row in activities if row["code"] in {"L300", "P200"}]
        self.assertEqual([row["code"] for row in operation_rows], ["L300", "P200", "P200"])
        self.assertEqual(operation_rows[0]["time_to"], "06:00")
        self.assertEqual(operation_rows[1]["time_to"], "09:30")
        self.assertEqual(operation_rows[1]["metres_from"], 1.0)
        self.assertEqual(operation_rows[1]["metres_to"], 249.0)
        self.assertIsNone(operation_rows[1]["total_metres"])
        self.assertIn("Sonde DUMM", operation_rows[1]["notes"])
        self.assertEqual(header["expected_cost_ex_gst"], 3587.0)
        self.assertTrue(any(row["code"] == "WFD_ATV_Rental" for row in activities))
        self.assertTrue(any("kilometres are blank" in warning for warning in header["pricing_warnings"]))
        self.assertEqual(crew[0]["role"], "Logging Engineer")
        self.assertEqual(crew[0]["hours"], 10.0)

    def test_induction_day_imports_service_rows_without_logging_runs(self):
        text = """Weatherford
Precision Energy Services (Australia) P/L
CLIENT: ARGO Site Number:
ARGO INDUCTION
Site: ARGO Well Number:
IRONBARK1
Logging Operations Summary Eticket Reference: GDB08050500
"""
        tables = sample_tables([
            ["L300 Safety Meeting", "", "05/Aug/2026", "07:00", "", "", "", "07:00", "INDUCTION"],
            ["N100 Base to/from Site", "", "05/Aug/2026", "15:00", "", "", "", "00:30", ""],
            ["End Job", "", "05/Aug/2026", "15:30", "", "", "", "", ""],
        ], date="05/Aug/2026", total_time="10:30", distance="150", distance_over_100="50")

        header, activities, _ = parse_weatherford_gdb(text, tables, "GDB induction.pdf")

        self.assertEqual(header["hole_num"], "IRONBARK1")
        operation_rows = [row for row in activities if row["code"] in {"L300", "N100", "P200"}]
        self.assertEqual([row["code"] for row in operation_rows], ["L300", "N100"])
        self.assertIn("INDUCTION", operation_rows[0]["notes"])
        self.assertFalse(any(row["code"] == "P200" for row in operation_rows))
        self.assertEqual(header["expected_cost_ex_gst"], 3103.5)


if __name__ == "__main__":
    unittest.main()
