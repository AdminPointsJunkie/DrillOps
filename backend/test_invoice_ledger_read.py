import ast
from contextlib import contextmanager
from pathlib import Path
import unittest
from invoice_ledger_read import LEDGER_SQL
class LedgerRead(unittest.TestCase):
    def test_one_read_only_query_with_bound_scope(self):
        calls=[];modes=[]
        class Cursor:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def execute(self,sql,params):calls.append((sql,params))
            def fetchone(self):return {'invoices':[],'purchase_orders':[]}
        class Conn:
            def cursor(self):return Cursor()
        @contextmanager
        def conn(**kwargs):modes.append(kwargs);yield Conn()
        node=next(n for n in ast.parse((Path(__file__).parent/'main.py').read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='get_invoice_ledger');node.decorator_list=[]
        ns={'get_conn':conn,'Query':lambda default:default}
        exec(compile(ast.Module(body=[node],type_ignores=[]),'<test>','exec'),ns)
        for project,program in [('', ''),("Sample's project",'Exploration')]:
            self.assertEqual(ns[node.name](project,program),{'invoices':[],'purchase_orders':[]})
            self.assertEqual(calls[-1],(LEDGER_SQL,{'project':project,'program':program}))
        self.assertEqual(len(calls),2);self.assertEqual(modes,[{'read_only':True}]*2)
        self.assertNotIn('pdf_data',LEDGER_SQL);self.assertNotIn('invoice_lines',LEDGER_SQL);self.assertNotIn('invoice_attachments',LEDGER_SQL)
if __name__=='__main__':unittest.main()
