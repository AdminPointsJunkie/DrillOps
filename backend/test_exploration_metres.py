import unittest

from exploration_metres import summarize_exploration_metres


class ExplorationMetresSummaryTests(unittest.TestCase):
    def test_deduplicates_rows_and_splits_crossing_depth_band(self):
        activities = [
            {"date": "2026-01-01", "hole_num": "CD001", "code": "Drill_Core", "metres_from": 90, "metres_to": 110, "total_metres": 20},
            {"date": "01/01/2026", "hole_num": "CD001", "code": "Drill_Core", "metres_from": 90, "metres_to": 110, "total_metres": 20},
            {"date": "2026-01-02", "hole_num": "IB001", "code": "Drill_Core", "metres_from": 295, "metres_to": 305, "total_metres": 10},
        ]
        result = summarize_exploration_metres(activities, [], 2026)
        cd, ib = result["sites"]

        self.assertEqual(cd["actual_metres"], 20)
        self.assertEqual(cd["deduplicated_rows"], 1)
        self.assertEqual(cd["depth_bands"][0]["metres"], 10)
        self.assertEqual(cd["depth_bands"][1]["metres"], 10)
        self.assertEqual(ib["depth_bands"][2]["metres"], 5)
        self.assertEqual(ib["depth_bands"][3]["metres"], 5)

    def test_remaining_uses_canonical_site_and_open_status(self):
        boreholes = [
            {"contractor": "Company", "planned_year": "2026", "project": "Ironbark", "hole_id": "26-001", "site_id": "26-001", "status": "Planned", "eoh_depth": 250},
            {"contractor": "Company", "planned_year": "2026", "project": "Ironbark", "hole_id": "IB001", "site_id": "26-001", "status": "In Progress", "eoh_depth": 250},
            {"contractor": "Company", "planned_year": "2026", "project": "Ironbark", "hole_id": "26-002", "site_id": "26-002", "status": "Complete", "eoh_depth": 300},
            {"contractor": "Company", "planned_year": "2026", "project": "Ironbark", "hole_id": "26-003", "site_id": "26-003", "status": "Cancelled", "eoh_depth": 200},
        ]
        activities = [
            {"date": "2026-02-01", "hole_num": "IB001", "site_name": "IB001", "code": "Drill_Core", "metres_from": 0, "metres_to": 225, "total_metres": 225},
        ]
        result = summarize_exploration_metres(activities, boreholes, 2026)
        ib = result["sites"][1]

        self.assertEqual(ib["remaining_metres"], 25)
        self.assertEqual(ib["open_holes"], 1)
        self.assertEqual(ib["in_progress_holes"], 1)

    def test_malformed_interval_uses_reported_metres(self):
        activities = [
            {"date": "2026-03-01", "hole_num": "CD002", "code": "Drill_Chip_or_Open_hole", "metres_from": 18, "metres_to": 14, "total_metres": 15},
        ]
        cd = summarize_exploration_metres(activities, [], 2026)["sites"][0]

        self.assertEqual(cd["actual_metres"], 15)
        self.assertEqual(cd["depth_bands"][0]["metres"], 15)
        self.assertEqual(cd["unallocated_depth_metres"], 0)


if __name__ == "__main__":
    unittest.main()
