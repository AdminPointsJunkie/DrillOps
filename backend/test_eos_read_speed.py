"""Read endpoint behavior without importing main's database startup side effects."""
import ast
from contextlib import contextmanager
from pathlib import Path
import unittest
from borehole_reads import borehole_actuals_query
SOURCE=(Path(__file__).parent/'main.py').read_text()
TREE=ast.parse(SOURCE)
class Reads(unittest.TestCase):
    def run_endpoint(self,name,**args):
        calls=[];modes=[]
        class Cursor:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def execute(self,sql,params=None):calls.append((sql,params))
            def fetchall(self):return [{'name':'Saved contractor'}]
            def fetchone(self):return {'dates':[], 'holes':[], 'sites':[], 'codes':[], 'total_rows':0}
        class Conn:
            def cursor(self):return Cursor()
        @contextmanager
        def conn(**options):
            modes.append(options);yield Conn()
        node=next(n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name==name)
        node.decorator_list=[]
        ns={'get_conn':conn,'Query':lambda value:value}
        exec(compile(ast.Module(body=[node],type_ignores=[]),'<read>','exec'),ns)
        return ns[name](**args),calls,modes
    def test_contractors_are_a_single_read_without_seed_writes(self):
        rows,calls,modes=self.run_endpoint('get_contractors')
        self.assertEqual(rows,[{'name':'Saved contractor'}]);self.assertEqual(len(calls),1);self.assertEqual(modes,[{'read_only':True}]);self.assertTrue(calls[0][0].startswith('SELECT'))
    def test_filters_use_one_scoped_aggregate_and_preserve_response_shape(self):
        result,calls,modes=self.run_endpoint('get_filters',contractor='DEPCO Drilling')
        self.assertEqual(set(result),{'dates','holes','sites','codes','total_rows'});self.assertEqual(len(calls),1);self.assertEqual(calls[0][1],('DEPCO Drilling',));self.assertEqual(modes,[{'read_only':True}])
    def test_borehole_matches_deduplicate_and_preserve_all_three_modes(self):
        company,params=borehole_actuals_query('Company','a.date')
        self.assertEqual(params,{});self.assertIn('AS MATERIALIZED',company);self.assertNotIn('UNION ALL',company);self.assertNotIn('EXISTS (',company);self.assertIn("a.hole_num='IB674'",company)
        for contractor in ['Mitchells Drilling','DEPCO Drilling',None]:
            query,params=borehole_actuals_query(contractor,'a.date')
            self.assertIn("a.project='BCC Fugitive Emissions'",query);self.assertIn("WHEN 'ESPGN8' THEN 'ESPNG08'",query)
            self.assertIn('[0-9]{4}-[0-9]{2}-[0-9]{2}',query)
            if contractor:self.assertEqual(params,{'contractor':contractor});self.assertIn('contractor=%(contractor)s',query)
            else:self.assertIn('AND a.contractor=b.contractor',query)
if __name__=='__main__':unittest.main()
