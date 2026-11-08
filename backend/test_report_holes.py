import unittest
from unittest.mock import patch

from report_holes import ocr_activity_hole, ocr_activity_notes, ocr_hole_warnings
from depco_rates import preview_depco_ocr


class ReportHoleTests(unittest.TestCase):
    def test_per_activity_identity_overrides_multi_hole_header(self):
        header = {'hole_num': 'TEST-A, TEST-B'}
        self.assertEqual(ocr_activity_hole({'hole_num': 'TEST-A'}, header), 'TEST-A')
        for activity in [{}, {'hole_num': None}, {'hole_num': ''}, {'hole_num': 'TEST-A / TEST-B'}]:
            self.assertEqual(ocr_activity_hole(activity, header), '')

    def test_legacy_single_header_and_explicit_unknown_are_distinct(self):
        self.assertEqual(ocr_activity_hole({}, {'hole_num': 'TEST-A'}), 'TEST-A')
        self.assertEqual(ocr_activity_hole({'hole_num': None}, {'hole_num': 'TEST-A'}), '')
        self.assertEqual(ocr_activity_hole({}, {'hole_num': 'N/A'}), '')

    def test_source_wording_is_kept_without_inventing_completion(self):
        self.assertEqual(ocr_activity_notes({'comments': 'Trip out', 'completion_note': 'Not EOH yet'}), 'Trip out\nSource completion note: Not EOH yet')
        self.assertEqual(ocr_activity_notes({'comments': 'Stand by logger'}), 'Stand by logger')

    def test_ambiguous_production_warns_instead_of_guessing(self):
        data = {'hole_num': 'TEST-A, TEST-B', 'activities': [{'comments': 'Cementing hole'}, {'comments': 'Drill', 'total_metres': 10, 'hole_num': 'TEST-B'}]}
        self.assertIn('1', ocr_hole_warnings(data)[0]['issue'])
        data['activities'][0]['hole_num'] = 'TEST-A'
        self.assertEqual(ocr_hole_warnings(data), [])

    def test_price_refresh_keeps_each_hole_and_completion_note(self):
        data = {'hole_num': 'TEST-A, TEST-B', 'activities': [{'hole_num': 'TEST-A', 'comments': 'Cementing hole', 'completion_note': 'Hole cemented to surface'}, {'hole_num': 'TEST-B', 'comments': 'Drill'}]}
        with patch('depco_rates.contract_rates', return_value=[]):
            result, _ = preview_depco_ocr(None, data, 'DEPCO Drilling', 'Alpha', 'Exploration')
        self.assertEqual([r['hole_num'] for r in result['activities']], ['TEST-A', 'TEST-B'])
        self.assertEqual(result['activities'][0]['completion_note'], 'Hole cemented to surface')


if __name__ == '__main__':
    unittest.main()
