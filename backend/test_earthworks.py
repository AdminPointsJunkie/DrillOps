import base64
import copy
import json
from contextlib import contextmanager
from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from business_platform import BusinessScope, current_business_scope
from security import AuthUser
from earthworks_api import create_earthworks_router, validate_report, next_state, scope_for
from app_access import can_access

W, P, C, USER, SUPERVISOR, CODE = [str(uuid4()) for _ in range(6)]
SCOPE = BusinessScope(W, P, C, write_campaigns=(C,), read_campaigns=(C,))
CODES = {CODE: {"id": CODE, "code": "IB-26-054", "label": "Pad", "kind": "site", "chargeable": True, "active": True}}
AUTH = AuthUser(USER, "operator@example.test", "aal1", canonical_id=USER, apps=("eos",), display_name="Operator")


def report():
    return {"id": str(uuid4()), "date": 817000000, "reportDate": "2026-11-26", "operatorName": "Operator", "activities": [
        {"id": str(uuid4()), "start": 360, "end": 480, "task": "Prepare pad", "site": "Forged code", "siteCodeID": CODE,
         "equipment": "Excavator", "equipmentID": "EX-014", "operatingMinutes": 60, "standbyMinutes": 15}]}


def test_separate_labour_machine_and_authoritative_allocation():
    value = validate_report(report(), CODES, True)
    assert value["operatorMinutes"] == 120
    assert value["activities"][0]["operatingMinutes"] == 60
    assert value["activities"][0]["site"] == "IB-26-054"
    assert value["activities"][0]["chargeable"] is True


@pytest.mark.parametrize("changes", [
    {"operatingMinutes": 121}, {"standbyMinutes": -1}, {"meterStart": 12},
    {"meterStart": 14, "meterEnd": 12}, {"meterStart": float('nan'), "meterEnd": 12},
    {"equipmentID": ""}, {"siteCodeID": str(uuid4())}, {"completion": "preparationComplete"},
    {"end": 300}, {"start": True}, {"photos": [{"id": str(uuid4()), "jpeg": "not a photo"}]},
])
def test_invalid_submission(changes):
    value = report(); value["activities"][0].update(changes)
    with pytest.raises(HTTPException): validate_report(value, CODES, True)


def test_completion_requires_evidence_and_site():
    value = report(); value["activities"][0].update(completion="preparationComplete", notes="Pit complete and inspected")
    assert not validate_report(value, CODES, True)["validationIssues"]
    with pytest.raises(HTTPException): validate_report(value, {CODE: dict(CODES[CODE], kind="overhead")}, True)


def test_overlap_gaps_and_draft_preservation():
    value = report(); second = dict(value["activities"][0], id=str(uuid4()), start=450, end=570)
    value["activities"].append(second)
    draft = validate_report(value, CODES)
    assert draft["operatorMinutes"] == 210
    assert "Activities overlap" in draft["validationIssues"]
    with pytest.raises(HTTPException): validate_report(value, CODES, True)
    second.update(start=540, end=660)
    assert validate_report(value,CODES,True)["operatorMinutes"] == 240


def test_workflow_and_self_approval():
    assert next_state("draft", "submit", True, False, "") == "submitted"
    assert next_state("submitted", "return", False, True, "Correct meter") == "returned"
    assert next_state("returned", "submit", True, False, "") == "submitted"
    assert next_state("submitted", "approve", False, True, "") == "approved"
    for args in [("submitted","approve",True,True,""), ("submitted","return",False,True,""), ("approved","submit",True,True,""), ("submitted","approve",False,False,"")]:
        with pytest.raises(HTTPException): next_state(*args)


def test_scope_enforces_selected_campaign_not_any_write_grant():
    token = current_business_scope.set(replace(SCOPE, write_campaigns=(str(uuid4()),)))
    try:
        assert scope_for().campaign_id == C
        with pytest.raises(HTTPException): scope_for(True)
    finally: current_business_scope.reset(token)
    assert can_access(AUTH, "/eos/earthworks/reports", "GET")
    assert not can_access(replace(AUTH, apps=("account",)), "/eos/earthworks/reports", "GET")


class Database:
    def __init__(self): self.reports = {}; self.rows = []
    @contextmanager
    def connect(self): yield self
    @contextmanager
    def cursor(self): yield self
    def fetchone(self): return copy.deepcopy(self.rows[0]) if self.rows else None
    def fetchall(self): return copy.deepcopy(self.rows)
    def execute(self, sql, args):
        self.rows = []
        if 'pg_advisory_xact_lock' in sql: return
        if 'SELECT' in sql and 'eos_earthworks_codes' in sql:
            self.rows = list(CODES.values()); return
        if 'SELECT 1 FROM eos_earthworks_reviewers' in sql:
            self.rows = [{"ok": 1}] if args[-1] == SUPERVISOR else []; return
        if 'SELECT * FROM eos_earthworks_reports' in sql:
            if 'id>%s' in sql:
                w,p,c,after,uid,reviewer = args
                self.rows = [r for key,r in self.reports.items() if key[:3] == (w,p,c) and key[3] > after and (r['owner_id']==uid or reviewer and r['status']!='draft')]
            elif tuple(args) in self.reports: self.rows = [self.reports[tuple(args)]]
            return
        if sql.startswith('INSERT INTO eos_earthworks_reports'):
            rid,w,p,c,owner,status,revision,document,history,mutation = args
            row = dict(id=rid,owner_id=owner,status=status,revision=revision,document=json.loads(document),history=json.loads(history),last_mutation=mutation)
            self.reports[(w,p,c,rid)] = row; self.rows = [row]; return
        if sql.startswith('UPDATE eos_earthworks_reports'):
            status,history,mutation,w,p,c,rid = args
            row=self.reports[(w,p,c,rid)]; row.update(status=status,history=json.loads(history),last_mutation=mutation,revision=row['revision']+1)
            self.rows=[row]; return
        raise AssertionError(sql)


@pytest.fixture
def api():
    db = Database(); app = FastAPI(); state = {"auth": AUTH, "scope": SCOPE}
    @app.middleware("http")
    async def identity(request, call_next):
        request.state.auth_user = state['auth']; token = current_business_scope.set(state['scope'])
        try: return await call_next(request)
        finally: current_business_scope.reset(token)
    app.include_router(create_earthworks_router(db.connect))
    return TestClient(app), state, db


def test_roundtrip_retry_conflict_review_and_tenant_isolation(api):
    client,state,db = api; value = report(); path = '/eos/earthworks/reports/' + value['id']
    payload = dict(report=value, expectedRevision=0, mutationID=str(uuid4()))
    first = client.put(path,json=payload); assert first.status_code == 200, first.text
    assert first.json()['revision'] == 1
    assert client.put(path,json=payload).json()['revision'] == 1  # response-lost retry
    payload['mutationID'] = str(uuid4())
    assert client.put(path,json=payload).status_code == 409
    submit = dict(expectedRevision=1,mutationID=str(uuid4()),action='submit')
    submitted=client.post(path+'/transition',json=submit); assert submitted.status_code==200,submitted.text
    assert client.post(path+'/transition',json=submit).json()['revision']==2
    approve=dict(expectedRevision=2,mutationID=str(uuid4()),action='approve')
    assert client.post(path+'/transition',json=approve).status_code==403
    state['auth']=replace(AUTH,canonical_id=SUPERVISOR,user_id=SUPERVISOR,display_name='Supervisor')
    assert len(client.get('/eos/earthworks/reports').json()['reports']) == 1
    approved=client.post(path+'/transition',json=approve)
    assert approved.status_code==200,approved.text
    assert approved.json()['history'][-1]['actorID']==SUPERVISOR
    assert approved.json()['status']=='approved'
    assert client.put(path,json=dict(payload,expectedRevision=3)).status_code==403
    state['scope']=replace(SCOPE,workspace_id=str(uuid4()))
    assert client.get('/eos/earthworks/reports').json()['reports']==[]
    assert client.post(path+'/transition',json=approve).status_code==404


def test_unassigned_user_cannot_read_or_review_other_report(api):
    client,state,_=api; value=report(); path='/eos/earthworks/reports/'+value['id']
    assert client.put(path,json=dict(report=value,expectedRevision=0,mutationID=str(uuid4()))).status_code==200
    state['auth']=replace(AUTH,user_id=str(uuid4()),canonical_id=str(uuid4()))
    assert client.get('/eos/earthworks/reports').json()['reports']==[]
    assert client.post(path+'/transition',json=dict(expectedRevision=1,mutationID=str(uuid4()),action='approve')).status_code==403
