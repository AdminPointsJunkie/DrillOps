import ast,sys
from contextlib import contextmanager
from pathlib import Path
from threading import BoundedSemaphore
from types import SimpleNamespace
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from business_platform import BusinessScope,current_business_scope

class Conn:
 def __init__(self):self.autocommit=False;self.closed=False;self.commands=[];self.role='postgres';self.resets=0
 @contextmanager
 def cursor(self):yield self
 def execute(self,sql,args=None):
  self.commands.append(sql)
  if 'SET ROLE drillops_business' in sql:self.role='drillops_business'
  if sql=='RESET ROLE':self.role='postgres';self.resets+=1
 def commit(self):pass
 def rollback(self):pass

@pytest.mark.parametrize('fail',[False,True])
def test_pool_returns_connection_without_workspace_role(fail):
 tree=ast.parse((Path(__file__).resolve().parents[1]/'backend/main.py').read_text(encoding='utf8'))
 fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='get_conn')
 conn=Conn();returned=[]
 env={'contextmanager':contextmanager,'current_business_scope':current_business_scope,'_db_pool_slots':BoundedSemaphore(1),'DB_POOL_ACQUIRE_TIMEOUT':1,'_get_live_connection':lambda:conn,'current_request_audit_context':lambda:SimpleNamespace(user_id='test',request_id='request',method='GET',path='/activities'),'_connection_failed':lambda *_:False,'_mark_pool_connection_used':lambda _:None,'_db_pool':SimpleNamespace(putconn=lambda c,close:returned.append(close)),'_forget_pool_connection':lambda _:None,'psycopg2':SimpleNamespace(Error=RuntimeError)}
 exec(compile(ast.Module(body=[fn],type_ignores=[]),'<get_conn>','exec'),env)
 token=current_business_scope.set(BusinessScope('a7ecd88b-8ba9-4c5f-80c8-872fcc50f34f',admin=True))
 try:
  try:
   with env['get_conn'](read_only=True) as borrowed:
    assert borrowed.role=='drillops_business'
    borrowed.commit()  # Legacy handlers commit internally; authorization must survive.
    assert borrowed.role=='drillops_business'
    if fail:raise ValueError('handler error')
  except ValueError:
   assert fail
 finally:current_business_scope.reset(token)
 assert conn.role=='postgres' and conn.resets==1 and not conn.autocommit
 assert 'RESET ALL' in conn.commands and returned==[False]
