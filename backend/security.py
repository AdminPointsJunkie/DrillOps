"""Supabase JWT authentication and secure-by-default route protection."""

import hashlib
import uuid
from dataclasses import dataclass
from threading import Lock
from time import monotonic, time
from typing import Callable

import httpx
import jwt
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from request_context import RequestAuditContext, request_audit_context
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware

@dataclass(frozen=True)
class AuthUser:
    user_id: str
    email: str
    assurance_level: str
    canonical_id: str = ""
    apps: tuple = ()
    owner: bool = False
    display_name: str = ""


_access_cache = {}
_access_lock = Lock()
_IDENTITY_URL = "https://dzthwvxrltkltfvubvld.supabase.co/functions/v1/drillops-identity"


def verify_access_token(token: str, fresh: bool = False) -> AuthUser:
    key = hashlib.sha256(token.encode()).hexdigest()
    # Coalesce parallel startup calls. Writes always check current access; reads cache for 10s.
    with _access_lock:
        cached = _access_cache.get(key)
        if not fresh and cached and cached[0] > monotonic():
            return cached[1]
        try:
            response = httpx.post(_IDENTITY_URL, headers={"Authorization": "Bearer " + token}, timeout=12)
        except httpx.RequestError as exc:
            raise RuntimeError("Sign-in verification is temporarily unavailable. Please retry.") from exc
        if response.status_code >= 500 or response.status_code == 429:
            raise RuntimeError("Sign-in verification is temporarily unavailable. Please retry.")
        if response.status_code == 403:
            _access_cache.pop(key, None)
            raise HTTPException(403, "Your DrillOps account has no active access")
        response.raise_for_status()
        data = response.json()
        user = AuthUser(user_id=data['operations_user_id'], email=data['email'], assurance_level='aal1', canonical_id=data['user_id'], apps=tuple(data['apps']), owner=data['owner'], display_name=data.get('name', ''))
        # These claims only shorten the cache; authentication is performed by the identity service.
        claims = jwt.decode(token, options={"verify_signature": False})
        ttl = min(10, max(0, float(claims.get('exp', 0)) - time()))
        if len(_access_cache) >= 512:
            _access_cache.clear()
        _access_cache[key] = (monotonic() + ttl, user)
        return user


def current_auth_user(request: Request) -> AuthUser:
    user = getattr(request.state, "auth_user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


class DrillOpsAuthMiddleware(BaseHTTPMiddleware):
    """Authenticate all API calls and enforce central application access."""

    def __init__(self, app, get_conn: Callable):
        super().__init__(app)
        self.get_conn = get_conn
        self.public_paths = {"/", "/health", "/docs", "/redoc", "/openapi.json"}
        self._profiles = set()

    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS" or request.url.path in self.public_paths:
            return await call_next(request)

        authorization = request.headers.get("authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            return self._error(401, "Authentication required")

        try:
            request.state.auth_user = await run_in_threadpool(verify_access_token, token, request.method not in {"GET", "HEAD"})
        except HTTPException as exc:
            return self._error(exc.status_code, str(exc.detail))
        except RuntimeError as exc:
            return self._error(503, str(exc))
        except Exception:
            return self._error(401, "Invalid or expired access token")

        from app_access import can_access
        if not can_access(request.state.auth_user,request.url.path,request.method):
            return self._error(403,"You do not have access to this DrillOps app or action")
        try:
            await run_in_threadpool(self._ensure_profile,request.state.auth_user)
        except Exception:
            return self._error(503,"Your account could not be loaded. Please retry.")

        context_token = request_audit_context.set(
            RequestAuditContext(
                user_id=request.state.auth_user.user_id,
                request_id=str(uuid.uuid4()),
                method=request.method.upper(),
                path=request.url.path,
            )
        )
        try:
            return await call_next(request)
        finally:
            request_audit_context.reset(context_token)

    def _ensure_profile(self,auth):
        # Local records retain legacy IDs and foreign keys. Sign-in belongs to canonical Auth.
        if auth.user_id in self._profiles:
            return
        with self.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM user_profiles WHERE user_id=%s",(auth.user_id,))
                if cur.fetchone():
                    self._profiles.add(auth.user_id)
                    return
                cur.execute("INSERT INTO auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) VALUES(%s,'authenticated','authenticated',%s,'',NOW(),NOW()) ON CONFLICT(id) DO NOTHING",(auth.user_id,auth.email))
                cur.execute("INSERT INTO user_profiles(user_id,display_name,system_role,active) VALUES(%s,%s,'user',TRUE) ON CONFLICT(user_id) DO NOTHING",(auth.user_id,auth.display_name or auth.email))

        self._profiles.add(auth.user_id)

    @staticmethod
    def _error(status: int, detail: str):
        return JSONResponse(
            status_code=status,
            content={"detail": detail},
            headers={"WWW-Authenticate": "Bearer"} if status == 401 else None,
        )
