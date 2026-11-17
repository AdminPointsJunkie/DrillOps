from contextlib import contextmanager
from dataclasses import replace
import pytest
from fastapi import HTTPException
from business_platform import ARGO, resolve_request_scope, require_workspace
from security import AuthUser

P='11111111-1111-4111-8111-111111111111'
C='22222222-2222-4222-8222-222222222222'
OTHER='33333333-3333-4333-8333-333333333333'
BASE=AuthUser('legacy','person@example.test','aal1',canonical_id='44444444-4444-4444-8444-444444444444',apps=('eos',),workspaces=({'id':ARGO,'role':'editor'},))
class Database:
 def __init__(self,shares=()):self.shares=list(shares);self.result=[]
 @contextmanager
 def connect(self):yield self
 @contextmanager
 def cursor(self):yield self
 def execute(self,sql,args):
  if 'FROM business_shares' in sql:self.result=self.shares
  elif 'WHERE id=%s AND workspace_id=%s' in sql:self.result=[{'project_id':P}] if args[0] in (P,C) and args[1]==ARGO else []
  elif 'id=ANY' in sql:self.result=[{'ok':1}] if C in args[1] else []
  else:raise AssertionError(sql)
 def fetchone(self):return self.result[0] if self.result else None
 def fetchall(self):return self.result

def share(role='viewer',apps=('eos',)):return {'project_id':None,'campaign_id':C,'role':role,'apps':apps}
def resolve(db,auth=BASE,method='GET',**headers):return resolve_request_scope(auth,headers,method,db.connect,{'eos','project'})

def test_campaign_viewer_only_reads_shared_scope():
 db=Database([share()]);scope=resolve(db,**{'x-campaign-id':C})
 assert scope.read_campaigns==(C,) and scope.write_campaigns==() and scope.project_id==P
 with pytest.raises(HTTPException) as exc:resolve(db,method='POST',**{'x-campaign-id':C})
 assert exc.value.status_code==403

def test_workspace_and_campaign_spoofing_rejected():
 for headers in ({'x-workspace-id':OTHER},{'x-campaign-id':OTHER},{'x-campaign-id':C,'x-business-project-id':OTHER}):
  with pytest.raises(HTTPException):resolve(Database([share('editor')]),**headers)

def test_shares_cannot_enable_an_ungranted_app():
 with pytest.raises(HTTPException):resolve(Database([share('editor',('project',))]),**{'x-drillops-app':'project'})
 with pytest.raises(HTTPException):resolve(Database([share('editor',('project',))]))

def test_revocation_effective_on_next_request():
 db=Database([share('editor')]);assert resolve(db).write_campaigns==(C,)
 db.shares=[]
 with pytest.raises(HTTPException):resolve(db)

def test_platform_admin_and_existing_workspace_admin_preserved():
 for auth in (replace(BASE,owner=True),replace(BASE,workspaces=({'id':ARGO,'role':'admin'},))):
  assert resolve(Database(),auth).admin
  assert require_workspace(auth,ARGO,True)
 with pytest.raises(HTTPException):require_workspace(BASE,ARGO,True)


from business_platform import BusinessScope, current_business_scope, import_destination, require_contractor_admin

def test_import_requires_selected_campaign_even_for_admin():
 token=current_business_scope.set(BusinessScope(ARGO,admin=True))
 try:
  with pytest.raises(HTTPException) as exc:import_destination(None,'Spoof','Spoof','Spoof')
  assert exc.value.status_code==409
 finally:current_business_scope.reset(token)

def test_import_uses_authorized_campaign_labels_not_upload_labels():
 class ImportDatabase(Database):
  def execute(self,sql,args):
   assert args==(C,P,ARGO)
   self.result=[{'program':'Exploration','name':'Ironbark','client':'ARGO NR'}]
 token=current_business_scope.set(BusinessScope(ARGO,P,C,True))
 try:assert import_destination(ImportDatabase().connect,'Wrong','Wrong','Wrong')==('Exploration','Ironbark','ARGO NR')
 finally:current_business_scope.reset(token)

def test_contractor_types_require_workspace_admin_even_for_editors():
 token=current_business_scope.set(BusinessScope(ARGO,P,C,False,write_campaigns=(C,)))
 try:
  with pytest.raises(HTTPException) as exc:require_contractor_admin()
  assert exc.value.status_code==403
 finally:current_business_scope.reset(token)
