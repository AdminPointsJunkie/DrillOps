"""Project-scoped API used by the DrillOps iPhone and iPad app."""

import json
from typing import Callable

from fastapi import APIRouter, HTTPException, Query, Request

from security import current_auth_user


REVIEW_ROLES = {"system_admin", "client_admin", "project_manager", "approver"}
MANAGE_BOREHOLE_ROLES = {"system_admin", "client_admin", "project_manager"}
ROLE_LABELS = {
    "system_admin": "System Administrator",
    "client_admin": "Client Administrator",
    "project_manager": "Project Manager",
    "approver": "Client Approver",
    "contractor_admin": "Contractor Administrator",
    "contractor_supervisor": "Contractor Supervisor",
    "field_user": "Field User",
    "finance": "Finance",
    "auditor": "Auditor",
    "user": "User",
}


def create_mobile_router(get_conn: Callable) -> APIRouter:
    router = APIRouter(prefix="/mobile", tags=["mobile"])

    def profile(cur, user_id: str):
        cur.execute(
            """
            SELECT user_id::text AS id, display_name, system_role, active
            FROM user_profiles WHERE user_id=%s
            """,
            (user_id,),
        )
        row = cur.fetchone()
        if not row or not row["active"]:
            raise HTTPException(403, "Your DrillOps account has not been activated")
        return dict(row)

    def project_context(cur, user_id: str, project_id: int):
        user_profile = profile(cur, user_id)
        cur.execute(
            """
            SELECT p.*, c.name AS client_name, c.code AS client_code
            FROM projects p
            LEFT JOIN clients c ON c.id=p.client_id
            WHERE p.id=%s
            """,
            (project_id,),
        )
        project = cur.fetchone()
        if not project:
            raise HTTPException(404, "Project not found")

        roles = set()
        if user_profile["system_role"] == "system_admin":
            roles.add("system_admin")

        cur.execute(
            """
            SELECT role FROM project_memberships
            WHERE user_id=%s AND project_id=%s AND active=TRUE
            """,
            (user_id, project_id),
        )
        project_roles = {row["role"] for row in cur.fetchall()}
        roles.update(project_roles)
        cur.execute(
            """
            SELECT om.role, po.relationship
            FROM organization_memberships om
            JOIN project_organizations po ON po.organization_id=om.organization_id
            WHERE om.user_id=%s AND po.project_id=%s AND om.active=TRUE
            """,
            (user_id, project_id),
        )
        organization_access = [dict(row) for row in cur.fetchall()]
        roles.update(row["role"] for row in organization_access)
        if not roles:
            raise HTTPException(403, "You do not have access to this project")

        cur.execute(
            """
            SELECT o.contractor_name
            FROM organization_memberships om
            JOIN organizations o ON o.id=om.organization_id AND o.kind='contractor'
            JOIN project_organizations po
              ON po.organization_id=o.id AND po.project_id=%s AND po.relationship='contractor'
            WHERE om.user_id=%s AND om.active=TRUE AND o.active=TRUE
            """,
            (project_id, user_id),
        )
        contractor_names = {row["contractor_name"] for row in cur.fetchall()}
        cur.execute(
            """
            SELECT o.contractor_name
            FROM project_organizations po
            JOIN organizations o ON o.id=po.organization_id AND o.kind='contractor'
            WHERE po.project_id=%s AND po.relationship='contractor' AND o.active=TRUE
            """,
            (project_id,),
        )
        linked_contractor_names = {row["contractor_name"] for row in cur.fetchall()}
        client_access = (
            "system_admin" in roles
            or bool(project_roles)
            or any(row["relationship"] == "client" for row in organization_access)
        )
        return dict(project), roles, contractor_names, client_access, linked_contractor_names

    def permissions_for(roles):
        permissions = {"projects.read", "reports.read", "boreholes.read"}
        if roles & REVIEW_ROLES:
            permissions.update({"reports.review", "reports.lock"})
        if roles & MANAGE_BOREHOLE_ROLES:
            permissions.add("boreholes.manage")
        if roles & {
            "system_admin", "contractor_admin", "contractor_supervisor", "field_user"
        }:
            permissions.update({"reports.create", "reports.submit"})
        if roles & {"system_admin", "contractor_admin", "finance"}:
            permissions.add("billing.manage")
        return sorted(permissions)

    def may_view_all_contractors(client_access):
        return client_access

    def require_contractor(
        client_access, contractor_names, linked_contractor_names, contractor
    ):
        if contractor not in linked_contractor_names:
            raise HTTPException(403, "This contractor is not linked to the project")
        if may_view_all_contractors(client_access):
            return
        if contractor not in contractor_names:
            raise HTTPException(403, "You cannot access this contractor's reports")

    def audit(cur, user_id, project_id, action, entity_type, entity_key, details=None):
        cur.execute(
            """
            INSERT INTO audit_events
              (actor_user_id, project_id, action, entity_type, entity_key, details)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb)
            """,
            (user_id, project_id, action, entity_type, entity_key, json.dumps(details or {})),
        )

    def require_project_report(cur, project_name, key):
        cur.execute(
            """
            SELECT 1 FROM activities
            WHERE contractor=%(contractor)s AND date=%(report_date)s
              AND hole_num=%(hole_num)s AND source_file=%(source_file)s
              AND (
                LOWER(BTRIM(COALESCE(project,'')))=LOWER(BTRIM(%(project_name)s))
                OR hole_num IN (
                    SELECT hole_id FROM boreholes
                    WHERE LOWER(BTRIM(COALESCE(project,'')))=LOWER(BTRIM(%(project_name)s))
                )
              )
            LIMIT 1
            """,
            {**key, "project_name": project_name},
        )
        if not cur.fetchone():
            raise HTTPException(404, "Report not found in this project")

    @router.get("/me")
    def me(request: Request):
        auth = current_auth_user(request)
        with get_conn() as conn:
            with conn.cursor() as cur:
                user_profile = profile(cur, auth.user_id)
                cur.execute(
                    """
                    SELECT role FROM organization_memberships
                    WHERE user_id=%s AND active=TRUE
                    UNION
                    SELECT role FROM project_memberships
                    WHERE user_id=%s AND active=TRUE
                    """,
                    (auth.user_id, auth.user_id),
                )
                roles = {row["role"] for row in cur.fetchall()}
                if user_profile["system_role"] == "system_admin":
                    roles.add("system_admin")
        primary = next(
            (
                role
                for role in (
                    "system_admin", "client_admin", "project_manager", "approver",
                    "contractor_admin", "contractor_supervisor", "field_user", "finance", "auditor"
                )
                if role in roles
            ),
            "user",
        )
        return {
            "id": auth.user_id,
            "name": user_profile["display_name"] or auth.email.split("@")[0],
            "email": auth.email,
            "role": ROLE_LABELS[primary],
            "permissions": [],
        }

    @router.get("/clients")
    def clients(request: Request):
        auth = current_auth_user(request)
        with get_conn() as conn:
            with conn.cursor() as cur:
                user_profile = profile(cur, auth.user_id)
                cur.execute(
                    """
                    SELECT c.*, COUNT(DISTINCT p.id) AS project_count
                    FROM clients c
                    JOIN projects p ON p.client_id=c.id
                    WHERE %s='system_admin'
                       OR EXISTS (
                           SELECT 1 FROM project_memberships pm
                           WHERE pm.user_id=%s AND pm.project_id=p.id AND pm.active=TRUE
                       )
                       OR EXISTS (
                           SELECT 1
                           FROM project_organizations po
                           JOIN organization_memberships om
                             ON om.organization_id=po.organization_id
                           WHERE po.project_id=p.id AND om.user_id=%s AND om.active=TRUE
                       )
                    GROUP BY c.id
                    ORDER BY CASE WHEN c.status='Active' THEN 0 ELSE 1 END, c.name
                    """,
                    (user_profile["system_role"], auth.user_id, auth.user_id),
                )
                return [dict(row) for row in cur.fetchall()]

    @router.get("/projects")
    def projects(request: Request):
        auth = current_auth_user(request)
        with get_conn() as conn:
            with conn.cursor() as cur:
                user_profile = profile(cur, auth.user_id)
                cur.execute(
                    """
                    SELECT p.*, c.name AS client_name, c.code AS client_code
                    FROM projects p
                    LEFT JOIN clients c ON c.id=p.client_id
                    WHERE %s='system_admin'
                       OR EXISTS (
                           SELECT 1 FROM project_memberships pm
                           WHERE pm.user_id=%s AND pm.project_id=p.id AND pm.active=TRUE
                       )
                       OR EXISTS (
                           SELECT 1
                           FROM project_organizations po
                           JOIN organization_memberships om
                             ON om.organization_id=po.organization_id
                           WHERE po.project_id=p.id AND om.user_id=%s AND om.active=TRUE
                       )
                    ORDER BY COALESCE(c.name, ''), p.program, p.name, p.year
                    """,
                    (user_profile["system_role"], auth.user_id, auth.user_id),
                )
                return [dict(row) for row in cur.fetchall()]

    @router.get("/projects/{project_id}/permissions")
    def project_permissions(project_id: int, request: Request):
        auth = current_auth_user(request)
        with get_conn() as conn:
            with conn.cursor() as cur:
                _, roles, _, _, _ = project_context(cur, auth.user_id, project_id)
        return {"permissions": permissions_for(roles)}

    @router.get("/projects/{project_id}/contractors")
    def project_contractors(project_id: int, request: Request):
        auth = current_auth_user(request)
        with get_conn() as conn:
            with conn.cursor() as cur:
                _, roles, contractor_names, client_access, _ = project_context(
                    cur, auth.user_id, project_id
                )
                cur.execute(
                    """
                    SELECT o.contractor_name AS contractor,
                           COALESCE(c.category, '') AS category,
                           (
                             SELECT COUNT(*) FROM activities a
                             JOIN projects p ON p.id=%s
                             WHERE a.contractor=o.contractor_name
                               AND LOWER(BTRIM(COALESCE(a.project,'')))=LOWER(BTRIM(p.name))
                           ) AS usage_count
                    FROM project_organizations po
                    JOIN organizations o ON o.id=po.organization_id AND o.kind='contractor'
                    LEFT JOIN contractors c ON c.name=o.contractor_name
                    WHERE po.project_id=%s AND po.relationship='contractor' AND o.active=TRUE
                    ORDER BY CASE WHEN COALESCE(c.category,'')='Drilling' THEN 0 ELSE 1 END,
                             o.contractor_name
                    """,
                    (project_id, project_id),
                )
                rows = [dict(row) for row in cur.fetchall()]
        if may_view_all_contractors(client_access):
            return rows
        return [row for row in rows if row["contractor"] in contractor_names]

    @router.get("/projects/{project_id}/activity-report-data")
    def activity_report_data(
        project_id: int, request: Request, contractor: str = Query(...)
    ):
        auth = current_auth_user(request)
        with get_conn() as conn:
            with conn.cursor() as cur:
                project, roles, contractor_names, client_access, linked_contractors = project_context(
                    cur, auth.user_id, project_id
                )
                require_contractor(
                    client_access, contractor_names, linked_contractors, contractor
                )
                cur.execute(
                    """
                    SELECT a.* FROM activities a
                    WHERE a.contractor=%s
                      AND (
                        LOWER(BTRIM(COALESCE(a.project,'')))=LOWER(BTRIM(%s))
                        OR a.hole_num IN (
                            SELECT b.hole_id FROM boreholes b
                            WHERE LOWER(BTRIM(COALESCE(b.project,'')))=LOWER(BTRIM(%s))
                        )
                      )
                    ORDER BY a.date, a.time_from, a.id
                    """,
                    (contractor, project["name"], project["name"]),
                )
                activities = [dict(row) for row in cur.fetchall()]
                keys = {
                    (
                        row.get("date") or "", row.get("hole_num") or "",
                        row.get("source_file") or ""
                    )
                    for row in activities
                }
                cur.execute(
                    "SELECT * FROM report_approvals WHERE contractor=%s ORDER BY updated_at DESC",
                    (contractor,),
                )
                approvals = [
                    {**dict(row), "reason": row.get("reason") or ""}
                    for row in cur.fetchall()
                    if (row.get("report_date") or "", row.get("hole_num") or "", row.get("source_file") or "") in keys
                ]
                cur.execute(
                    "SELECT * FROM activity_sheet_locks WHERE contractor=%s ORDER BY updated_at DESC",
                    (contractor,),
                )
                locks = [
                    {**dict(row), "reason": row.get("reason") or ""}
                    for row in cur.fetchall()
                    if (row.get("report_date") or "", row.get("hole_num") or "", row.get("source_file") or "") in keys
                ]
        return {
            "activities": activities,
            "report_approvals": approvals,
            "activity_sheet_locks": locks,
        }

    @router.get("/projects/{project_id}/boreholes")
    def boreholes(project_id: int, request: Request):
        auth = current_auth_user(request)
        with get_conn() as conn:
            with conn.cursor() as cur:
                project, _, _, _, _ = project_context(cur, auth.user_id, project_id)
                cur.execute(
                    """
                    SELECT b.*,
                           COALESCE(SUM(a.line_cost), 0) AS eos_cost,
                           COALESCE(SUM(CASE WHEN a.code LIKE 'Drill_%%'
                               THEN a.total_metres ELSE 0 END), 0) AS drilling_metres
                    FROM boreholes b
                    LEFT JOIN activities a ON (
                        a.hole_num=b.hole_id
                        OR (COALESCE(b.site_id,'')<>'' AND a.site_name=b.site_id)
                    ) AND LOWER(BTRIM(COALESCE(a.project,'')))=LOWER(BTRIM(%s))
                    WHERE LOWER(BTRIM(COALESCE(b.project,'')))=LOWER(BTRIM(%s))
                    GROUP BY b.id
                    ORDER BY b.drill_order
                    """,
                    (project["name"], project["name"]),
                )
                return [dict(row) for row in cur.fetchall()]

    @router.post("/projects/{project_id}/report-approvals")
    async def save_report_approval(project_id: int, request: Request):
        auth = current_auth_user(request)
        payload = await request.json()
        contractor = str(payload.get("contractor") or "").strip()
        status = str(payload.get("status") or "").strip().lower()
        reason = str(payload.get("reason") or "").strip()
        if status not in {"approved", "query", "rejected"}:
            raise HTTPException(400, "status must be approved, query, or rejected")
        if status in {"query", "rejected"} and not reason:
            raise HTTPException(400, "A reason is required for query or rejection")
        key = {
            "contractor": contractor,
            "report_date": str(payload.get("date") or ""),
            "hole_num": str(payload.get("hole") or ""),
            "source_file": str(payload.get("source") or ""),
        }
        with get_conn() as conn:
            with conn.cursor() as cur:
                project, roles, contractor_names, client_access, linked_contractors = project_context(
                    cur, auth.user_id, project_id
                )
                if not roles & REVIEW_ROLES:
                    raise HTTPException(403, "Report review permission is required")
                require_contractor(
                    client_access, contractor_names, linked_contractors, contractor
                )
                require_project_report(cur, project["name"], key)
                log_entry = {"status": status, "reason": reason, "by": auth.email}
                cur.execute(
                    """
                    INSERT INTO report_approvals
                      (contractor, report_date, hole_num, source_file, status, reason, log, updated_at)
                    VALUES (%(contractor)s, %(report_date)s, %(hole_num)s, %(source_file)s,
                            %(status)s, %(reason)s, %(log)s::jsonb, NOW())
                    ON CONFLICT (contractor, report_date, hole_num, source_file)
                    DO UPDATE SET status=EXCLUDED.status, reason=EXCLUDED.reason,
                                  log=EXCLUDED.log || report_approvals.log, updated_at=NOW()
                    RETURNING *
                    """,
                    {**key, "status": status, "reason": reason, "log": json.dumps([log_entry])},
                )
                saved = dict(cur.fetchone())
                if status == "approved" and bool(payload.get("lock_on_approval", False)):
                    cur.execute(
                        """
                        INSERT INTO activity_sheet_locks
                          (contractor, report_date, hole_num, source_file, locked, reason, updated_at)
                        VALUES (%(contractor)s, %(report_date)s, %(hole_num)s, %(source_file)s,
                                TRUE, 'Locked on client approval', NOW())
                        ON CONFLICT (contractor, report_date, hole_num, source_file)
                        DO UPDATE SET locked=TRUE, reason=EXCLUDED.reason, updated_at=NOW()
                        """,
                        key,
                    )
                audit(cur, auth.user_id, project_id, f"report.{status}", "daily_report", "|".join(key.values()), {"reason": reason})
        return {**saved, "reason": saved.get("reason") or ""}

    @router.post("/projects/{project_id}/activity-sheet-locks")
    async def save_activity_lock(project_id: int, request: Request):
        auth = current_auth_user(request)
        payload = await request.json()
        contractor = str(payload.get("contractor") or "").strip()
        key = {
            "contractor": contractor,
            "report_date": str(payload.get("date") or ""),
            "hole_num": str(payload.get("hole") or ""),
            "source_file": str(payload.get("source") or ""),
        }
        locked = bool(payload.get("locked", True))
        reason = str(payload.get("reason") or "").strip()
        with get_conn() as conn:
            with conn.cursor() as cur:
                project, roles, contractor_names, client_access, linked_contractors = project_context(
                    cur, auth.user_id, project_id
                )
                if not roles & REVIEW_ROLES:
                    raise HTTPException(403, "Report lock permission is required")
                require_contractor(
                    client_access, contractor_names, linked_contractors, contractor
                )
                require_project_report(cur, project["name"], key)
                cur.execute(
                    """
                    INSERT INTO activity_sheet_locks
                      (contractor, report_date, hole_num, source_file, locked, reason, updated_at)
                    VALUES (%(contractor)s, %(report_date)s, %(hole_num)s, %(source_file)s,
                            %(locked)s, %(reason)s, NOW())
                    ON CONFLICT (contractor, report_date, hole_num, source_file)
                    DO UPDATE SET locked=EXCLUDED.locked, reason=EXCLUDED.reason, updated_at=NOW()
                    RETURNING *
                    """,
                    {**key, "locked": locked, "reason": reason},
                )
                saved = dict(cur.fetchone())
                audit(cur, auth.user_id, project_id, "report.lock" if locked else "report.unlock", "daily_report", "|".join(key.values()), {"reason": reason})
        return {**saved, "reason": saved.get("reason") or ""}

    @router.patch("/projects/{project_id}/boreholes/{hole_id}")
    async def update_borehole(project_id: int, hole_id: str, request: Request):
        auth = current_auth_user(request)
        payload = await request.json()
        status = str(payload.get("status") or "").strip()
        if status not in {"Planned", "In Progress", "Complete", "Cancelled"}:
            raise HTTPException(400, "Invalid borehole status")
        with get_conn() as conn:
            with conn.cursor() as cur:
                project, roles, _, _, _ = project_context(cur, auth.user_id, project_id)
                if not roles & MANAGE_BOREHOLE_ROLES:
                    raise HTTPException(403, "Borehole management permission is required")
                cur.execute(
                    """
                    UPDATE boreholes SET status=%s
                    WHERE hole_id=%s
                      AND LOWER(BTRIM(COALESCE(project,'')))=LOWER(BTRIM(%s))
                    """,
                    (status, hole_id, project["name"]),
                )
                if cur.rowcount == 0:
                    raise HTTPException(404, "Borehole not found in this project")
                audit(cur, auth.user_id, project_id, "borehole.status", "borehole", hole_id, {"status": status})
        return {"status": "updated"}

    return router
