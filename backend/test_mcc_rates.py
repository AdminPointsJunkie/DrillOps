import unittest

from mcc_rates import (
    MCC_CUSTOM_RATES,
    MCC_SCHEDULE_RATES,
    apply_mcc_schedule_rate,
    mcc_schedule_match,
)


class MCCRatesTests(unittest.TestCase):
    def test_complete_schedule_has_expected_sections(self):
        self.assertEqual(len(MCC_SCHEDULE_RATES), 32)
        self.assertEqual(sum(row[4] == "labour" for row in MCC_SCHEDULE_RATES), 7)
        self.assertEqual(sum(row[4] == "equipment" for row in MCC_SCHEDULE_RATES), 25)

    def test_every_signed_schedule_value_is_present(self):
        expected = {
            "Labourer": (85.0, "hour"),
            "Construction Trade": (100.0, "hour"),
            "Mechanical Trade": (115.0, "hour"),
            "Pump Crew Operator": (95.0, "hour"),
            "Multi Skilled Operator": (100.0, "hour"),
            "Supervisor": (120.0, "hour"),
            "Project Manager": (140.0, "hour"),
            "Light Vehicle": (105.0, "day"),
            "5t Excavator": (50.0, "hour"),
            "13t Excavator": (85.0, "hour"),
            "36t Excavator": (115.0, "hour"),
            "Skid Steer": (50.0, "hour"),
            "10t Body Tip Truck": (50.0, "hour"),
            "Body Water Truck": (80.0, "hour"),
            "105 Horsepower Tractor": (85.0, "hour"),
            "Small Tool Hire": (50.0, "day"),
            "355mm Polywelder": (150.0, "day"),
            "Trailer Hire": (100.0, "day"),
            "Attachment for Equipment": (25.0, "hour"),
            "120t Excavator": (220.0, "hour"),
            "90t Excavator": (180.0, "hour"),
            "100t Dump Truck Class/Water Truck": (165.0, "hour"),
            "40t Articulated Water Truck": (130.0, "hour"),
            "IT Loader 15-20t Class": (85.0, "hour"),
            "Loader 110t Class": (230.0, "hour"),
            "Service Truck": (80.0, "hour"),
            "14ft Grader": (125.0, "hour"),
            "16ft Grader": (145.0, "hour"),
            "30t Articulated Dump Truck": (105.0, "hour"),
            "40t Articulated Dump Truck": (130.0, "hour"),
            "D11 Dozer": (225.0, "hour"),
            "D10 Dozer": (185.0, "hour"),
        }
        actual = {description: (rate, unit) for _, description, rate, unit, _, _ in MCC_SCHEDULE_RATES}
        self.assertEqual(actual, expected)

    def test_site_services_assets_match_schedule(self):
        self.assertEqual(len(MCC_CUSTOM_RATES), 3)
        supervisor = mcc_schedule_match("Supervisor", "labour")
        self.assertEqual((supervisor["rate"], supervisor["unit"], supervisor["source"]), (120.0, "hour", "schedule"))
        operator = mcc_schedule_match("Single Skill Operator", "labour")
        self.assertEqual((operator["code"], operator["rate"], operator["unit"]), ("MCC_OPERATOR", 100.0, "hour"))
        multi = mcc_schedule_match("Multi Skilled Operator", "labour")
        self.assertEqual((multi["code"], multi["rate"]), ("MCC_MULTI_SKILLED_OPERATOR", 100.0))
        self.assertEqual(mcc_schedule_match("LD04 CAT Backhoe 432", "equipment")["rate"], 65.0)
        self.assertEqual(mcc_schedule_match("WT01 HINO FM500 WATER TRUCK", "equipment")["rate"], 80.0)
        self.assertEqual(mcc_schedule_match("EX16 HITACHI ZX135US-7 EXCAVATOR", "equipment")["rate"], 85.0)
        vac = mcc_schedule_match("MCC39 ISUZU NPR400 VAC TRUCK", "equipment")
        self.assertEqual((vac["rate"], vac["unit"], vac["source"]), (1200.0, "day", "custom"))

    def test_assigns_hourly_and_daily_costs(self):
        hourly = {"quantity": 5.9}
        self.assertTrue(apply_mcc_schedule_rate(hourly, "equipment", "EX16 HITACHI 135 EXCAVATOR"))
        self.assertEqual(hourly["code"], "MCC_13T_EXCAVATOR")
        self.assertEqual(hourly["line_cost"], 501.5)
        self.assertIn("excludes accommodation and diesel", hourly["rate_basis"])

        daily = {"quantity": 8}
        self.assertTrue(apply_mcc_schedule_rate(daily, "equipment", "Light Vehicle"))
        self.assertEqual(daily["quantity"], 1)
        self.assertEqual(daily["line_cost"], 105.0)

        vacuum_truck = {"quantity": 3.5}
        self.assertTrue(apply_mcc_schedule_rate(vacuum_truck, "equipment", "MCC39 VAC TRUCK"))
        self.assertEqual(vacuum_truck["quantity"], 1)
        self.assertEqual(vacuum_truck["line_cost"], 1200.0)
        self.assertEqual(vacuum_truck["rate_basis"], "MCC custom rate - Vacuum Truck ($1,200.00/day)")

        operator = {"quantity": 2.8}
        self.assertTrue(apply_mcc_schedule_rate(operator, "labour", "Multi Skilled Operator"))
        self.assertEqual(operator["code"], "MCC_MULTI_SKILLED_OPERATOR")
        self.assertEqual(operator["unit_rate"], 100.0)
        self.assertEqual(operator["line_cost"], 280.0)

        supervisor = {"quantity": 2.8}
        self.assertTrue(apply_mcc_schedule_rate(supervisor, "labour", "Supervisor"))
        self.assertEqual(supervisor["code"], "MCC_SUPERVISOR")
        self.assertEqual(supervisor["unit_rate"], 120.0)
        self.assertEqual(supervisor["line_cost"], 336.0)
        self.assertEqual(supervisor["rate_basis"], "MCC schedule 23 April 2026 - Supervisor ($120.00/hour); excludes accommodation and diesel")

        single_skill = {"quantity": 7.5}
        self.assertTrue(apply_mcc_schedule_rate(single_skill, "labour", "Single Skill Operator"))
        self.assertEqual(single_skill["code"], "MCC_OPERATOR")
        self.assertEqual(single_skill["line_cost"], 750.0)

        missing_hours = {"quantity": None}
        self.assertTrue(apply_mcc_schedule_rate(missing_hours, "labour", "Labourer"))
        self.assertEqual(missing_hours["unit_rate"], 85.0)
        self.assertIsNone(missing_hours["line_cost"])


if __name__ == "__main__":
    unittest.main()
