import io
from contextlib import contextmanager
from types import SimpleNamespace
import openpyxl,pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from project_register_parser import parse_workbook
from project_registers import planner_changes,create_register_router

def workbook(kind='samples'):
    w=openpyxl.Workbook();s=w.active
    if kind=='samples':
        s.append([]);s.append(['','Hole ID','Site ID','Area','Hole Purpose','Geotech Samples Taken','Geotech Samples Dispatched date','Geotech Report Received date UCS','Geotech Report Received date Triaxial','FI Samples Taken','FI Samples Dispatched date','FI Report Received date','Spon Com Samples Taken','Spon Com Samples Dispatched date','Spon Com Report Received date','Coal Quality Samples Taken'])
        s.append(['','IB670C','IB-26-024','','Gas & Geotech','Yes','15/9/2026',None,None,'N/A',None,None,'Yes','1/10/2026','Draft 8/10/2026','N/A'])
    else:
        s.title='2026 GeoGAS Canister Register';s.append([]);s.append([]);s.append(['Canister Number','Date Dispatched','Date Received','Date Returned','Borehole Number','Date Received by GeoGAS']);s.append(['GM1','1/10/2026',None,None,'IB670C']);s.append(['GM1','2/10/2026',None,None,'IB671C']);s.append([None,None,None,None,None,None,0])
    b=io.BytesIO();w.save(b);return b.getvalue()

def test_import_detects_batches_and_does_not_invent_counts_or_results():
    p=parse_workbook(workbook(),'register.xlsx');r=p['records'][0]
    assert r['year']=='2026' and len(r['metrics']['batches'])==2
    assert r['metrics']['batches'][0]['status']=='Dispatched'
    assert r['metrics']['batches'][1]['status']=='Partial results'
    assert r['metrics']['batches'][1]['results_on'] is None

def test_reimport_keys_stable_and_reused_canisters_distinct():
    a=parse_workbook(workbook('canisters'),'a.xlsx');b=parse_workbook(workbook('canisters'),'renamed.xlsx')
    assert len(a['records'])==2 and len({r['source_key'] for r in a['records']})==2
    assert [r['source_key'] for r in a['records']]==[r['source_key'] for r in b['records']]

def test_planner_preserves_cancellations_history_budgets_and_ambiguous_holes():
    record=dict(kind='boreholes',sheet='All Holes Final',hole_id='IB670C',year='2026',metrics=dict(eoh_depth=282.44,total_core=22.62,rig='Mitchell 1218'))
    project=dict(year='2026');hole=dict(id=1,hole_id='IB670C',status='Complete',eoh_depth=285,budget_total=1000)
    updates,issues=planner_changes([record],[hole],project)
    assert updates[0]['after']==dict(eoh_depth=282.44,total_core=22.62,assigned_rig='1218')
    assert planner_changes([record],[{**hole,'status':'Cancelled'}],project)[0]==[]
    assert planner_changes([record],[hole,hole],project)[0]==[]
    assert planner_changes([{**record,'year':'2025'}],[hole],project)[0]==[]

def test_bad_workbook_rejected():
    with pytest.raises(Exception):parse_workbook(b'not a workbook','x.xlsx')

class Cur:
    def __enter__(self):return self
    def __exit__(self,*a):pass
    def execute(self,q,p=None):self.q=q
    def fetchone(self):return None

def test_register_read_requires_project_access():
    @contextmanager
    def conn():yield SimpleNamespace(cursor=Cur)
    app=FastAPI()
    @app.middleware('http')
    async def auth(req,next):req.state.auth_user=SimpleNamespace(user_id='x',owner=False,apps=['eos']);return await next(req)
    app.include_router(create_register_router(conn))
    assert TestClient(app).get('/project-registers?project_id=4').status_code==403


def test_numeric_zero_source_values_are_preserved():
    w=openpyxl.load_workbook(io.BytesIO(workbook('canisters')))
    w.active.cell(4,7,0)
    buf=io.BytesIO();w.save(buf)
    row=parse_workbook(buf.getvalue(),'canisters.xlsx')['records'][0]
    assert row['fields']['G']==0
    assert row['metrics']['hire_days']['1']==0
