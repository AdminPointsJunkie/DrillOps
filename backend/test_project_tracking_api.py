from decimal import Decimal
from contextlib import contextmanager
from types import SimpleNamespace
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from project_tracking_api import sample_values,price_tests,amount,integer,create_tracking_router

def test_saved_rates_survive_price_change_and_quantities_recalculate():
    rate={'lab':'Lab A','category':'Gas','test_name':'Gas test','unit':'sample','unit_price':'100','active':True}
    lines,total=price_tests([{'rate_id':1,'quantity':2}],{1:rate},'Lab A','Gas')
    assert total==Decimal('200')
    rate['unit_price']='150'
    saved,total=price_tests([{'rate_id':1,'quantity':3}],{1:rate},'Lab A','Gas',lines)
    assert total==Decimal('300') and saved[0]['unit_price']=='100'
    assert price_tests([],{},'Lab A','Gas')[1] is None

def test_rate_lab_category_and_duplicate_selection_validation():
    rate={'lab':'Lab A','category':'Gas','test_name':'Gas','unit':'sample','unit_price':'1','active':True}
    for items,lab,cat in [([{'rate_id':1,'quantity':1}],'Other','Gas'),([{'rate_id':1,'quantity':1}],'Lab A','CQ'),([{'rate_id':1,'quantity':1}]*2,'Lab A','Gas')]:
        with pytest.raises(HTTPException):price_tests(items,{1:rate},lab,cat)
    for value in ['NaN','Infinity',-1,None]:
        with pytest.raises(HTTPException):amount(value)
    with pytest.raises(HTTPException):integer(1.5)

def test_sample_status_and_dates():
    base={'sample_id':'A','category':'Geotech','status':'Collected','taken_on':'2026-11-01'}
    assert sample_values(base)['category']=='Geotech'
    with pytest.raises(HTTPException):sample_values({**base,'status':'Results received'})
    with pytest.raises(HTTPException):sample_values({**base,'sent_on':'2026-10-01'})

class Cursor:
    def __init__(self,allowed=True):self.allowed=allowed;self.query='';self.params=None;self.calls=[]
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def execute(self,q,p=None):self.query=q;self.params=p;self.calls.append((q,p))
    def fetchone(self):
        if 'user_profiles' in self.query:return {'ok':1} if self.allowed else None
        if 'FROM projects' in self.query:return {'id':1,'name':'Example','program':'Exploration'}
        if 'FROM lab_samples' in self.query:return None
    def fetchall(self):return []

def client(cur):
    @contextmanager
    def conn():yield SimpleNamespace(cursor=lambda:cur)
    app=FastAPI()
    @app.middleware('http')
    async def auth(req,next):req.state.auth_user=SimpleNamespace(user_id='00000000-0000-0000-0000-000000000001');return await next(req)
    app.include_router(create_tracking_router(conn));return TestClient(app)

def test_reads_scope_samples_to_project_and_rates_require_admin():
    cur=Cursor();c=client(cur);assert c.get('/project-labs?project_id=1').status_code==200
    assert any('WHERE project_id=%s' in q and p==(1,) for q,p in cur.calls)
    c=client(Cursor(False));assert c.get('/project-labs?project_id=1').status_code==403;assert c.get('/day-rate-tracking').status_code==403

def test_edit_cannot_access_sample_from_other_project():
    c=client(Cursor());r=c.post('/project-labs/samples',json={'id':2,'revision':1,'project_id':1,'sample_id':'A','category':'Gas','status':'Collected'})
    assert r.status_code==404

def test_projected_total_cannot_overflow_storage():
    with pytest.raises(HTTPException):
        price_tests([{'rate_id':1,'quantity':1000000}],{1:{'active':True,'lab':'Lab','category':'Gas','unit_price':1000000000,'test_name':'Test','unit':'sample'}},'Lab','Gas')
