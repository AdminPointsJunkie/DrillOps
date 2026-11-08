from contextlib import contextmanager
from unittest.mock import MagicMock
from decimal import Decimal
from types import SimpleNamespace
import pytest
from fastapi import FastAPI,HTTPException
from fastapi.testclient import TestClient
from account_accruals import values,create_accrual_router

base=dict(project_id=1,period='2026-11',amount='500.25',supplier='Fortem',status='Open')
@pytest.mark.parametrize('change',[{'amount':'NaN'},{'amount':'Infinity'},{'amount':'0'},{'amount':'-1'},{'period':'2026-13'},{'status':'Voided'},{'supplier':''}])
def test_invalid_estimates(change):
    with pytest.raises(HTTPException):values({**base,**change})

def client(rows,apps=('account',)):
    cur=MagicMock();cur.fetchone.side_effect=rows;conn=MagicMock();conn.cursor.return_value.__enter__.return_value=cur
    @contextmanager
    def get_conn(**kwargs):yield conn
    app=FastAPI()
    @app.middleware('http')
    async def auth(request,call_next):request.state.auth_user=SimpleNamespace(user_id='owner',owner=False,apps=apps);return await call_next(request)
    app.include_router(create_accrual_router(get_conn));return TestClient(app),cur

def test_supplier_save_audited_and_amount_exact():
    row={**values(base),'id':1,'revision':1};c,cur=client([{'name':'Ironbark','program':'Exploration'},{'exists':1},row]);r=c.post('/account-accruals',json=base)
    assert r.status_code==200 and row['amount']==Decimal('500.25')
    assert any('audit_events' in call.args[0] for call in cur.execute.call_args_list)

def test_po_sets_supplier_and_validates_project_and_open_status():
    po={'id':5,'po_number':'PO-5','contractor':'Fortem','project':'Other','program':'Exploration','status':'Active'}
    c,cur=client([{'name':'Ironbark','program':'Exploration'},po]);assert c.post('/account-accruals',json={**base,'po_id':5}).status_code==400
    c,cur=client([{'name':'Ironbark','program':'Exploration'},{**po,'project':'Ironbark','status':'Completed'}]);assert c.post('/account-accruals',json={**base,'po_id':5}).status_code==400
    c,cur=client([{'name':'Ironbark','program':'Exploration'},{**po,'project':'Ironbark'},{**values(base),'id':1,'revision':1}]);assert c.post('/account-accruals',json={**base,'po_id':5,'supplier':'Wrong'}).status_code==200
    insert=next(call for call in cur.execute.call_args_list if call.args[0].startswith('INSERT INTO account_accruals'));assert 'Fortem' in insert.args[1] and 'Wrong' not in insert.args[1]

def test_stale_update_and_delete_are_conflicts():
    c,cur=client([{'id':1,'status':'Open','revision':2}]);assert c.post('/account-accruals',json={**base,'id':1,'revision':1}).status_code==409
    c,cur=client([None]);assert c.delete('/account-accruals/1?revision=1').status_code==409

def test_project_access_cannot_edit_estimates():
    c,cur=client([],('project',));assert c.post('/account-accruals',json=base).status_code==403;assert not cur.execute.called

def test_project_summary_is_read_only_scoped_and_available_to_project_users():
    c,cur=client([{'id':1,'invoiced':Decimal('1000'),'accruals':Decimal('500'),'missing_amounts':0}],('project',))
    r=c.get('/account-accruals/project-summary?project_id=1')
    assert r.status_code==200 and r.json()['combined']==1500
    assert cur.execute.call_args.args[1]==(1,)
