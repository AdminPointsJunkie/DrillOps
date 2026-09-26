import ast
import asyncio
import copy
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from depco_rates import CATALOG, catalogue, contract_rates, price_depco_activity


class DepcoRatesTests(unittest.TestCase):
    def rate(self, scope, name, **kwargs):
        return next(r for r in catalogue(scope) if r['name'] == name and all(r.get(k)==v for k,v in kwargs.items()))

    def price(self, rate, **row):
        return price_depco_activity({'code':rate['cost_code'],'date':'26/09/2026',**row}, catalogue(rate['scope']))

    def test_catalogue_unique_codes_and_provenance(self):
        rows=CATALOG['rates']
        self.assertEqual(len(rows),len({r['cost_code'] for r in rows}))
        for r in rows:
            self.assertIn('!row ',r['reference_name'])
            if r['charge'] is None: self.assertEqual(r['status'],'Review')

    def test_revised_active_and_standby(self):
        self.assertEqual(self.price(self.rate('A','Active Rig Rate'),total_time='02:30')['line_cost'],1576.25)
        self.assertEqual(self.price(self.rate('A','Standby Rate'),total_time='1.5')['line_cost'],727.5)

    def test_specialist_and_safety_increment_rates(self):
        self.assertEqual(self.price(self.rate('A','Rig Testing'),total_time=1)['line_cost'],600)
        self.assertEqual(self.price(self.rate('A','Safety Gas'),total_time=1)['line_cost'],485)
        self.assertIsNone(self.price(self.rate('A','Safety Company'),total_time='00:20')['line_cost'])

    def test_legacy_code_maps_and_year_parses(self):
        result=price_depco_activity({'code':'H_Active','total_time':'01:00','date':'26/09/2026'},catalogue('A'))
        self.assertEqual(result['line_cost'],630.5)
        self.assertEqual(result['rate_year'],'2026')
        self.assertTrue(result['code'].startswith('DEPCO_A_'))

    def test_scope_isolation(self):
        a=self.rate('A','Casing Install'); c=self.rate('C','Casing Install')
        self.assertEqual(self.price(a,total_time=2)['line_cost'],1261)
        self.assertEqual(self.price(c,total_time=2)['line_cost'],1900)
        self.assertIsNone(price_depco_activity({'code':a['cost_code'],'total_time':2},catalogue('C'))['line_cost'])

    def test_split_depth_bands(self):
        r=self.rate('A','PCD 90 - 125',depth_from=0)
        result=self.price(r,metres_from=90,metres_to=110,total_metres=20)
        self.assertEqual(result['line_cost'],780)
        self.assertEqual(result['unit_rate'],39)

    def test_core_size_and_depth_are_separate(self):
        hq=self.rate('A','Core HQ /HQ3',depth_from=100)
        pq=self.rate('A','Core PQ/PQ3',depth_from=100)
        self.assertEqual(self.price(hq,metres_from=100,metres_to=110,total_metres=10)['line_cost'],2000)
        self.assertEqual(self.price(pq,metres_from=100,metres_to=110,total_metres=10)['line_cost'],2100)

    def test_missing_band_and_inconsistent_metres_do_not_price(self):
        r=self.rate('A','PCD 90 - 125',depth_from=0)
        self.assertIsNone(self.price(r,metres_from=490,metres_to=510,total_metres=20)['line_cost'])
        self.assertIsNone(self.price(r,metres_from=90,metres_to=110,total_metres=10)['line_cost'])

    def test_overlap_detected_inside_interval(self):
        lines=catalogue('A'); r=self.rate('A','PCD 90 - 125',depth_from=0)
        lines.append({**r,'depth_from':50,'depth_to':150})
        result=price_depco_activity({'code':r['cost_code'],'metres_from':0,'metres_to':100,'total_metres':100},lines)
        self.assertIsNone(result['line_cost'])
        self.assertIn('overlapping',result['rate_basis'])

    def test_missing_price_and_wet_weather_remain_review(self):
        for r in (self.rate('C','PCD 125 - 175',depth_from=0),self.rate('A','Wet Weather Standby')):
            self.assertIsNone(self.price(r,total_time=3,metres_from=0,metres_to=10,total_metres=10)['line_cost'])

    def test_conditional_charges_do_not_infer_from_dollars(self):
        for name in ('Water Collect','Crew Travel Off','Safety Permits','Standby Water','Accommodation','Tripping Rods'):
            r=next(r for r in catalogue('A') if r['name']==name)
            self.assertIsNone(self.price(r,total_time=3,quantity=2)['line_cost'],name)

    def test_no_charge_is_explicit_zero(self):
        self.assertEqual(self.price(self.rate('A','Safety Prestart'),total_time='00:30')['line_cost'],0)

    def test_duplicate_label_requires_explicit_code(self):
        result=price_depco_activity({'code':'Backoe','total_time':2},catalogue('A'))
        self.assertIsNone(result['line_cost'])
        rates=[r for r in catalogue('A') if r['name']=='Backoe']
        self.assertEqual({self.price(r,total_time=2)['line_cost'] for r in rates},{200,320})

    def test_daily_rate_requires_quantity_and_keeps_zero(self):
        r=self.rate('B','Additional water cart')
        self.assertIsNone(self.price(r,total_time=12)['line_cost'])
        self.assertEqual(self.price(r,total_time=12,quantity=2)['line_cost'],3000)
        self.assertEqual(self.price(r,total_time=12,quantity=0)['line_cost'],0)

    def test_sis_metres_do_not_use_hours(self):
        r=self.rate('B','4 7/8" PCD in-seam')
        self.assertEqual(self.price(r,total_metres=10,total_time=2)['line_cost'],1780)

    def test_provisional_and_included_are_review(self):
        for r in catalogue('B'):
            if any(word in r['category'].lower() for word in ('included','built in','provisional')):
                self.assertEqual(r['status'],'Review')

    def test_bad_quantity_duration_unknown_code_and_no_contract(self):
        r=self.rate('A','Active Rig Rate')
        for value in ('1:99',-1,'nan',None):
            self.assertIsNone(self.price(r,total_time=value)['line_cost'])
        self.assertIsNone(price_depco_activity({'code':'unknown','total_time':2},catalogue('A'))['line_cost'])
        self.assertIsNone(price_depco_activity({'code':r['cost_code'],'total_time':2},None)['line_cost'])

    def test_inactive_and_edited_rates(self):
        r=self.rate('A','Active Rig Rate'); r['status']='Inactive'
        self.assertIsNone(price_depco_activity({'code':r['cost_code'],'total_time':1},[r])['line_cost'])
        r.update(status='Active',charge=640)
        self.assertEqual(price_depco_activity({'code':r['cost_code'],'total_time':1},[r])['line_cost'],640)

    def test_contract_date_bounds(self):
        r={**self.rate('A','Active Rig Rate'),'_start_date':'2026-08-26','_end_date':'2026-12-31'}
        for day in ('25/08/2026','2027-01-01',''):
            self.assertIsNone(price_depco_activity({'code':r['cost_code'],'total_time':1,'date':day},[r])['line_cost'])
        self.assertEqual(price_depco_activity({'code':r['cost_code'],'total_time':1,'date':'2026-08-26'},[r])['line_cost'],630.5)

    def test_contract_lookup_scopes_program_and_refuses_ambiguity(self):
        cur=MagicMock();cur.fetchall.side_effect=[[{'id':1},{'id':2}]]
        self.assertEqual(contract_rates(cur,'DEPCO Drilling','Ironbark',''),[])
        cur=MagicMock();cur.fetchall.side_effect=[[{'id':1}],catalogue('C')]
        self.assertEqual(len(contract_rates(cur,'DEPCO Drilling','Ironbark','Gas Riser')),129)
        self.assertEqual(cur.execute.call_args_list[0].args[1],('DEPCO Drilling','Ironbark','Gas Riser','Gas Riser'))


class DepcoRouteTests(unittest.TestCase):
    """Exercise real route bodies without connecting to the production database."""
    def setUp(self):
        from fastapi import HTTPException
        from depco_rates import SCOPES
        tree=ast.parse((Path(__file__).parent/'main.py').read_text(encoding='utf-8'))
        names={'import_depco_contract','apply_activity_contract_code'}
        nodes=[n for n in tree.body if isinstance(n,ast.AsyncFunctionDef) and n.name in names]
        for node in nodes: node.decorator_list=[]
        self.cur=MagicMock(); self.conn=MagicMock()
        self.conn.cursor.return_value.__enter__.return_value=self.cur
        get_conn=MagicMock();get_conn.return_value.__enter__.return_value=self.conn
        self.env={'Request':object,'get_conn':get_conn,'HTTPException':HTTPException,
                  'depco_catalogue':catalogue,'DEPCO_SCOPES':SCOPES,
                  'price_depco_activity':price_depco_activity,
                  'depco_contract_rates':MagicMock(return_value=catalogue('A')),
                  'activity_sheet_is_locked':MagicMock(return_value=False)}
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'routes','exec'),self.env)
        self.HTTPException=HTTPException

    def request(self,payload):
        from unittest.mock import AsyncMock
        req=MagicMock();req.json=AsyncMock(return_value=payload);return req

    def test_import_is_additive_and_preserves_existing_edits(self):
        self.cur.fetchone.return_value={'contractor':'DEPCO Drilling','program':'Exploration'}
        self.cur.fetchall.return_value=[{'cost_code':r['cost_code']} for r in catalogue('A')]
        result=asyncio.run(self.env['import_depco_contract'](1,self.request({'scope':'A'})))
        self.assertEqual(result['added'],0)
        self.assertFalse(any('INSERT' in c.args[0] or 'DELETE' in c.args[0] for c in self.cur.execute.call_args_list))

    def test_import_matches_project_program(self):
        self.cur.fetchone.return_value={'contractor':'DEPCO Drilling','program':'Gas Riser'}
        with self.assertRaises(self.HTTPException) as exc:
            asyncio.run(self.env['import_depco_contract'](1,self.request({'scope':'A'})))
        self.assertEqual(exc.exception.status_code,400)
        self.conn.commit.assert_not_called()

    def test_import_all_rows_with_nulls_and_review(self):
        self.cur.fetchone.return_value={'contractor':'DEPCO Drilling','program':'Exploration'}
        self.cur.fetchall.return_value=[]
        result=asyncio.run(self.env['import_depco_contract'](1,self.request({'scope':'A'})))
        self.assertEqual(result['added'],126)
        inserted=[c.args[1] for c in self.cur.execute.call_args_list if 'INSERT' in c.args[0]]
        self.assertTrue(any(r['charge'] is None and r['status']=='Review' for r in inserted))

    def test_locked_report_cannot_change_code(self):
        self.cur.fetchone.return_value={'id':2,'contractor':'DEPCO Drilling'}
        self.env['activity_sheet_is_locked'].return_value=True
        with self.assertRaises(self.HTTPException) as exc:
            asyncio.run(self.env['apply_activity_contract_code'](2,self.request({'code':'anything'})))
        self.assertEqual(exc.exception.status_code,409)
        self.conn.commit.assert_not_called()

    def test_apply_prices_and_persists_in_one_transaction(self):
        rate=next(r for r in catalogue('A') if r['name']=='Active Rig Rate')
        row={'id':2,'contractor':'DEPCO Drilling','date':'2026-09-26','project':'Carborough Downs','program':'Exploration','total_time':'02:30'}
        self.cur.fetchone.side_effect=[row,{**row,'line_cost':1576.25}]
        result=asyncio.run(self.env['apply_activity_contract_code'](2,self.request({'code':rate['cost_code']})))
        self.assertEqual(result['line_cost'],1576.25)
        self.assertEqual(self.cur.execute.call_args.args[1]['line_cost'],1576.25)
        self.conn.commit.assert_called_once()


if __name__ == '__main__':
    unittest.main()
