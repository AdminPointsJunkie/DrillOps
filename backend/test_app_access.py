import time
from types import SimpleNamespace
import pytest
import httpx
import jwt
from fastapi import HTTPException
from app_access import can_access
import security

@pytest.mark.parametrize('app,allowed,denied',[
 ('eos','/eos/weather','/invoice-ledger'),('account','/reconciliation/monthly','/activities'),
 ('project','/project-hole-report-data','/invoices'),('fieldmaps','/mobile/me','/projects'),
 ('field','/mobile/projects','/activities')])
def test_independent_app_permissions(app,allowed,denied):
    user=SimpleNamespace(owner=False,apps=[app])
    assert can_access(user,allowed,'GET')
    assert not can_access(user,denied,'GET')
    assert not can_access(user,'/admin/users','GET')
    assert not can_access(user,'/unclassified','POST')


def test_owner_and_disabled_access():
    assert can_access(SimpleNamespace(owner=True,apps=[]),'/admin/users','GET')
    assert not can_access(SimpleNamespace(owner=False,apps=[]),'/projects','GET')
    assert not can_access(SimpleNamespace(owner=False,apps=['eos']),'/clients','POST')
    assert can_access(SimpleNamespace(owner=False,apps=['eos']),'/clients','GET')


def test_verified_cache_and_immediate_write_revocation(monkeypatch):
    security._access_cache.clear()
    calls=[]
    body=dict(operations_user_id='local',user_id='canonical',email='test@example.invalid',apps=['eos'],owner=False)
    status=[200]
    def post(url,**kwargs):
        calls.append(url)
        return httpx.Response(status[0],json=body,request=httpx.Request('POST',url))
    monkeypatch.setattr(security.httpx,'post',post)
    token=jwt.encode({'exp':time.time()+3600},'test-key-only-never-production-123456789',algorithm='HS256')
    assert security.verify_access_token(token).user_id=='local'
    assert security.verify_access_token(token).canonical_id=='canonical'
    assert len(calls)==1
    status[0]=403
    with pytest.raises(HTTPException) as exc:security.verify_access_token(token,fresh=True)
    assert exc.value.status_code==403
    with pytest.raises(HTTPException):security.verify_access_token(token)
    assert len(calls)==3


def test_auth_outage_is_retryable(monkeypatch):
    security._access_cache.clear()
    def failed(*args,**kwargs):raise httpx.ConnectError('offline')
    monkeypatch.setattr(security.httpx,'post',failed)
    with pytest.raises(RuntimeError,match='temporarily unavailable'):security.verify_access_token('token')
