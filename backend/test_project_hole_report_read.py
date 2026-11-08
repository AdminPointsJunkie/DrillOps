import ast
from contextlib import contextmanager
from pathlib import Path
import unittest
from project_hole_report_read import REPORT_SQL

class ProjectReportRead(unittest.TestCase):
    def test_bound_read_only_project_query(self):
        calls=[]
        class Cursor:
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def execute(self,sql,params): calls.append((sql,params))
            def fetchone(self): return {'activities': [], 'invoices': []}
        class Connection:
            def cursor(self): return Cursor()
        @contextmanager
        def get_conn(**options):
            self.assertEqual(options, {'read_only': True})
            yield Connection()
        node=next(n for n in ast.parse((Path(__file__).parent/'main.py').read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='get_project_hole_report_data')
        node.decorator_list=[]
        namespace={'get_conn':get_conn,'Query':lambda default,**kwargs:default}
        exec(compile(ast.Module(body=[node],type_ignores=[]),'<test>','exec'),namespace)
        self.assertEqual(namespace[node.name]("Sample's project",'Exploration'),{'activities': [], 'invoices': []})
        self.assertEqual(calls,[(REPORT_SQL,{'project':"Sample's project",'program':'Exploration'})])
        for field in ['pdf_data','invoice_attachments','crew','ironbark_posted_costs']:
            self.assertNotIn(field, REPORT_SQL)

if __name__=='__main__':unittest.main()
