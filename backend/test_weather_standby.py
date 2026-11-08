import ast
import unittest
from pathlib import Path
from activity_categories import is_weather_standby


class WeatherStandbyTests(unittest.TestCase):
    def test_explicit_weather_and_access_delays(self):
        for notes in ['Wet weather', 'Inclement weather/Lightning', 'Site to wet to move heavy vehicles', 'Raining, to wet to work', 'Rain/site to wet for access/work', 'Site access inspection (wet weather)', 'Inspected site for how wet site wet but no heavy vehicle movement on site']:
            with self.subTest(notes=notes):
                self.assertTrue(is_weather_standby(notes))

    def test_unrelated_and_negated_notes(self):
        for notes in ['Waiting on training so we can move gear', 'Escort logger to another hole for gas drainage', 'Pump water after rain', 'No wet weather today', 'Weather cleared; continue drilling', 'Travel to site']:
            with self.subTest(notes=notes):
                self.assertFalse(is_weather_standby(notes))

    def test_import_mapping_uses_weather_only_for_generic_time_categories(self):
        source = Path(__file__).with_name('main.py')
        tree = ast.parse(source.read_text())
        nodes = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name == 'coreplan_category_code') or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'COREPLAN_CATEGORY_CODES' for t in n.targets))]
        scope = {}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), scope)
        code = scope['coreplan_category_code']
        self.assertEqual(code('Other_Work_Rate', 'Wet weather'), 'H_Standby_Wet_Weath')
        self.assertEqual(code('Wet Weather', ''), 'H_Standby_Wet_Weath')
        self.assertEqual(code('Standby', 'Inclement weather/Lightning'), 'H_Standby_Wet_Weath')
        self.assertEqual(code('Other_Work_Rate', 'Gas drainage'), 'H_Active')
        self.assertEqual(code('Travel', 'Travel from site in wet weather'), 'H_Crew_Travel_Off')
        self.assertEqual(code('Reaming', 'Work continued in wet weather'), 'H_Reaming')


if __name__ == '__main__':
    unittest.main()
