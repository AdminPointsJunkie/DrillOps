import ast
import unittest
from pathlib import Path
from contextlib import contextmanager
from fastapi import HTTPException

class VersionCheck(unittest.IsolatedAsyncioTestCase):
    async def call(self, version, payload):
        calls=[]
        class Cursor:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def execute(self,sql,params):calls.append((sql,params))
            def fetchone(self):return None if version is None else {'version':version}
        class Conn:
            def cursor(self):return Cursor()
            def commit(self):pass
        @contextmanager
        def connection():yield Conn()
        class Request:
            async def json(self):return payload
        node=next(n for n in ast.parse((Path(__file__).parent/'main.py').read_text()).body if isinstance(n,ast.AsyncFunctionDef) and n.name=='update_invoice');node.decorator_list=[]
        ns={'get_conn':connection,'Request':Request,'HTTPException':HTTPException}
        exec(compile(ast.Module(body=[node],type_ignores=[]),'<test>','exec'),ns)
        try:return await ns[node.name](1,Request()),calls
        except HTTPException as e:return e.status_code,calls
    async def test_stale_version_never_updates(self):
        result,calls=await self.call(3,{'version':2,'subtotal':10});self.assertEqual(result,409);self.assertEqual(len(calls),1);self.assertIn('FOR UPDATE',calls[0][0])
    async def test_current_version_updates_and_increments(self):
        result,calls=await self.call(3,{'version':3,'subtotal':10});self.assertEqual(result['version'],4);self.assertEqual(len(calls),2)
    async def test_missing_record_is_not_reported_saved(self):
        result,calls=await self.call(None,{'version':1,'subtotal':10});self.assertEqual(result,404);self.assertEqual(len(calls),1)
if __name__=='__main__':unittest.main()
