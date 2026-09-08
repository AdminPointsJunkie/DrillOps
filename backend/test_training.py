"""Training parsing, authorization, request contracts and workspace boundaries."""
import copy
import io
import unittest
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from security import AuthUser, DrillOpsAuthMiddleware
from training_api import create_training_router, default_settings, matching_company, validate_column
from training_parser import parse_report


class TrainingRouteTests(unittest.TestCase):
    def setUp(self):
        self.cur = MagicMock()
        self.conn = MagicMock()
        self.conn.cursor.return_value.__enter__.return_value = self.cur
        @contextmanager
        def get_conn(**kwargs):
            yield self.conn
        app = FastAPI()
        app.include_router(create_training_router(get_conn))
        @app.middleware('http')
        async def authenticated_test_session(request, call_next):
            if request.headers.get('Authorization'):
                request.state.auth_user = AuthUser('11111111-1111-4111-8111-111111111111', 'test@example.test', 'aal1')
            return await call_next(request)
        self.client = TestClient(app)
        self.headers = {'Authorization':'Bearer test-fixture'}
        self.scope = '?contractor=DEPCO%20Drilling'

    def test_anonymous_requests_do_not_touch_database(self):
        for path in ['state','sources/a']:
            self.assertEqual(self.client.get('/training/'+path+self.scope).status_code,401)
        self.cur.execute.assert_not_called()

    def test_non_admin_is_denied_before_reading_training(self):
        self.cur.fetchone.return_value=None
        response=self.client.get('/training/state'+self.scope,headers=self.headers)
        self.assertEqual(response.status_code,403)
        self.assertEqual(self.cur.execute.call_count,1)

    def test_state_is_contractor_scoped_and_separate_from_sources(self):
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},None]
        self.cur.fetchall.side_effect=[[],[{'name':'DEPCO Drilling'}]]
        response=self.client.get('/training/state'+self.scope,headers=self.headers)
        self.assertEqual(response.status_code,200)
        self.assertEqual(len(response.json()['columns']),23)
        self.assertEqual(response.json()['revision'],0)
        self.assertEqual(response.json()['people'],[])
        calls=self.cur.execute.call_args_list
        scoped=[c for c in calls if 'training_cardholders' in c.args[0]]
        self.assertEqual(scoped[0].args[1],('DEPCO Drilling',))
        self.assertFalse(any('payload' in c.args[0] for c in calls))

    def test_missing_source_does_not_fall_back_to_other_contractor(self):
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},None]
        response=self.client.get('/training/sources/abc'+self.scope,headers=self.headers)
        self.assertEqual(response.status_code,404)
        self.assertEqual(self.cur.execute.call_args.args[1],('DEPCO Drilling','abc'))

    def test_conflicting_requirements_are_rejected(self):
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},{'settings':default_settings(),'revision':2}]
        response=self.client.post('/training/role'+self.scope,headers=self.headers,json={'name':'Driller','requirements':{'medical':'minimum'},'revision':1})
        self.assertEqual(response.status_code,409)
        self.assertFalse(any('UPDATE training_workspaces' in c.args[0] for c in self.cur.execute.call_args_list))

    def test_valid_requirements_save_and_write_audit(self):
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},{'settings':default_settings(),'revision':2}]
        response=self.client.post('/training/role'+self.scope,headers=self.headers,json={'name':'Driller','requirements':{'medical':'minimum','rig':'optional'},'revision':2})
        self.assertEqual(response.status_code,200)
        calls=self.cur.execute.call_args_list
        update=next(c for c in calls if 'UPDATE training_workspaces' in c.args[0])
        self.assertEqual(update.args[1][0].adapted['roles']['Driller'],{'medical':'minimum','rig':'optional'})
        self.assertTrue(any('INSERT INTO audit_events' in c.args[0] for c in calls))

    def test_invalid_file_is_rejected(self):
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'}]
        response=self.client.post('/training/import'+self.scope,headers=self.headers,files={'file':('fake.pdf',b'not pdf','application/pdf')})
        self.assertEqual(response.status_code,422)

    def test_wrong_company_is_rejected_without_writing(self):
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'}]
        with patch('training_api.parse_report',return_value={'company':'Other Drilling'}):
            response=self.client.post('/training/import'+self.scope,headers=self.headers,files={'file':('test.pdf',b'%PDF-fixture','application/pdf')})
        self.assertEqual(response.status_code,422)
        self.assertFalse(any('INSERT' in c.args[0] for c in self.cur.execute.call_args_list))

    def test_older_report_is_rejected_before_source_insert(self):
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},{'admin':1},{'name':'DEPCO Drilling'},{'settings':default_settings(),'revision':0},{'role':'Driller','report_date':date(2026,9,9)}]
        with patch('training_api.parse_report',return_value={'company':'Depco Drilling','id':'test','reportDate':'2026-01-01'}):
            response=self.client.post('/training/import'+self.scope,headers=self.headers,files={'file':('test.pdf',b'%PDF-fixture','application/pdf')})
        self.assertEqual(response.status_code,409)
        self.assertFalse(any('INSERT INTO training_sources' in c.args[0] for c in self.cur.execute.call_args_list))


class TrainingParserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reports={}
        for name,count in [('Andrew Neil',90),('Braith Layton',67),('Brock Wilson',73),('Robert Feldman',87),('Scott Morton',61)]:
            path=Path.home()/'Downloads'/f'Cardholder Report for {name}.pdf'
            if not path.exists():
                raise unittest.SkipTest('Private PDF fixtures are available only in the original local workspace.')
            cls.reports[name]=(parse_report(path.read_bytes(),path.name),count)

    def test_all_five_reports_and_counts(self):
        for name,(p,count) in self.reports.items():
            self.assertEqual(p['name'],name)
            self.assertEqual(len(p['records']),count)
            self.assertEqual(p['reportDate'],'2026-09-09')
            self.assertNotIn('PIN',str(p))
            self.assertNotIn('Personal Contact',str(p))

    def test_expiry_without_issue_and_page_three_history(self):
        p=self.reports['Andrew Neil'][0]
        row=next(r for r in p['records'] if r['expires']=='2021-05-28')
        self.assertIsNone(row['issued'])
        rows=[r for r in p['records'] if r['name']=='Mining.Statement of Attainment.RIIWHS301 Conduct safety and health investigation']
        self.assertEqual({r['expires'] for r in rows},{'2025-04-08','2030-04-02'})
        self.assertTrue(all(r['page']==3 for r in rows))


class TrainingValidationTests(unittest.TestCase):
    def test_company_matching_is_case_insensitive_but_not_fuzzy(self):
        self.assertTrue(matching_company('Depco Drilling','DEPCO Drilling'))
        self.assertFalse(matching_company('Depco Drilling','DEPCO'))

    def test_columns_accept_empty_mapping_but_reject_invalid_shapes(self):
        self.assertEqual(validate_column({'id':'a','label':'A','group':'Core','aliases':[]})['aliases'],[])
        with self.assertRaises(Exception):
            validate_column({'id':'a','label':'A','group':'Core','aliases':'not a list'})


if __name__=='__main__':
    unittest.main()
