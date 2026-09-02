"""Supabase JWT authentication and secure-by-default route protection."""

import os
import uuid
from dataclasses import dataclass
from functools import lru_cache
from threading import Lock
from time import monotonic
from typing import Callable

import jwt
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from jwt import PyJWKClient
from request_context import RequestAuditContext, request_audit_context
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware

DEFAULT_SUPABASE_URL = "https://hgovycdpiiumcscljkrd.supabase.co"


@dataclass(frozen=True)
class AuthUser:
    user_id: str
    email: str
    assurance_level: str


@lru_cache(maxsize=1)
def _settings():
    supabase_url = os.environ.get("SUPABASE_URL", DEFAULT_SUPABASE_URL).rstrip("/")
    return {
        "issuer": f"{supabase_url}/auth/v1",
        "audience": os.environ.get("SUPABASE_JWT_AUDIENCE", "authenticated"),
        "jwks": PyJWKClient(f"{supabase_url}/auth/v1/.well-known/jwks.json", cache_keys=True),
    }


def verify_access_token(token: str) -> AuthUser:
    settings = _settings()
    signing_key = settings["jwks"].get_signing_key_from_jwt(token)
    claims = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256", "ES256", "EdDSA"],
        audience=settings["audience"],
        issuer=settings["issuer"],
        options={"require": ["exp", "sub", "aud"]},
    )
    return AuthUser(
        user_id=str(claims["sub"]),
        email=str(claims.get("email") or ""),
        assurance_level=str(claims.get("aal") or "aal1"),
    )


def current_auth_user(request: Request) -> AuthUser:
    user = getattr(request.state, "auth_user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


class DrillOpsAuthMiddleware(BaseHTTPMiddleware):
    """Authenticate all API calls and reserve legacy unscoped routes for system admins."""

    def __init__(self, app, get_conn: Callable):
        super().__init__(app)
        self.get_conn = get_conn
        self.public_paths = {"/", "/health", "/docs", "/redoc", "/openapi.json"}
        self.admin_cache_ttl = max(
            1, int(os.environ.get("SYSTEM_ADMIN_CACHE_TTL", "30"))
        )
        self._admin_cache = {}
        self._admin_cache_lock = Lock()

    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS" or request.url.path in self.public_paths:
            return await call_next(request)

        authorization = request.headers.get("authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            return self._error(401, "Authentication required")

        try:
            request.state.auth_user = await run_in_threadpool(verify_access_token, token)
        except RuntimeError as exc:
            return self._error(503, str(exc))
        except Exception:
            return self._error(401, "Invalid or expired access token")

        if not request.url.path.startswith("/mobile"):
            try:
                is_admin = await run_in_threadpool(
                    self._is_system_admin_cached, request.state.auth_user.user_id
                )
            except Exception:
                is_admin = False
            if not is_admin:
                return self._error(403, "This legacy endpoint requires a system administrator")

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

    def _is_system_admin(self, user_id: str) -> bool:
        with self.get_conn(read_only=True) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT 1 FROM user_profiles
                    WHERE user_id=%s AND active=TRUE AND system_role='system_admin'
                    """,
                    (user_id,),
                )
                return cur.fetchone() is not None

    def _is_system_admin_cached(self, user_id: str) -> bool:
        now = monotonic()
        with self._admin_cache_lock:
            cached = self._admin_cache.get(user_id)
            if cached and now - cached[0] < self.admin_cache_ttl:
                return cached[1]
        is_admin = self._is_system_admin(user_id)
        with self._admin_cache_lock:
            self._admin_cache[user_id] = (now, is_admin)
        return is_admin

    @staticmethod
    def _error(status: int, detail: str):
        return JSONResponse(
            status_code=status,
            content={"detail": detail},
            headers={"WWW-Authenticate": "Bearer"} if status == 401 else None,
        )
