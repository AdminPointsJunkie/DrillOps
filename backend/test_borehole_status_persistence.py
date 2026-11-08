"""Exercise the actual startup status expression without changing any live records."""
import re
import sqlite3
import unittest
from pathlib import Path

class StatusPersistenceTests(unittest.TestCase):
    def test_workbook_refresh_preserves_saved_planner_decisions(self):
        source = (Path(__file__).parent / 'main.py').read_text()
        start = source.index('def sync_ironbark_budget_v5_4():')
        sql = source[start:source.index('@app.get("/project-budget-source")', start)]
        expression = re.search(r'\bstatus=(.*?),\s*notes=CASE', sql, re.S).group(1)
        expression = expression.replace('boreholes.status', ':saved').replace('EXCLUDED.status', ':imported')
        conn = sqlite3.connect(':memory:')
        conn.create_function('BTRIM', 1, lambda s: s.strip() if s is not None else None)
        for saved, imported, expected in [
            ('Cancelled', 'Planned', 'Cancelled'),
            ('Cancelled', 'Complete', 'Cancelled'),
            ('Planned', 'Cancelled', 'Planned'),
            ('In Progress', 'Cancelled', 'In Progress'),
            ('Complete', 'Planned', 'Complete'),
            ('', 'Planned', 'Planned'),
            (None, 'Cancelled', 'Cancelled'),
        ]:
            with self.subTest(saved=saved, imported=imported):
                actual = conn.execute('SELECT ' + expression, {'saved': saved, 'imported': imported}).fetchone()[0]
                self.assertEqual(actual, expected)
        conn.close()

if __name__ == '__main__':
    unittest.main()
