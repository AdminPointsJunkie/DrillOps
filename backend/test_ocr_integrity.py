import ast
import re
import unittest
from datetime import date as calendar_date
from pathlib import Path


MAIN_PY = Path(__file__).with_name("main.py")


def load_integrity_helpers():
    tree = ast.parse(MAIN_PY.read_text(encoding="utf-8"))
    wanted = {
        "SITE_NAME_ALIASES",
        "canonical_site_name",
        "_clock_minutes",
        "_normalised_report_date",
        "_filename_report_date",
        "activity_integrity_qa",
        "normalise_safe_ocr_fields",
    }
    nodes = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in wanted:
            nodes.append(node)
        elif isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id in wanted for target in node.targets
        ):
            nodes.append(node)
    namespace = {"re": re, "calendar_date": calendar_date}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(MAIN_PY), "exec"), namespace)
    return namespace


class OcrIntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.helpers = load_integrity_helpers()

    def test_flags_the_known_ocr_defects_without_flagging_valid_metres_or_times(self):
        rows = [
            {"date": "03/04/2024", "site_name": "Iron Bark", "location": "Ironbark"},
            {
                "date": "03/04/2024", "notes": "Drill 4 3/4 PCD", "site_name": "Ironbark",
                "time_from": "7:45", "time_to": "11:45", "total_time": "4:00",
                "metres_from": 144.52, "metres_to": 187.52, "total_metres": 43,
            },
            {
                "date": "03/04/2024", "notes": "Standby - checking water", "site_name": "Ironbark",
                "time_from": "12:30", "time_to": "13:30", "total_time": "1:00", "code": "2024",
            },
        ]
        warnings = self.helpers["activity_integrity_qa"](rows, "DEPCO DAR 2026-06-03.pdf")
        issues = [warning["issue"] for warning in warnings]

        self.assertTrue(any("conflicts with filename date" in issue for issue in issues))
        self.assertTrue(any("Blank activity row" in issue for issue in issues))
        self.assertTrue(any("four-digit year" in issue for issue in issues))
        self.assertTrue(any("normalised to \"Ironbark\"" in issue for issue in issues))
        self.assertFalse(any("Duration" in issue for issue in issues))
        self.assertFalse(any("Drilled metres do not match" in issue for issue in issues))

    def test_proposes_only_safe_normalisations(self):
        normalise = self.helpers["normalise_safe_ocr_fields"]
        self.assertEqual(
            normalise({"site_name": "Iron Bark", "location": "Ironbark", "code": "2024"}),
            {"site_name": "Ironbark", "code": ""},
        )
        self.assertEqual(normalise({"site_name": "Unknown Site", "code": "H_Standby"}), {})


if __name__ == "__main__":
    unittest.main()
