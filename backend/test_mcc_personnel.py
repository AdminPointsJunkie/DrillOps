import unittest
from datetime import datetime

from mcc_personnel import (
    build_mcc_personnel_reconciliation,
    looks_like_site_log_csv,
    parse_site_log_csv,
)


HEADERS = (
    "Time In,Time Out,Timezone,Dur (h:m),Site,Logpoint,First Name,Last Name,"
    "Person ID,Type,Local Mode,Breach,Original Recorded Time Out<br>(from Force Logout),"
    "Contact,Company,Crew,Activity\n"
)


class MCCPersonnelTests(unittest.TestCase):
    def test_parses_only_mcc_rows_and_marks_open_swipe(self):
        content = (HEADERS
            + "30-08-26 05:29,30-08-26 17:34,Australia/Queensland,12:04,Ironbark,Wallmount,Mark,Ferriday,005,Contractor,,,,,MCC Group,- none -,Ironbark No.1\n"
            + "31-08-26 05:29,Not,Australia/Queensland,10:36,Ironbark,Wallmount,Mark,Ferriday,005,Contractor,,,,,MCC Group,- none -,Ironbark No.1\n"
            + "31-08-26 06:00,31-08-26 18:00,Australia/Queensland,12:00,Ironbark,Wallmount,Other,Person,006,Contractor,,,,,Other Co,- none -,Ironbark No.1\n"
        ).encode()

        self.assertTrue(looks_like_site_log_csv(content))
        rows = parse_site_log_csv(content, "Site Log.csv")

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["event_date"].isoformat(), "2026-08-30")
        self.assertEqual(rows[0]["duration_minutes"], 724)
        self.assertFalse(rows[0]["open_shift"])
        self.assertTrue(rows[1]["open_shift"])

    def test_overlapping_swipe_records_are_not_double_counted(self):
        crew = [{"name": "Alex Smith", "date": "30/08/2026", "hours": "10", "role": "Operator"}]
        swipes = [
            {"person_name": "Alex Smith", "event_date": "2026-08-30", "time_in": datetime(2026, 8, 30, 6), "duration_minutes": 600, "logpoint": "Wallmount"},
            {"person_name": "Alex Smith", "event_date": "2026-08-30", "time_in": datetime(2026, 8, 30, 8), "duration_minutes": 120, "logpoint": "Turnstile"},
            {"person_name": "Alex Smith", "event_date": "2026-08-30", "time_in": datetime(2026, 8, 30, 6, 1), "duration_minutes": 0, "logpoint": "Turnstile"},
        ]

        result = build_mcc_personnel_reconciliation(crew, swipes)
        day = result["people"][0]["days"][0]

        self.assertEqual(day["swipe_hours"], 10.0)
        self.assertEqual(day["status"], "verified")
        self.assertEqual(day["swipe_events"], 3)

    def test_flags_variance_missing_evidence_and_unsubmitted_swipes(self):
        crew = [
            {"name": "Alex Smith", "date": "30/08/2026", "hours": "12", "role": "Operator", "source_file": "weekly.xlsx"},
            {"name": "No Swipe", "date": "30/08/2026", "hours": "8", "role": "Supervisor", "source_file": "weekly.xlsx"},
        ]
        swipes = [
            {"person_name": "Alex Smith", "person_id": "001", "event_date": "2026-08-30", "time_in": datetime(2026, 8, 30, 6), "duration_minutes": 600},
            {"person_name": "Swipe Only", "person_id": "002", "event_date": "2026-08-30", "time_in": datetime(2026, 8, 30, 7), "duration_minutes": 480},
        ]

        people = {row["name"]: row for row in build_mcc_personnel_reconciliation(crew, swipes)["people"]}

        self.assertEqual(people["Alex Smith"]["status"], "variance")
        self.assertEqual(people["Alex Smith"]["variance_hours"], 2.0)
        self.assertEqual(people["No Swipe"]["status"], "no_swipe")
        self.assertEqual(people["Swipe Only"]["status"], "no_timesheet")

    def test_open_shift_requires_review_even_when_exported_duration_matches(self):
        crew = [{"name": "Alex Smith", "date": "30/08/2026", "hours": "8"}]
        swipes = [{
            "person_name": "Alex Smith",
            "event_date": "2026-08-30",
            "time_in": datetime(2026, 8, 30, 6),
            "duration_minutes": 480,
            "open_shift": True,
        }]

        person = build_mcc_personnel_reconciliation(crew, swipes)["people"][0]

        self.assertEqual(person["status"], "open_swipe")
        self.assertEqual(person["days"][0]["time_out"], "Not logged out")


if __name__ == "__main__":
    unittest.main()
