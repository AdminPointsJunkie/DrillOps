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
from training_api import create_training_router, default_settings, matching_company, validate_column, preserve_individual_evidence, training_sections
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
        self.assertEqual(response.json()['requirementsScope'],'global')
        contractor_query=next(c.args[0] for c in calls if 'ORDER BY name' in c.args[0])
        self.assertIn('active=TRUE AND training_enabled=TRUE',contractor_query)

    def test_different_contractors_read_same_shared_requirements(self):
        shared=default_settings()
        shared['roles']['Driller']={'medical':'minimum'}
        for contractor in ['DEPCO Drilling','CHMS']:
            self.cur.reset_mock()
            self.cur.fetchone.side_effect=[{'admin':1},{'name':contractor},{'settings':copy.deepcopy(shared),'revision':7}]
            self.cur.fetchall.side_effect=[[],[{'name':'DEPCO Drilling'},{'name':'CHMS'}]]
            response=self.client.get('/training/state',params={'contractor':contractor},headers=self.headers)
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json()['roles']['Driller'],{'medical':'minimum'})
            self.assertEqual(response.json()['revision'],7)
            query=next(c for c in self.cur.execute.call_args_list if 'SELECT settings' in c.args[0])
            self.assertEqual(query.args,('SELECT settings,revision FROM training_configuration WHERE id=1',))

    def test_shared_role_can_be_assigned_only_within_selected_contractor(self):
        shared=default_settings();shared['roles']['Shared new role']={}
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'CHMS'},{'settings':shared,'revision':7},{'card_id':'fixture'}]
        response=self.client.post('/training/person?contractor=CHMS',headers=self.headers,json={'id':'fixture','role':'Shared new role'})
        self.assertEqual(response.status_code,200)
        update=next(c for c in self.cur.execute.call_args_list if 'UPDATE training_cardholders' in c.args[0])
        self.assertIn('WHERE contractor=%s AND card_id=%s',update.args[0])
        self.assertEqual(update.args[1][-2:],('CHMS','fixture'))

    def test_missing_source_does_not_fall_back_to_other_contractor(self):
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},None]
        response=self.client.get('/training/sources/abc'+self.scope,headers=self.headers)
        self.assertEqual(response.status_code,404)
        self.assertEqual(self.cur.execute.call_args.args[1],('DEPCO Drilling','abc'))

    def test_conflicting_requirements_are_rejected(self):
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},{'settings':default_settings(),'revision':2}]
        response=self.client.post('/training/role'+self.scope,headers=self.headers,json={'name':'Driller','requirements':{'medical':'minimum'},'revision':1})
        self.assertEqual(response.status_code,409)
        self.assertFalse(any('UPDATE training_configuration' in c.args[0] for c in self.cur.execute.call_args_list))

    def test_empty_section_persists_without_changing_columns_or_roles(self):
        settings=default_settings();previous=copy.deepcopy(settings)
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},{'settings':settings,'revision':2}]
        response=self.client.post('/training/section'+self.scope,headers=self.headers,json={'name':' Emergency response ','colour':'green','revision':2})
        self.assertEqual(response.status_code,200)
        update=next(c for c in self.cur.execute.call_args_list if 'UPDATE training_configuration' in c.args[0])
        saved=update.args[1][0].adapted
        self.assertEqual(saved['sections'][-1],{'name':'Emergency response','colour':'green'})
        self.assertEqual(saved['columns'],previous['columns'])
        self.assertEqual(saved['roles'],previous['roles'])
        self.assertFalse(any('training_cardholders' in c.args[0] for c in self.cur.execute.call_args_list))
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'CHMS'},{'settings':saved,'revision':3}]
        self.cur.fetchall.side_effect=[[],[{'name':'CHMS'}]]
        loaded=self.client.get('/training/state?contractor=CHMS',headers=self.headers)
        self.assertIn({'name':'Emergency response','colour':'green'},loaded.json()['sections'])

    def test_section_rename_moves_columns_and_preserves_mappings_and_requirements(self):
        settings=default_settings();settings['roles']['Driller']={'medical':'minimum'};previous=copy.deepcopy(settings)
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},{'settings':settings,'revision':2}]
        response=self.client.post('/training/section'+self.scope,headers=self.headers,json={'previousName':'Core / Site','name':'Site essentials','colour':'clay','revision':2})
        self.assertEqual(response.status_code,200)
        saved=next(c for c in self.cur.execute.call_args_list if 'UPDATE training_configuration' in c.args[0]).args[1][0].adapted
        self.assertEqual(saved['roles'],previous['roles'])
        for old,new in zip(previous['columns'],saved['columns']):
            self.assertEqual(new,dict(old,group='Site essentials') if old['group']=='Core / Site' else old)
        self.assertEqual(saved['sections'][0],{'name':'Site essentials','colour':'clay'})

    def test_section_rejects_duplicates_reserved_names_invalid_colours_and_stale_edits(self):
        for body,code in [({'name':'drilling','colour':'blue','revision':2},409),({'name':'All training','colour':'blue','revision':2},400),({'name':'New','colour':'red; color: red','revision':2},400),({'name':'New','colour':'green','revision':1},409),({'name':'New','previousName':'Missing','colour':'green','revision':2},404)]:
            self.cur.reset_mock();self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},{'settings':default_settings(),'revision':2}]
            response=self.client.post('/training/section'+self.scope,headers=self.headers,json=body)
            self.assertEqual(response.status_code,code,body)
            self.assertFalse(any('UPDATE training_configuration' in c.args[0] for c in self.cur.execute.call_args_list))

    def test_section_requires_administrator(self):
        body={'name':'New','colour':'green','revision':2}
        self.assertEqual(self.client.post('/training/section'+self.scope,json=body).status_code,401)
        self.cur.execute.assert_not_called()
        self.cur.fetchone.return_value=None
        self.assertEqual(self.client.post('/training/section'+self.scope,headers=self.headers,json=body).status_code,403)
        self.assertEqual(self.cur.execute.call_count,1)

    def test_reorder_keeps_all_training_definitions_and_role_requirements(self):
        settings=default_settings();settings['sections']=training_sections(settings)+[{'name':'Empty','colour':'green'}]
        settings['roles']['Driller']={'medical':'minimum'};previous=copy.deepcopy(settings)
        names=[s['name'] for s in reversed(settings['sections'])];ids=[c['id'] for c in reversed(settings['columns'])]
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},{'settings':settings,'revision':2}]
        response=self.client.post('/training/order'+self.scope,headers=self.headers,json={'sections':names,'columns':ids,'revision':2})
        self.assertEqual(response.status_code,200)
        saved=next(c for c in self.cur.execute.call_args_list if 'UPDATE training_configuration' in c.args[0]).args[1][0].adapted
        self.assertEqual(saved['sections'],list(reversed(previous['sections'])))
        self.assertEqual(saved['columns'],list(reversed(previous['columns'])))
        self.assertEqual(saved['roles'],previous['roles'])
        self.assertFalse(any('training_cardholders' in c.args[0] for c in self.cur.execute.call_args_list))

    def test_order_rejects_missing_duplicate_unknown_and_stale_entries(self):
        settings=default_settings();names=[s['name'] for s in training_sections(settings)];ids=[c['id'] for c in settings['columns']]
        for sections,columns,revision,status in [(names[:-1],ids,2,400),(names,ids[:-1]+[ids[0]],2,400),(names,ids[:-1]+['unknown'],2,400),(names,ids,1,409)]:
            self.cur.reset_mock();self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},{'settings':copy.deepcopy(settings),'revision':2}]
            response=self.client.post('/training/order'+self.scope,headers=self.headers,json={'sections':sections,'columns':columns,'revision':revision})
            self.assertEqual(response.status_code,status)
            self.assertFalse(any('UPDATE training_configuration' in c.args[0] for c in self.cur.execute.call_args_list))

    def test_column_moves_to_saved_empty_section_without_losing_type_or_requirements(self):
        settings=default_settings();settings['sections']=training_sections(settings)+[{'name':'Emergency response','colour':'green'}]
        settings['roles']['Driller']={'medical':'minimum'}
        column=dict(settings['columns'][0],group='emergency response',evidenceType='medical')
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},{'settings':settings,'revision':2}]
        response=self.client.post('/training/column'+self.scope,headers=self.headers,json={'column':column,'revision':2})
        self.assertEqual(response.status_code,200)
        saved=next(c for c in self.cur.execute.call_args_list if 'UPDATE training_configuration' in c.args[0]).args[1][0].adapted
        self.assertEqual(saved['columns'][0]['group'],'Emergency response')
        self.assertEqual(saved['columns'][0]['evidenceType'],'medical')
        self.assertEqual(saved['columns'][0]['aliases'],column['aliases'])
        self.assertEqual(saved['roles']['Driller'],{'medical':'minimum'})
        self.assertEqual(saved['sections'][-1]['colour'],'green')

    def test_valid_requirements_save_and_write_audit(self):
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},{'settings':default_settings(),'revision':2}]
        response=self.client.post('/training/role'+self.scope,headers=self.headers,json={'name':'Driller','requirements':{'medical':'minimum','rig':'optional'},'revision':2})
        self.assertEqual(response.status_code,200)
        calls=self.cur.execute.call_args_list
        update=next(c for c in calls if 'UPDATE training_configuration' in c.args[0])
        self.assertEqual(update.args[1][0].adapted['roles']['Driller'],{'medical':'minimum','rig':'optional'})
        self.assertIn('WHERE id=1',update.args[0])
        self.assertEqual(len(update.args[1]),2)
        self.assertTrue(any('INSERT INTO audit_events' in c.args[0] for c in calls))

    def test_remove_role_unassigns_people_without_deleting_training(self):
        settings=default_settings()
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},{'settings':settings,'revision':2}]
        self.cur.rowcount=2
        response=self.client.request('DELETE','/training/role'+self.scope,headers=self.headers,json={'name':'Driller','revision':2})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['reassigned'],2)
        calls=self.cur.execute.call_args_list
        people=next(c for c in calls if 'UPDATE training_cardholders' in c.args[0])
        self.assertIn("role='Unassigned'",people.args[0])
        self.assertEqual(people.args[1][-1],'Driller')
        self.assertNotIn('contractor=',people.args[0])
        update=next(c for c in calls if 'UPDATE training_configuration' in c.args[0])
        self.assertNotIn('Driller',update.args[1][0].adapted['roles'])
        self.assertFalse(any('DELETE FROM' in c.args[0] for c in calls))

    def test_removing_last_role_leaves_a_valid_empty_role_list(self):
        settings=default_settings();settings['roles']={'Only role':{}}
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},{'settings':settings,'revision':0}]
        self.cur.rowcount=0
        response=self.client.request('DELETE','/training/role'+self.scope,headers=self.headers,json={'name':'Only role','revision':0})
        self.assertEqual(response.status_code,200)
        update=next(c for c in self.cur.execute.call_args_list if 'UPDATE training_configuration' in c.args[0])
        self.assertEqual(update.args[1][0].adapted['roles'],{})

    def test_remove_role_rejects_stale_revision(self):
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},{'settings':default_settings(),'revision':2}]
        response=self.client.request('DELETE','/training/role'+self.scope,headers=self.headers,json={'name':'Driller','revision':1})
        self.assertEqual(response.status_code,409)
        self.assertFalse(any('UPDATE training_cardholders' in c.args[0] for c in self.cur.execute.call_args_list))

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

    def test_earlier_same_day_report_is_rejected(self):
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},{'admin':1},{'name':'DEPCO Drilling'},{'settings':default_settings(),'revision':0},{'role':'Driller','report_date':date(2026,9,9),'printed_at':'2026-09-09T10:30'}]
        with patch('training_api.parse_report',return_value={'company':'Depco Drilling','id':'test','reportDate':'2026-09-09','reportPrintedAt':'2026-09-09T09:00'}):
            response=self.client.post('/training/import'+self.scope,headers=self.headers,files={'file':('test.pdf',b'%PDF-fixture','application/pdf')})
        self.assertEqual(response.status_code,409)
        self.assertFalse(any('INSERT INTO training_sources' in c.args[0] for c in self.cur.execute.call_args_list))

    def test_new_snapshot_preserves_individual_records_and_documents(self):
        certificate = {'name': 'RII31815', 'origin': 'individual_document', 'sourceId': 'certificate', 'evidenceType': 'qualification'}
        authorisation = {'name': 'Operate rig', 'origin': 'individual_document', 'sourceId': 'authorisation', 'evidenceType': 'site_authorisation'}
        previous = {'records': [{'name': 'Old snapshot'}, certificate, authorisation], 'documents': [{'sourceId': 'certificate'}, {'sourceId': 'authorisation'}]}
        incoming = {'records': [{'name': 'New snapshot'}]}
        saved = preserve_individual_evidence(incoming, previous)
        self.assertEqual(saved['records'], [{'name': 'New snapshot'}, certificate, authorisation])
        self.assertEqual(saved['documents'], previous['documents'])
        self.assertEqual(len(previous['records']), 3)

    def test_updated_report_preserves_role_and_upserts_existing_cardholder(self):
        self.cur.fetchone.side_effect=[{'admin':1},{'name':'DEPCO Drilling'},{'admin':1},{'name':'DEPCO Drilling'},{'settings':default_settings(),'revision':0},{'role':'Driller','report_date':date(2026,9,9),'printed_at':'2026-09-09T06:00','report':{'records':[{'name':'RII31815','origin':'individual_document','sourceId':'certificate'}],'documents':[{'sourceId':'certificate'}]}},{'id':1}]
        person={'company':'Depco Drilling','name':'Test Person','id':'fixture','role':'Unassigned','reportDate':'2026-09-09','reportPrintedAt':'2026-09-09T11:00','sourceId':'abc','records':[{'name':'New credential'}]}
        with patch('training_api.parse_report',return_value=person):
            response=self.client.post('/training/import'+self.scope,headers=self.headers,files={'file':('test.pdf',b'%PDF-fixture','application/pdf')})
        self.assertEqual(response.status_code,200)
        self.assertTrue(response.json()['replaced'])
        insert=next(c for c in self.cur.execute.call_args_list if 'INSERT INTO training_cardholders' in c.args[0])
        self.assertEqual(insert.args[1][2],'Driller')
        self.assertEqual(insert.args[1][3].adapted['role'],'Driller')
        self.assertEqual(insert.args[1][3].adapted['records'][-1]['sourceId'],'certificate')
        self.assertEqual(insert.args[1][3].adapted['documents'],[{'sourceId':'certificate'}])
        self.assertIn('ON CONFLICT (contractor,card_id) DO UPDATE',insert.args[0])
        self.assertNotIn('role=EXCLUDED.role',insert.args[0])


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
        self.assertEqual(p['reportPrintedAt'],'2026-09-09T06:44')
        row=next(r for r in p['records'] if r['expires']=='2021-05-28')
        self.assertIsNone(row['issued'])
        rows=[r for r in p['records'] if r['name']=='Mining.Statement of Attainment.RIIWHS301 Conduct safety and health investigation']
        self.assertEqual({r['expires'] for r in rows},{'2025-04-08','2030-04-02'})
        self.assertTrue(all(r['page']==3 for r in rows))


class TrainingValidationTests(unittest.TestCase):
    def test_company_matching_is_case_insensitive_but_not_fuzzy(self):
        self.assertTrue(matching_company('Depco Drilling','DEPCO Drilling'))
        self.assertFalse(matching_company('Depco Drilling','DEPCO'))

    def test_evidence_type_validation_preserves_the_mapping_constraint(self):
        column={'id':'a','label':'RII training','group':'Core','aliases':[],'evidenceType':'qualification'}
        self.assertEqual(validate_column(column)['evidenceType'],'qualification')
        with self.assertRaises(Exception):
            validate_column(dict(column,evidenceType='anything'))

    def test_columns_accept_empty_mapping_but_reject_invalid_shapes(self):
        self.assertEqual(validate_column({'id':'a','label':'A','group':'Core','aliases':[]})['aliases'],[])
        with self.assertRaises(Exception):
            validate_column({'id':'a','label':'A','group':'Core','aliases':'not a list'})


if __name__=='__main__':
    unittest.main()
