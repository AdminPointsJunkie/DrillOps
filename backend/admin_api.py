"""System-administrator APIs for DrillOps users, imports, and audit history."""

import os
import re
from collections import defaultdict

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from audit import record_audit_event
from security import current_auth_user


PROJECT_ROLES = {
    "project_manager",
    "approver",
    "contractor_supervisor",
    "field_user",
    "finance",
    "auditor",
}
SYSTEM_ROLES = {"user", "system_admin"}
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def create_admin_router(get_conn):
    router = APIRouter(prefix="/admin", tags=["admin"])

    def require_admin(cur, request: Request):
        auth = current_auth_user(request)
        cur.execute(
            """
            SELECT display_name, system_role, active
            FROM user_profiles
            WHERE user_id=%s
            """,
            (auth.user_id,),
        )
        profile = cur.fetchone()
        if not profile or not profile["active"] or profile["system_role"] != "system_admin":
            raise HTTPException(403, "System administrator access is required")
        return auth, profile

    def normalise_memberships(value):
        if value is None:
            return None
        if not isinstance(value, list):
            raise HTTPException(400, "project_memberships must be a list")
        result = []
        seen = set()
        for item in value:
            if not isinstance(item, dict):
                raise HTTPException(400, "Each project membership must be an object")
            try:
                project_id = int(item.get("project_id"))
            except (TypeError, ValueError):
                raise HTTPException(400, "Each project membership needs a valid project_id")
            role = str(item.get("role") or "field_user").strip()
            if role not in PROJECT_ROLES:
                raise HTTPException(400, f"Unsupported project role: {role}")
            if project_id not in seen:
                result.append({"project_id": project_id, "role": role})
                seen.add(project_id)
        return result

    def apply_user_access(cur, user_id, payload, *, existing=None):
        display_name = str(payload.get("display_name") or "").strip()
        if not display_name:
            raise HTTPException(400, "Display name is required")
        system_role = str(payload.get("system_role") or "user").strip()
        if system_role not in SYSTEM_ROLES:
            raise HTTPException(400, "Invalid system role")
        active = bool(payload.get("active", True))
        memberships = normalise_memberships(payload.get("project_memberships"))
        if system_role == "user" and active and memberships is not None and not memberships:
            raise HTTPException(400, "A project user needs access to at least one project")

        cur.execute(
            """
            INSERT INTO user_profiles (user_id, display_name, system_role, active, updated_at)
            VALUES (%s, %s, %s, %s, NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                display_name=EXCLUDED.display_name,
                system_role=EXCLUDED.system_role,
                active=EXCLUDED.active,
                updated_at=NOW()
            """,
            (user_id, display_name, system_role, active),
        )

        if memberships is not None:
            project_ids = [item["project_id"] for item in memberships]
            if project_ids:
                cur.execute("SELECT id FROM projects WHERE id = ANY(%s)", (project_ids,))
                found = {int(row["id"]) for row in cur.fetchall()}
                missing = sorted(set(project_ids) - found)
                if missing:
                    raise HTTPException(400, f"Unknown project id(s): {', '.join(map(str, missing))}")
            cur.execute(
                "UPDATE project_memberships SET active=FALSE WHERE user_id=%s",
                (user_id,),
            )
            for membership in memberships:
                cur.execute(
                    """
                    INSERT INTO project_memberships (user_id, project_id, role, active)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (user_id, project_id) DO UPDATE SET
                        role=EXCLUDED.role,
                        active=EXCLUDED.active
                    """,
                    (user_id, membership["project_id"], membership["role"], active),
                )
        elif existing is not None and active != bool(existing.get("active")):
            cur.execute(
                "UPDATE project_memberships SET active=%s WHERE user_id=%s",
                (active, user_id),
            )

        return {
            "display_name": display_name,
            "system_role": system_role,
            "active": active,
            "project_memberships": memberships,
        }

    @router.get("/users")
    def list_users(request: Request):
        with get_conn() as conn:
            with conn.cursor() as cur:
                require_admin(cur, request)
                cur.execute(
                    """
                    SELECT auth_user.id::text AS id, auth_user.email,
                           auth_user.created_at, auth_user.invited_at,
                           auth_user.email_confirmed_at, auth_user.last_sign_in_at,
                           profile.display_name, profile.system_role, profile.active
                    FROM auth.users AS auth_user
                    LEFT JOIN user_profiles AS profile ON profile.user_id=auth_user.id
                    ORDER BY COALESCE(profile.active, FALSE) DESC,
                             LOWER(COALESCE(profile.display_name, auth_user.email, ''))
                    """
                )
                users = [dict(row) for row in cur.fetchall()]
                cur.execute(
                    """
                    SELECT membership.user_id::text, membership.project_id,
                           membership.role, membership.active,
                           project.name AS project_name, project.program
                    FROM project_memberships AS membership
                    JOIN projects AS project ON project.id=membership.project_id
                    ORDER BY project.name
                    """
                )
                memberships = defaultdict(list)
                for row in cur.fetchall():
                    item = dict(row)
                    memberships[item.pop("user_id")].append(item)
                for user in users:
                    user["project_memberships"] = memberships[user["id"]]
                return users

    @router.post("/users/invite")
    async def invite_user(request: Request):
        payload = await request.json()
        email = str(payload.get("email") or "").strip().lower()
        if not EMAIL_PATTERN.match(email):
            raise HTTPException(400, "A valid email address is required")
        display_name = str(payload.get("display_name") or "").strip()
        if not display_name:
            raise HTTPException(400, "Display name is required")
        system_role = str(payload.get("system_role") or "user").strip()
        if system_role not in SYSTEM_ROLES:
            raise HTTPException(400, "Invalid system role")
        memberships = normalise_memberships(payload.get("project_memberships"))
        if system_role == "user" and not memberships:
            raise HTTPException(400, "A project user needs access to at least one project")
        payload = {
            **payload,
            "display_name": display_name,
            "system_role": system_role,
            "active": True,
            "project_memberships": memberships,
        }

        with get_conn() as conn:
            with conn.cursor() as cur:
                auth, _ = require_admin(cur, request)
                cur.execute("SELECT id FROM auth.users WHERE LOWER(email)=LOWER(%s)", (email,))
                if cur.fetchone():
                    raise HTTPException(409, "That email already has a DrillOps account")
                project_ids = [item["project_id"] for item in memberships or []]
                if project_ids:
                    cur.execute("SELECT id FROM projects WHERE id = ANY(%s)", (project_ids,))
                    found = {int(row["id"]) for row in cur.fetchall()}
                    missing = sorted(set(project_ids) - found)
                    if missing:
                        raise HTTPException(
                            400,
                            f"Unknown project id(s): {', '.join(map(str, missing))}",
                        )

        supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        secret_key = (
            os.environ.get("SUPABASE_SECRET_KEY", "").strip()
            or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        )
        if not supabase_url or not secret_key:
            raise HTTPException(
                503,
                "User invitations are not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY to the API service.",
            )
        redirect_to = os.environ.get("SUPABASE_INVITE_REDIRECT_URL", "https://drillops.com.au/")
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(
                    f"{supabase_url}/auth/v1/invite",
                    params={"redirect_to": redirect_to},
                    headers={
                        "apikey": secret_key,
                        "Authorization": f"Bearer {secret_key}",
                        "Content-Type": "application/json",
                    },
                    json={"email": email, "data": {"full_name": display_name}},
                )
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"Supabase invitation request failed: {exc}")
        result = response.json() if response.content else {}
        if not response.is_success:
            raise HTTPException(
                response.status_code,
                result.get("msg") or result.get("message") or "Supabase could not send the invitation",
            )
        user_result = result.get("user") if isinstance(result.get("user"), dict) else result
        user_id = str(user_result.get("id") or "")
        if not user_id:
            raise HTTPException(502, "Supabase sent the invitation but did not return a user id")

        with get_conn() as conn:
            with conn.cursor() as cur:
                configured = apply_user_access(cur, user_id, payload)
                record_audit_event(
                    cur,
                    action="user.invite",
                    entity_type="user",
                    entity_key=user_id,
                    actor_user_id=auth.user_id,
                    details={"email": email, **configured},
                )
        return {"status": "invited", "id": user_id, "email": email}

    @router.patch("/users/{user_id}")
    async def update_user(user_id: str, request: Request):
        payload = await request.json()
        with get_conn() as conn:
            with conn.cursor() as cur:
                auth, _ = require_admin(cur, request)
                cur.execute(
                    """
                    SELECT profile.display_name, profile.system_role, profile.active,
                           auth_user.email
                    FROM user_profiles AS profile
                    JOIN auth.users AS auth_user ON auth_user.id=profile.user_id
                    WHERE profile.user_id=%s
                    """,
                    (user_id,),
                )
                existing = cur.fetchone()
                if not existing:
                    raise HTTPException(404, "User not found")
                requested_role = str(payload.get("system_role", existing["system_role"]))
                requested_active = bool(payload.get("active", existing["active"]))
                if user_id == auth.user_id and (
                    not requested_active or requested_role != "system_admin"
                ):
                    raise HTTPException(400, "You cannot remove your own administrator access")
                if existing["system_role"] == "system_admin" and (
                    not requested_active or requested_role != "system_admin"
                ):
                    cur.execute(
                        """
                        SELECT COUNT(*) AS count
                        FROM user_profiles
                        WHERE system_role='system_admin' AND active=TRUE AND user_id<>%s
                        """,
                        (user_id,),
                    )
                    if int(cur.fetchone()["count"] or 0) == 0:
                        raise HTTPException(400, "DrillOps must keep at least one active administrator")
                merged = {
                    "display_name": payload.get("display_name", existing["display_name"]),
                    "system_role": requested_role,
                    "active": requested_active,
                }
                if "project_memberships" in payload:
                    merged["project_memberships"] = payload["project_memberships"]
                configured = apply_user_access(cur, user_id, merged, existing=existing)
                record_audit_event(
                    cur,
                    action="user.update",
                    entity_type="user",
                    entity_key=user_id,
                    details={
                        "email": existing["email"],
                        "before": {
                            "display_name": existing["display_name"],
                            "system_role": existing["system_role"],
                            "active": existing["active"],
                        },
                        "after": configured,
                    },
                )
        return {"status": "updated", "id": user_id}

    @router.get("/audit-events")
    def list_audit_events(
        request: Request,
        limit: int = Query(default=100, ge=1, le=500),
        offset: int = Query(default=0, ge=0),
        action: str = Query(default=""),
        search: str = Query(default=""),
    ):
        conditions = []
        params = []
        if action:
            conditions.append("event.action ILIKE %s")
            params.append(f"{action}%")
        if search:
            conditions.append(
                "(event.entity_key ILIKE %s OR event.entity_type ILIKE %s "
                "OR profile.display_name ILIKE %s OR auth_user.email ILIKE %s "
                "OR event.details::text ILIKE %s)"
            )
            params.extend([f"%{search}%"] * 5)
        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        with get_conn() as conn:
            with conn.cursor() as cur:
                require_admin(cur, request)
                cur.execute(
                    f"""
                    SELECT event.id, event.action, event.entity_type, event.entity_key,
                           event.details, event.created_at, event.request_method,
                           event.request_path, event.actor_user_id::text,
                           COALESCE(profile.display_name, auth_user.email, 'System') AS actor_name,
                           COALESCE(auth_user.email, '') AS actor_email,
                           project.name AS project_name
                    FROM audit_events AS event
                    LEFT JOIN user_profiles AS profile ON profile.user_id=event.actor_user_id
                    LEFT JOIN auth.users AS auth_user ON auth_user.id=event.actor_user_id
                    LEFT JOIN projects AS project ON project.id=event.project_id
                    {where}
                    ORDER BY event.created_at DESC, event.id DESC
                    LIMIT %s OFFSET %s
                    """,
                    params + [limit, offset],
                )
                return [dict(row) for row in cur.fetchall()]

    @router.get("/imports")
    def list_imports(
        request: Request,
        limit: int = Query(default=100, ge=1, le=500),
    ):
        with get_conn() as conn:
            with conn.cursor() as cur:
                require_admin(cur, request)
                cur.execute(
                    """
                    SELECT batch.id::text AS id, batch.filename, batch.import_kind,
                           batch.contractor, batch.client, batch.project, batch.status,
                           batch.row_counts, batch.details, batch.created_at,
                           batch.actor_user_id::text,
                           COALESCE(profile.display_name, auth_user.email, 'System') AS actor_name,
                           COALESCE(auth_user.email, '') AS actor_email
                    FROM import_batches AS batch
                    LEFT JOIN user_profiles AS profile ON profile.user_id=batch.actor_user_id
                    LEFT JOIN auth.users AS auth_user ON auth_user.id=batch.actor_user_id
                    ORDER BY batch.created_at DESC, batch.id DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                batches = [dict(row) for row in cur.fetchall()]
                if len(batches) < limit:
                    remaining = limit - len(batches)
                    cur.execute(
                        """
                        SELECT legacy.id, legacy.filename, legacy.import_kind,
                               legacy.contractor, '' AS client, '' AS project,
                               'imported' AS status, '{}'::jsonb AS row_counts,
                               jsonb_build_object('legacy', TRUE) AS details,
                               legacy.imported_at AS created_at,
                               legacy.imported_by::text AS actor_user_id,
                               COALESCE(profile.display_name, auth_user.email, 'Legacy import') AS actor_name,
                               COALESCE(auth_user.email, '') AS actor_email
                        FROM (
                            SELECT 'source:' || source.id::text AS id,
                                   source.filename,
                                   COALESCE(source.file_type, 'operational_report') AS import_kind,
                                   COALESCE(source.contractor, '') AS contractor,
                                   source.imported_at,
                                   source.imported_by
                            FROM source_files AS source
                            WHERE NOT EXISTS (
                                SELECT 1 FROM import_batches AS batch
                                WHERE batch.filename=source.filename
                                  AND batch.contractor=COALESCE(source.contractor, '')
                            )
                            UNION ALL
                            SELECT 'invoice:' || invoice.filename || ':' || COALESCE(invoice.contractor, ''),
                                   invoice.filename, 'invoice_pdf',
                                   COALESCE(invoice.contractor, ''),
                                   invoice.imported_at, invoice.imported_by
                            FROM invoice_imports AS invoice
                            WHERE NOT EXISTS (
                                SELECT 1 FROM import_batches AS batch
                                WHERE batch.filename=invoice.filename
                                  AND batch.contractor=COALESCE(invoice.contractor, '')
                            )
                        ) AS legacy
                        LEFT JOIN user_profiles AS profile ON profile.user_id=legacy.imported_by
                        LEFT JOIN auth.users AS auth_user ON auth_user.id=legacy.imported_by
                        ORDER BY legacy.imported_at DESC NULLS LAST, legacy.id DESC
                        LIMIT %s
                        """,
                        (remaining,),
                    )
                    batches.extend(dict(row) for row in cur.fetchall())
                return batches

    return router
