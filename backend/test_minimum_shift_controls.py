import ast
import re
import unittest
from pathlib import Path


MAIN_PY = Path(__file__).with_name("main.py")
FUNCTIONS = {
    "allianz_minimum_shift_group_key",
    "minimum_shift_rule",
    "is_generated_minimum_shift_topup",
    "minimum_shift_base_cost",
    "is_imported_minimum_shift_row",
    "minimum_shift_activity_subtotal",
    "minimum_shift_non_minimum_total",
    "adjust_imported_minimum_shift_rows",
}


def _load_minimum_shift_functions():
    tree = ast.parse(MAIN_PY.read_text(encoding="utf-8"))
    nodes = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name in FUNCTIONS
    ]
    namespace = {
        "re": re,
        "MINIMUM_SHIFT_RULES": {
            "Mitchells Drilling": {
                "cost": 7800.00,
                "active_rate": 650.00,
                "note": "Mitchells minimum shift top-up to $7,800",
                "label": "Mitchells",
            }
        },
        "SUPPORT_EQUIPMENT_CODE_RE": re.compile(r"^D_(Backhoe|Water)", re.I),
    }
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(MAIN_PY), "exec"), namespace)
    return namespace


class MinimumShiftControlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.functions = _load_minimum_shift_functions()

    @staticmethod
    def _row(code, line_cost, **overrides):
        row = {
            "contractor": "Mitchells Drilling",
            "source_file": "5623-260705D.csv",
            "date": "2026-07-05",
            "hole_num": "IB656C",
            "code": code,
            "line_cost": line_cost,
            "notes": "",
        }
        row.update(overrides)
        return row

    def test_corrupt_locked_topup_is_recalculated_to_contract_minimum(self):
        minimum = self._row(
            "H_Min_Shift",
            77462.50,
            notes="DD minimum shift charge",
            unit_rate=650.00,
            quantity=119.17,
        )
        rows = [
            minimum,
            self._row("H_Crew_Travel_On", 487.50),
            self._row("H_Safety_Contractor", 162.50),
            self._row("H_Safety_Prestart", 0),
            self._row("H_Active", 543.75),
            self._row("H_Tripping_Rods", 362.50),
            self._row("H_Rig_Cementing", 1450.00),
        ]
        key = self.functions["allianz_minimum_shift_group_key"](minimum)

        adjusted = self.functions["adjust_imported_minimum_shift_rows"](
            rows,
            "Mitchells Drilling",
            target_total_by_key={key: 80468.75},
        )

        self.assertEqual(adjusted[0]["line_cost"], 4793.75)
        self.assertEqual(adjusted[0]["quantity"], 7.38)
        self.assertIn("= $7,800.00", adjusted[0]["rate_basis"])
        self.assertNotIn("approved/custom total preserved", adjusted[0]["rate_basis"])

    def test_valid_locked_custom_total_is_still_preserved(self):
        minimum = self._row(
            "H_Min_Shift",
            7000.00,
            notes="DD minimum shift charge",
            unit_rate=650.00,
            quantity=10.77,
        )
        rows = [minimum, self._row("H_Active", 3000.00)]
        key = self.functions["allianz_minimum_shift_group_key"](minimum)

        adjusted = self.functions["adjust_imported_minimum_shift_rows"](
            rows,
            "Mitchells Drilling",
            target_total_by_key={key: 10000.00},
        )

        self.assertEqual(adjusted[0]["line_cost"], 7000.00)
        self.assertIn("approved/custom total preserved", adjusted[0]["rate_basis"])


if __name__ == "__main__":
    unittest.main()
