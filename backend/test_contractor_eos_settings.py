from contextlib import contextmanager
from dataclasses import replace
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from business_platform import ARGO, create_business_router
from security import AuthUser

ADMIN = AuthUser('legacy', 'admin@example.test', 'aal1', canonical_id='44444444-4444-4444-8444-444444444444', apps=('eos',), workspaces=({'id': ARGO, 'role': 'admin'},))

def client(auth=ADMIN):
    cur = MagicMock()
    cur.fetchone.return_value = {'name': 'Test', 'category': 'Drilling', 'eos_imports_enabled': False, 'eos_reports_enabled': True}
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cur
    @contextmanager
    def connect(**kwargs):
        yield conn
    app = FastAPI()
    @app.middleware('http')
    async def identity(request, call_next):
        request.state.auth_user = auth
        return await call_next(request)
    app.include_router(create_business_router(connect))
    return TestClient(app), cur

def test_listing_preferences_can_be_updated_independently_and_are_workspace_scoped():
    c, cur = client()
    response = c.patch(f'/platform/workspaces/{ARGO}/contractors/Test', json={'eos_imports_enabled': False})
    assert response.status_code == 200
    sql, args = cur.execute.call_args_list[0].args
    assert 'SET eos_imports_enabled=%s WHERE workspace_id=%s AND name=%s' in sql
    assert args == (False, ARGO, 'Test')
    assert cur.execute.call_args_list[1].args[1][2] == 'contractor.settings_updated'

@pytest.mark.parametrize('value', ['false', 0, None, [], {}])
def test_invalid_listing_values_do_not_write(value):
    c, cur = client()
    assert c.patch(f'/platform/workspaces/{ARGO}/contractors/Test', json={'eos_reports_enabled': value}).status_code == 400
    cur.execute.assert_not_called()

def test_editor_and_other_workspace_cannot_change_preferences():
    for auth, wid in [(replace(ADMIN, workspaces=({'id': ARGO, 'role': 'editor'},)), ARGO), (ADMIN, '33333333-3333-4333-8333-333333333333')]:
        c, cur = client(auth)
        assert c.patch(f'/platform/workspaces/{wid}/contractors/Test', json={'eos_reports_enabled': True}).status_code == 403
        cur.execute.assert_not_called()

def test_all_options_can_be_disabled_and_service_type_stays_editable():
    c, cur = client()
    response = c.patch(f'/platform/workspaces/{ARGO}/contractors/Test', json={'category': 'Geophysical Logging', 'eos_imports_enabled': False, 'eos_reports_enabled': False})
    assert response.status_code == 200
    assert cur.execute.call_args_list[0].args[1] == (False, False, 'Geophysical Logging', ARGO, 'Test')

def test_new_contractor_explicitly_opts_into_eos():
    c, cur = client()
    assert c.post(f'/platform/workspaces/{ARGO}/contractors', json={'name': 'Test', 'category': 'Drilling', 'eos_reports_enabled': True}).status_code == 200
    assert cur.execute.call_args_list[0].args[1][-3:] == (False, True, False)

def test_day_rate_is_an_independent_optional_setting():
    c, cur = client()
    assert c.patch(f'/platform/workspaces/{ARGO}/contractors/Test', json={'eos_day_rates_enabled': True}).status_code == 200
    assert cur.execute.call_args_list[0].args[1] == (True, ARGO, 'Test')
    assert 'SET eos_day_rates_enabled=%s WHERE' in cur.execute.call_args_list[0].args[0]
