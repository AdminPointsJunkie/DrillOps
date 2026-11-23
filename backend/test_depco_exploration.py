import asyncio
from datetime import datetime
from io import BytesIO
from types import SimpleNamespace
import unittest

from openpyxl import Workbook

from depco_exploration import HEADERS, parse_depco_exploration_xlsx
from depco_rates import price_depco_activity
from test_report_import_resilience import _load_import_endpoint, _DummyApp, _HTTPException


def claim_bytes(rows=None, heading='PO C123 | PACKAGE A EXPLORATION DRILLING'):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'DR17'
    sheet.append([heading])
    sheet.append(['Date From', datetime(2026, 9, 15), 'Date To:', datetime(2026, 11, 10)])
    sheet.append(HEADERS)
    for row in rows if rows is not None else sample_rows():
        sheet.append(row)
    # Formula errors in unused template cells must not become imported charges.
    sheet.append([None] * 6 + ['Activity Not Found', None, None, 0, None, '#VALUE!'])
    sheet.append([None] * 11 + [40, 40])
    workbook.create_sheet('Validation Sheet').append(['Standby', 999])
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def sample_rows():
    base = [1, datetime(2026, 11, 7), 123, 'Example Driller', 'IB123C']
    return [
        base + ['Crew Travel (<0.5hrs)', 0, None, None, .5, 'p/hr', 0, None, 'Travel'],
        base + ['Core HQ/HQ3 (200-300m)', 40, 200, 202, 2, 'p/m', 80, None, None],
        base + ['Core HQ/HQ3 (200-300m)', 40, 202, 201, -1, 'p/m', -40, None, None],
        base + ['Shift Total', None, None, None, None, None, None, 40, None],
    ]


class DepcoExplorationTests(unittest.TestCase):
    def test_source_amounts_zero_rates_credits_and_template_rows(self):
        header, rows, consumables, crew, _ = parse_depco_exploration_xlsx(claim_bytes(), 'claim.xlsx')
        self.assertEqual(len(rows), 3)
        self.assertEqual(sum(r['line_cost'] for r in rows), 40)
        self.assertEqual(rows[0]['total_time'], '0:30')
        self.assertEqual(rows[0]['unit_rate'], 0)
        self.assertEqual(rows[1]['total_time'], '')
        self.assertEqual(rows[2]['total_metres'], -1)
        self.assertEqual(len(crew), 1)
        self.assertIsNone(crew[0]['hours'])
        self.assertEqual(consumables, [])
        self.assertIn('negative', header['warnings'][0]['issue'])
        self.assertEqual(price_depco_activity(rows[1], [] )['line_cost'], 80)

    def test_dar_mismatch_preserved_and_daily_total_reconciled(self):
        source = sample_rows()
        source[1][2] = 124
        header, rows, *_ = parse_depco_exploration_xlsx(claim_bytes(source), 'claim.xlsx')
        self.assertIn('DAR 124', rows[1]['notes'])
        self.assertTrue(any('multiple DAR' in w['issue'] for w in header['warnings']))

    def test_invalid_values_rejected(self):
        for column, value in [(1, None), (6, '#VALUE!'), (9, 5), (11, None), (10, 'unknown')]:
            with self.subTest(column=column):
                source = sample_rows()
                source[1][column] = value
                with self.assertRaises(ValueError):
                    parse_depco_exploration_xlsx(claim_bytes(source), 'claim.xlsx')
        source = sample_rows()
        source[-1][12] = 999
        with self.assertRaisesRegex(ValueError, 'shift totals'):
            parse_depco_exploration_xlsx(claim_bytes(source), 'claim.xlsx')
        with self.assertRaisesRegex(ValueError, 'Package A'):
            parse_depco_exploration_xlsx(claim_bytes(heading='PACKAGE C GAS RISER'), 'claim.xlsx')

    def test_out_of_period_source_date_is_preserved_and_flagged(self):
        source = sample_rows()
        for row in source:
            row[1] = datetime(2026, 6, 21)
        header, rows, *_ = parse_depco_exploration_xlsx(claim_bytes(source), 'claim.xlsx')
        self.assertEqual(rows[0]['date'], '21/06/2026')
        self.assertTrue(any('outside the workbook claim period' in w['issue'] for w in header['warnings']))

    def endpoint(self, overlap=False, imported=False):
        self.saved, self.queries, self.batches = [], [], []
        owner = self

        class Connection:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def cursor(self): return self
            def execute(self, sql, params=None): owner.queries.append((sql, params))
            def fetchone(self): return {'source_file': 'existing.pdf'} if overlap else None
            def commit(self): pass

        namespace = {
            'app': _DummyApp(), 'UploadFile': object, 'File': lambda *_a, **_k: None,
            'Form': lambda default='': default, 'HTTPException': _HTTPException,
            'import_destination': lambda _conn, program, project, client: (program, project, client),
            'parse_depco_exploration_xlsx': parse_depco_exploration_xlsx,
            'apply_import_activity_scope': lambda rows, contractor, program, project, client: [dict(r, program=program, project=project, client=client) for r in rows],
            'get_conn': Connection, 'import_marker_blocks_reimport': lambda *_: imported,
            'psycopg2': SimpleNamespace(Binary=lambda b: b, extras=SimpleNamespace(execute_batch=lambda cur, sql, rows: self.saved.append((sql, rows)))),
            'record_import_batch': lambda cur, **kw: self.batches.append(kw),
        }
        return _load_import_endpoint(namespace)

    def invoke(self, endpoint, program='Exploration'):
        class Upload:
            filename = 'claim.xlsx'
            async def read(self): return claim_bytes()
        return asyncio.run(endpoint(Upload(), contractor='DEPCO Drilling', program=program, project='Example campaign', client='Example workspace'))

    def test_endpoint_routes_and_saves_to_selected_scope(self):
        result = self.invoke(self.endpoint())
        self.assertEqual(result['contractor'], 'DEPCO Drilling')
        self.assertEqual(result['rows'], 3)
        self.assertEqual(result['total_cost'], 40)
        self.assertEqual(result['import_check']['status'], 'needs_review')
        self.assertTrue(all(r['project'] == 'Example campaign' for r in self.saved[0][1]))
        self.assertEqual(self.batches[0]['import_kind'], 'depco_exploration_xlsx')
        source = next(params for sql, params in self.queries if 'INSERT INTO source_files' in sql)
        self.assertEqual(source[2], 'depco_exploration_xlsx')

    def test_overlap_duplicate_and_wrong_campaign_do_not_write(self):
        with self.assertRaises(_HTTPException) as error:
            self.invoke(self.endpoint(overlap=True))
        self.assertEqual(error.exception.status_code, 409)
        self.assertFalse(self.saved)
        self.assertEqual(self.invoke(self.endpoint(imported=True))['status'], 'skipped')
        self.assertFalse(self.saved)
        with self.assertRaises(_HTTPException) as error:
            self.invoke(self.endpoint(), program='Gas Riser')
        self.assertEqual(error.exception.status_code, 400)
        self.assertFalse(self.saved)


if __name__ == '__main__':
    unittest.main()
