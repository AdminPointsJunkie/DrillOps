from contextlib import contextmanager
from unittest.mock import MagicMock
from types import SimpleNamespace
import pytest
from fastapi import FastAPI,HTTPException
from fastapi.testclient import TestClient
from rig_schedule import values,active_entries,create_schedule_router

base=dict(project='Ironbark',program='Exploration',planned_year='2026',assigned_rig='DR17',hole_id='IB671C',site_id='IB-26-009',kind='Drilling',status='Planned',notes='',scheduled_start='2026-10-20',scheduled_end='2026-10-20')
@pytest.mark.parametrize('patch',[{'scheduled_end':'2026-10-19'},{'scheduled_start':'2026-02-30'},{'assigned_rig':''},{'planned_year':'xx'},{'status':'Unknown'},{'site_id':'','hole_id':''}])
def test_bad_booking_rejected(patch):
    with pytest.raises(HTTPException):values({**base,**patch})
def test_planner_cancellation_matches_site_prefix_without_affecting_other_projects():
    cancelled=[dict(project='Ironbark',program='Exploration',site_id='26-009',status='Cancelled')]
    assert active_entries([base],cancelled)==[]
    assert len(active_entries([{**base,'project':'Other'}],cancelled))==1
def client(rows,apps=('project',)):
    cur=MagicMock();cur.fetchone.side_effect=rows;cur.fetchall.return_value=[];conn=MagicMock();conn.cursor.return_value.__enter__.return_value=cur
    @contextmanager
    def get_conn(**kwargs):yield conn
    app=FastAPI()
    @app.middleware('http')
    async def auth(request,call_next):request.state.auth_user=SimpleNamespace(user_id='owner',owner=False,apps=apps);return await call_next(request)
    app.include_router(create_schedule_router(get_conn));return TestClient(app),cur
def test_save_is_audited_and_stale_changes_fail():
    c,cur=client([{**base,'id':1,'revision':1}]);assert c.post('/rig-schedule',json=base).status_code==200
    assert any('audit_events' in x.args[0] for x in cur.execute.call_args_list)
    c,cur=client([dict(id=1,revision=2)]);assert c.post('/rig-schedule',json={**base,'id':1,'revision':1}).status_code==409
def test_accounts_cannot_read_or_write():
    c,cur=client([],('account',));assert c.get('/rig-schedule').status_code==403;assert c.post('/rig-schedule',json=base).status_code==403;assert not cur.execute.called
def test_cancelled_planner_cannot_be_rescheduled():
    c,cur=client([]);cur.fetchall.return_value=[dict(project='Ironbark',program='Exploration',site_id='26-009',status='Cancelled')]
    assert c.post('/rig-schedule',json=base).status_code==409

def test_workbook_precedence_cancellations_rig_mapping_and_return_visits(monkeypatch):
    import importlib.util
    from pathlib import Path
    spec=importlib.util.spec_from_file_location('read_rig_schedule',Path(__file__).parents[1]/'scripts/read_rig_schedule.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    source={'2026 EXP':{6:{'K':'IB-26-001','F':'CANCELLED'},7:{'K':'IB-26-009','L':'IB671C','F':'PLANNED'}},'LMP SCHEDULE':{},'EXP Schedule':{6:{'D':'IB-26-001','E':'46296','F':'46301'},7:{'D':'IB-26-009','C':'IB671C','E':'46296','F':'46301'},8:{'D':'IB-26-050','E':'46290','F':'46295'}},'RIG Schedule':{3:{'B':'46296','AD':'IB','AE':'IB-26-009','T':'IB','U':'GR23'},4:{'B':'46297','AE':'Break'},5:{'B':'46298','AD':'IB','AE':'IB-26-009'}}}
    monkeypatch.setattr(module,'read',lambda path:source);result=module.extract('unused');rows=result['entries']
    assert len(rows)==4
    assert not any(r['assigned_rig']=='DR28' or r['site_id']=='IB-26-001' for r in rows)
    visits=[r for r in rows if r['site_id']=='IB-26-009']
    assert len(visits)==2 and all(r['assigned_rig']=='DR17' and r['scheduled_start']==r['scheduled_end'] for r in visits)
    older=next(r for r in rows if r['site_id']=='IB-26-050')
    assert (module.dt.date.fromisoformat(older['scheduled_end'])-module.dt.date.fromisoformat(older['scheduled_start'])).days+1==5
