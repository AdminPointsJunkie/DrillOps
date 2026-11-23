import unittest
from datetime import date
from report_holes import ironbark_ocr_rules


class IronbarkImportRules(unittest.TestCase):
    def check(self, day='22/11/2026', hole='IB671C', bit='HQ3', filename='DEPCO DR17 DAR 20261122.pdf'):
        data = {'date': day, 'client': 'misread', 'activities': [{'hole_num': hole, 'bit_type': bit}]}
        return data, ironbark_ocr_rules(data, 'Ironbark', filename, date(2026, 11, 23))

    def test_recent_report_and_client(self):
        data, warnings = self.check()
        self.assertEqual(warnings, [])
        self.assertEqual(data['client'], 'Argo')

    def test_bad_year_future_and_filename_conflict(self):
        for day in ['22/11/2018', '24/11/2026', '01/11/2026', '']:
            self.assertTrue(self.check(day=day)[1])
        self.assertTrue(self.check(day='21/11/2026')[1])
        self.assertFalse(self.check(day='09/11/2026', filename='scan.pdf')[1])

    def test_hole_rules_do_not_invent_identity(self):
        for hole in ['1B671C', 'CR671C', 'IB671']:
            data, warnings = self.check(hole=hole)
            self.assertTrue(warnings)
            self.assertEqual(data['activities'][0]['hole_num'], hole)
        self.assertFalse(self.check(hole='IB671', bit='PCD')[1])

    def test_other_projects_unchanged(self):
        data = {'date': '22/11/2018', 'client': 'Other'}
        self.assertEqual(ironbark_ocr_rules(data, 'Other'), [])
        self.assertEqual(data['client'], 'Other')


if __name__ == '__main__':
    unittest.main()
