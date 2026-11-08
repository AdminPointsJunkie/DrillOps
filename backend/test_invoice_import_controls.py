import unittest
from invoice_import_controls import destination, find_duplicate
class Cursor:
    def __init__(self, rows):self.rows=iter(rows);self.calls=[]
    def execute(self,sql,params):self.calls.append((sql,params))
    def fetchone(self):return next(self.rows)
class Controls(unittest.TestCase):
    def test_destination_comes_from_saved_project_and_po(self):
        c=Cursor([{'id':1,'name':'Example','program':'Exploration','year':'2026'},{'id':2,'project':'example','program':'Exploration','contractor':'Supplier','po_number':'PO-1'}])
        self.assertEqual(destination(c,1,2),{'contractor':'Supplier','project':'Example','program':'Exploration','po_reference':'PO-1'})
        self.assertEqual([p for _,p in c.calls],[(1,),(2,)])
    def test_other_program_or_unknown_destination_is_rejected(self):
        for project,po in [(None,None),({'name':'Example','program':'Exploration'},{'project':'Example','program':'Gas Riser'})]:
            with self.assertRaises(ValueError):destination(Cursor([project,po]),1,2)
    def test_duplicate_locks_precede_lookup_and_include_pdf_and_normalised_identity(self):
        c=Cursor([{'id':3,'invoice_number':'INV-1'}]);self.assertEqual(find_duplicate(c,' Supplier ',' Inv- 1 ',b'pdf')['id'],3)
        self.assertIn('pg_advisory_xact_lock',c.calls[0][0]);self.assertIn('pg_advisory_xact_lock',c.calls[1][0])
        self.assertEqual(c.calls[2][1],('inv-1','supplier','inv-1',b'pdf'))
        self.assertIn('OR pdf_data=%s',c.calls[2][0])
    def test_no_match_allows_import_and_blank_number_cannot_match_by_number(self):
        c=Cursor([None]);self.assertIsNone(find_duplicate(c,'Supplier','',b'new-pdf'))
        self.assertEqual(c.calls[2][1][0],'');self.assertIn("%s<>''",c.calls[2][0])

class ImportEndpoint(unittest.IsolatedAsyncioTestCase):
    async def test_existing_invoice_returns_duplicate_before_any_insert(self):
        import ast
        from contextlib import contextmanager
        from pathlib import Path
        from typing import Optional
        from io import BytesIO
        import types
        from fastapi import HTTPException
        calls=[]
        class DatabaseCursor:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def execute(self,sql,params):calls.append((sql,params));self.sql=sql
            def fetchone(self):
                if 'FROM projects' in self.sql:return {'id':1,'name':'Example','program':'Exploration','year':'2026'}
                if 'FROM purchase_orders' in self.sql:return {'id':2,'project':'Example','program':'Exploration','contractor':'Supplier','po_number':'PO-1'}
                return {'id':3,'invoice_number':'INV-1','project':'Example','po_reference':'PO-1'}
        class Conn:
            def cursor(self):return DatabaseCursor()
        @contextmanager
        def connection(**kwargs):yield Conn()
        class Pdf:
            pages=[types.SimpleNamespace(extract_text=lambda:'Central Highlands Mining Services',extract_tables=lambda:[])]
            def __enter__(self):return self
            def __exit__(self,*args):pass
        class Upload:
            filename='renamed.pdf'
            async def read(self):return b'pdf'
        def parse(text,filename,contractor,tables):
            self.assertEqual(contractor,'Supplier')
            return {'invoice_number':'INV-1','lines':[]}
        tree=ast.parse((Path(__file__).parent/'main.py').read_text())
        node=next(n for n in tree.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='import_invoice');node.decorator_list=[]
        ns={'Optional':Optional,'UploadFile':object,'File':lambda *a,**kw:None,'Form':lambda *a,**kw:None,'get_conn':connection,'pdfplumber':types.SimpleNamespace(open=lambda _:Pdf()),'BytesIO':BytesIO,'HTTPException':HTTPException,'parse_invoice_pdf':parse}
        exec(compile(ast.Module(body=[node],type_ignores=[]),'<test>','exec'),ns)
        result=await ns['import_invoice'](file=Upload(),project_id=1,po_id=2)
        self.assertEqual(result['status'],'duplicate');self.assertEqual(result['existing_invoice']['id'],3)
        self.assertFalse(any('INSERT' in sql for sql,_ in calls))

if __name__=='__main__':unittest.main()
