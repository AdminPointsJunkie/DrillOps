"""Project-scoped API used by the DrillOps iPhone and iPad app."""

import json
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Callable

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request

from dar_workflow import (
    deliver_pending_emails,
    email_delivery_provider,
    queue_notifications,
)
from security import current_auth_user


REVIEW_ROLES = {"system_admin", "client_admin", "project_manager", "approver"}
MANAGE_BOREHOLE_ROLES = {"system_admin", "client_admin", "project_manager"}
CREATE_DAR_ROLES = {
    "system_admin", "contractor_admin", "contractor_supervisor", "field_user"
}
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
        permissions = {
            "projects.read", "reports.read", "boreholes.read", "notifications.read"
        }
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

    def number(value, field: str, minimum=0, maximum=None):
        try:
            parsed = Decimal(str(value if value not in (None, "") else 0))
        except (InvalidOperation, ValueError):
            raise HTTPException(400, f"{field} must be a number")
        if parsed < minimum or (maximum is not None and parsed > maximum):
            upper = f" and no more than {maximum}" if maximum is not None else ""
            raise HTTPException(400, f"{field} must be at least {minimum}{upper}")
        return parsed

    def json_lines(value, field: str, limit: int):
        if value is None:
            return []
        if not isinstance(value, list):
            raise HTTPException(400, f"{field} must be a list")
        if len(value) > limit:
            raise HTTPException(400, f"{field} can contain at most {limit} entries")
        return [dict(item) for item in value if isinstance(item, dict)]

    def dar_payload(payload: dict, existing=None):
        existing = existing or {}

        def text(name, fallback=""):
            return str(payload.get(name, existing.get(name, fallback)) or "").strip()

        report_date = text("report_date", str(date.today()))
        try:
            date.fromisoformat(report_date)
        except ValueError:
            raise HTTPException(400, "report_date must use YYYY-MM-DD")
        shift = text("shift", "Day").title()
        if shift not in {"Day", "Night"}:
            raise HTTPException(400, "shift must be Day or Night")
        start = number(payload.get("metres_start", existing.get("metres_start", 0)), "metres_start")
        end = number(payload.get("metres_end", existing.get("metres_end", 0)), "metres_end")
        total = number(payload.get("total_metres", existing.get("total_metres", 0)), "total_metres")
        operating = number(
            payload.get("operating_hours", existing.get("operating_hours", 0)),
            "operating_hours", maximum=24,
        )
        downtime = number(
            payload.get("downtime_hours", existing.get("downtime_hours", 0)),
            "downtime_hours", maximum=24,
        )
        if operating + downtime > 24:
            raise HTTPException(400, "Operating and downtime hours cannot exceed 24 in total")
        if end and end < start:
            raise HTTPException(400, "metres_end cannot be less than metres_start")
        if total == 0 and end >= start:
            total = end - start
        return {
            "contractor": text("contractor"),
            "report_date": report_date,
            "shift": shift,
            "hole_id": text("hole_id"),
            "site_name": text("site_name"),
            "rig_id": text("rig_id"),
            "supervisor_name": text("supervisor_name"),
            "driller_name": text("driller_name"),
            "weather": text("weather"),
            "metres_start": start,
            "metres_end": end,
            "total_metres": total,
            "operating_hours": operating,
            "downtime_hours": downtime,
            "safety_summary": text("safety_summary"),
            "has_safety_incident": bool(
                payload.get("has_safety_incident", existing.get("has_safety_incident", False))
            ),
            "delay_summary": text("delay_summary"),
            "geology_summary": text("geology_summary"),
            "notes": text("notes"),
            "activities": json_lines(
                payload.get("activities", existing.get("activities", [])), "activities", 48
            ),
            "crew": json_lines(payload.get("crew", existing.get("crew", [])), "crew", 40),
            "consumables": json_lines(
                payload.get("consumables", existing.get("consumables", [])),
                "consumables", 60,
            ),
        }

    def validate_submission(values):
        required = {
            "contractor": "Contractor",
            "hole_id": "Hole",
            "rig_id": "Rig",
            "supervisor_name": "Supervisor",
            "driller_name": "Driller",
        }
        missing = [label for key, label in required.items() if not values[key]]
        if missing:
            raise HTTPException(400, f"Complete these DAR fields: {', '.join(missing)}")
        if not values["activities"]:
            raise HTTPException(400, "Add at least one activity line before submitting")
        if values["has_safety_incident"] and not values["safety_summary"]:
            raise HTTPException(400, "Add the safety incident details before submitting")
        for index, activity in enumerate(values["activities"], start=1):
            if not str(activity.get("code") or "").strip():
                raise HTTPException(400, f"Activity {index} requires an activity code")

    def get_dar(cur, project_id: int, dar_id: str):
        cur.execute(
            """
            SELECT dar.*, creator.display_name AS created_by_name,
                   reviewer.display_name AS reviewed_by_name
            FROM daily_activity_reports dar
            LEFT JOIN user_profiles creator ON creator.user_id=dar.created_by
            LEFT JOIN user_profiles reviewer ON reviewer.user_id=dar.reviewed_by
            WHERE dar.id=%s AND dar.project_id=%s
            """,
            (dar_id, project_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "DAR not found in this project")
        return dict(row)

    def require_dar_contractor_access(
        client_access, contractor_names, linked_contractors, dar
    ):
        require_contractor(
            client_access, contractor_names, linked_contractors, dar["contractor"]
        )

    def approver_recipients(cur, project_id: int):
        cur.execute(
            """
            SELECT DISTINCT auth_user.id::text AS user_id, auth_user.email
            FROM auth.users auth_user
            JOIN user_profiles profile ON profile.user_id=auth_user.id AND profile.active=TRUE
            WHERE profile.system_role='system_admin'
               OR EXISTS (
                   SELECT 1 FROM project_memberships membership
                   WHERE membership.user_id=auth_user.id AND membership.project_id=%s
                     AND membership.active=TRUE
                     AND membership.role IN ('project_manager', 'approver')
               )
               OR EXISTS (
                   SELECT 1
                   FROM organization_memberships membership
                   JOIN project_organizations project_org
                     ON project_org.organization_id=membership.organization_id
                   WHERE membership.user_id=auth_user.id AND membership.active=TRUE
                     AND project_org.project_id=%s AND project_org.relationship='client'
                     AND membership.role IN ('client_admin', 'project_manager', 'approver')
               )
            """,
            (project_id, project_id),
        )
        return [dict(row) for row in cur.fetchall()]

    def contractor_recipients(cur, project_id: int, contractor: str, submitted_by):
        cur.execute(
            """
            SELECT DISTINCT auth_user.id::text AS user_id, auth_user.email
            FROM auth.users auth_user
            JOIN user_profiles profile ON profile.user_id=auth_user.id AND profile.active=TRUE
            WHERE auth_user.id=%s
               OR EXISTS (
                   SELECT 1
                   FROM organization_memberships membership
                   JOIN organizations organization
                     ON organization.id=membership.organization_id
                    AND organization.kind='contractor'
                   JOIN project_organizations project_org
                     ON project_org.organization_id=organization.id
                    AND project_org.project_id=%s
                   WHERE membership.user_id=auth_user.id AND membership.active=TRUE
                     AND organization.contractor_name=%s
               )
               OR EXISTS (
                   SELECT 1 FROM project_memberships membership
                   WHERE membership.user_id=auth_user.id AND membership.project_id=%s
                     AND membership.active=TRUE
                     AND membership.role IN ('contractor_supervisor', 'field_user')
               )
            """,
            (submitted_by, project_id, contractor, project_id),
        )
        return [dict(row) for row in cur.fetchall()]

    def add_dar_event(
        cur, dar_id, project_id, user_id, event_type, from_status, to_status,
        note="", details=None,
    ):
        cur.execute(
            """
            INSERT INTO dar_events
              (dar_id, project_id, actor_user_id, event_type, from_status,
               to_status, note, details)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                dar_id, project_id, user_id, event_type, from_status, to_status,
                note, json.dumps(details or {}),
            ),
        )

    def materialize_approved_dar(cur, project: dict, dar: dict):
        """Replace dashboard activity/crew/consumable rows for an approved DAR."""
        source_file = f"DAR-{dar['id']}"
        cur.execute("DELETE FROM activities WHERE dar_id=%s", (dar["id"],))
        cur.execute("DELETE FROM crew WHERE dar_id=%s", (dar["id"],))
        cur.execute("DELETE FROM consumables WHERE dar_id=%s", (dar["id"],))
        client_name = project.get("client_name") or ""
        for index, line in enumerate(dar.get("activities") or []):
            line_hours = number(line.get("hours", 0), f"Activity {index + 1} hours", maximum=24)
            line_metres = number(line.get("metres", 0), f"Activity {index + 1} metres")
            metres_from = number(line.get("metres_from", 0), "metres_from")
            metres_to = number(line.get("metres_to", 0), "metres_to")
            if line_metres == 0 and metres_to >= metres_from:
                line_metres = metres_to - metres_from
            cur.execute(
                """
                INSERT INTO activities
                  (source_file, contractor, date, hole_num, site_name, program,
                   project, drill_rig, client, shift, time_from, time_to,
                   total_time, metres_from, metres_to, total_metres, code,
                   notes, quantity, line_cost, rate_basis, dar_id, dar_line_index)
                VALUES
                  (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                   %s, %s, %s, %s, %s, %s, %s, 0, 'approved_dar', %s, %s)
                """,
                (
                    source_file,
                    dar["contractor"],
                    str(dar["report_date"]),
                    dar["hole_id"],
                    dar["site_name"],
                    project.get("program") or "",
                    project.get("name") or "",
                    dar["rig_id"],
                    client_name,
                    dar["shift"],
                    str(line.get("time_from") or ""),
                    str(line.get("time_to") or ""),
                    str(line_hours),
                    metres_from,
                    metres_to,
                    line_metres,
                    str(line.get("code") or "").strip(),
                    str(line.get("notes") or "").strip(),
                    line_metres if line_metres else line_hours,
                    dar["id"],
                    index,
                ),
            )
        for index, member in enumerate(dar.get("crew") or []):
            cur.execute(
                """
                INSERT INTO crew
                  (source_file, contractor, date, hole_num, site_name,
                   role, name, hours, dar_id, dar_line_index)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    source_file, dar["contractor"], str(dar["report_date"]),
                    dar["hole_id"], dar["site_name"],
                    str(member.get("role") or ""), str(member.get("name") or ""),
                    str(member.get("hours") or ""), dar["id"], index,
                ),
            )
        for index, item in enumerate(dar.get("consumables") or []):
            cur.execute(
                """
                INSERT INTO consumables
                  (source_file, contractor, date, hole_num, site_name,
                   consumable, type, quantity, unit, unit_price, line_cost,
                   dar_id, dar_line_index)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 0, 0, %s, %s)
                """,
                (
                    source_file, dar["contractor"], str(dar["report_date"]),
                    dar["hole_id"], dar["site_name"],
                    str(item.get("name") or item.get("consumable") or ""),
                    str(item.get("type") or ""), str(item.get("quantity") or ""),
                    str(item.get("unit") or ""), dar["id"], index,
                ),
            )

        approval_key = {
            "contractor": dar["contractor"],
            "report_date": str(dar["report_date"]),
            "hole_num": dar["hole_id"],
            "source_file": source_file,
            "reason": dar.get("review_reason") or "Approved from native DAR workflow",
        }
        cur.execute(
            """
            INSERT INTO report_approvals
              (contractor, report_date, hole_num, source_file, status, reason, log, updated_at)
            VALUES
              (%(contractor)s, %(report_date)s, %(hole_num)s, %(source_file)s,
               'approved', %(reason)s, '[]'::jsonb, NOW())
            ON CONFLICT (contractor, report_date, hole_num, source_file)
            DO UPDATE SET status='approved', reason=EXCLUDED.reason, updated_at=NOW()
            """,
            approval_key,
        )
        cur.execute(
            """
            INSERT INTO activity_sheet_locks
              (contractor, report_date, hole_num, source_file, locked, reason, updated_at)
            VALUES
              (%(contractor)s, %(report_date)s, %(hole_num)s, %(source_file)s,
               TRUE, 'Locked on DAR approval', NOW())
            ON CONFLICT (contractor, report_date, hole_num, source_file)
            DO UPDATE SET locked=TRUE, reason=EXCLUDED.reason, updated_at=NOW()
            """,
            approval_key,
        )

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

    @router.get("/projects/{project_id}/dars")
    def daily_activity_reports(
        project_id: int, request: Request, status: str = Query("")
    ):
        auth = current_auth_user(request)
        normalized_status = status.strip().lower()
        valid_statuses = {"draft", "submitted", "approved", "query", "rejected", "withdrawn"}
        if normalized_status and normalized_status not in valid_statuses:
            raise HTTPException(400, "Invalid DAR status filter")
        with get_conn() as conn:
            with conn.cursor() as cur:
                _, _, contractor_names, client_access, _ = project_context(
                    cur, auth.user_id, project_id
                )
                conditions = ["dar.project_id=%s"]
                params = [project_id]
                if not client_access:
                    if not contractor_names:
                        return []
                    conditions.append("dar.contractor = ANY(%s)")
                    params.append(list(contractor_names))
                if normalized_status:
                    conditions.append("dar.status=%s")
                    params.append(normalized_status)
                cur.execute(
                    f"""
                    SELECT dar.*, creator.display_name AS created_by_name,
                           reviewer.display_name AS reviewed_by_name
                    FROM daily_activity_reports dar
                    LEFT JOIN user_profiles creator ON creator.user_id=dar.created_by
                    LEFT JOIN user_profiles reviewer ON reviewer.user_id=dar.reviewed_by
                    WHERE {' AND '.join(conditions)}
                    ORDER BY dar.report_date DESC, dar.created_at DESC
                    """,
                    params,
                )
                return [dict(row) for row in cur.fetchall()]

    @router.get("/projects/{project_id}/dars/{dar_id}")
    def daily_activity_report(project_id: int, dar_id: str, request: Request):
        auth = current_auth_user(request)
        with get_conn() as conn:
            with conn.cursor() as cur:
                _, _, contractor_names, client_access, linked_contractors = project_context(
                    cur, auth.user_id, project_id
                )
                dar = get_dar(cur, project_id, dar_id)
                require_dar_contractor_access(
                    client_access, contractor_names, linked_contractors, dar
                )
                cur.execute(
                    """
                    SELECT event.*, profile.display_name AS actor_name
                    FROM dar_events event
                    LEFT JOIN user_profiles profile ON profile.user_id=event.actor_user_id
                    WHERE event.dar_id=%s
                    ORDER BY event.created_at
                    """,
                    (dar_id,),
                )
                events = [dict(row) for row in cur.fetchall()]
        return {"dar": dar, "events": events}

    @router.post("/projects/{project_id}/dars")
    async def create_daily_activity_report(project_id: int, request: Request):
        auth = current_auth_user(request)
        payload = await request.json()
        values = dar_payload(payload)
        with get_conn() as conn:
            with conn.cursor() as cur:
                _, roles, contractor_names, client_access, linked_contractors = project_context(
                    cur, auth.user_id, project_id
                )
                if not roles & CREATE_DAR_ROLES:
                    raise HTTPException(403, "DAR creation permission is required")
                require_contractor(
                    client_access, contractor_names, linked_contractors, values["contractor"]
                )
                cur.execute(
                    """
                    INSERT INTO daily_activity_reports
                      (project_id, contractor, report_date, shift, hole_id, site_name,
                       rig_id, supervisor_name, driller_name, weather, metres_start,
                       metres_end, total_metres, operating_hours, downtime_hours,
                       safety_summary, has_safety_incident, delay_summary,
                       geology_summary, notes, activities, crew, consumables,
                       created_by, updated_by)
                    VALUES
                      (%(project_id)s, %(contractor)s, %(report_date)s, %(shift)s,
                       %(hole_id)s, %(site_name)s, %(rig_id)s, %(supervisor_name)s,
                       %(driller_name)s, %(weather)s, %(metres_start)s,
                       %(metres_end)s, %(total_metres)s, %(operating_hours)s,
                       %(downtime_hours)s, %(safety_summary)s,
                       %(has_safety_incident)s, %(delay_summary)s,
                       %(geology_summary)s, %(notes)s, %(activities)s::jsonb,
                       %(crew)s::jsonb, %(consumables)s::jsonb,
                       %(user_id)s, %(user_id)s)
                    RETURNING id
                    """,
                    {
                        **values,
                        "project_id": project_id,
                        "user_id": auth.user_id,
                        "activities": json.dumps(values["activities"]),
                        "crew": json.dumps(values["crew"]),
                        "consumables": json.dumps(values["consumables"]),
                    },
                )
                dar_id = str(cur.fetchone()["id"])
                add_dar_event(
                    cur, dar_id, project_id, auth.user_id, "dar.created", None, "draft"
                )
                audit(
                    cur, auth.user_id, project_id, "dar.create", "daily_activity_report",
                    dar_id, {"contractor": values["contractor"]},
                )
                saved = get_dar(cur, project_id, dar_id)
        return saved

    @router.patch("/projects/{project_id}/dars/{dar_id}")
    async def update_daily_activity_report(
        project_id: int, dar_id: str, request: Request
    ):
        auth = current_auth_user(request)
        payload = await request.json()
        with get_conn() as conn:
            with conn.cursor() as cur:
                _, roles, contractor_names, client_access, linked_contractors = project_context(
                    cur, auth.user_id, project_id
                )
                if not roles & CREATE_DAR_ROLES:
                    raise HTTPException(403, "DAR editing permission is required")
                current = get_dar(cur, project_id, dar_id)
                require_dar_contractor_access(
                    client_access, contractor_names, linked_contractors, current
                )
                if current["status"] not in {"draft", "query", "rejected"}:
                    raise HTTPException(409, "Only draft, queried, or rejected DARs can be edited")
                values = dar_payload(payload, current)
                require_contractor(
                    client_access, contractor_names, linked_contractors, values["contractor"]
                )
                # Preserve query/rejected until submission so the next submission
                # increments the revision and creates a new notification event.
                next_status = current["status"]
                cur.execute(
                    """
                    UPDATE daily_activity_reports
                    SET contractor=%(contractor)s, report_date=%(report_date)s,
                        shift=%(shift)s, hole_id=%(hole_id)s, site_name=%(site_name)s,
                        rig_id=%(rig_id)s, supervisor_name=%(supervisor_name)s,
                        driller_name=%(driller_name)s, weather=%(weather)s,
                        metres_start=%(metres_start)s, metres_end=%(metres_end)s,
                        total_metres=%(total_metres)s,
                        operating_hours=%(operating_hours)s,
                        downtime_hours=%(downtime_hours)s,
                        safety_summary=%(safety_summary)s,
                        has_safety_incident=%(has_safety_incident)s,
                        delay_summary=%(delay_summary)s,
                        geology_summary=%(geology_summary)s, notes=%(notes)s,
                        activities=%(activities)s::jsonb, crew=%(crew)s::jsonb,
                        consumables=%(consumables)s::jsonb, status=%(status)s,
                        updated_by=%(user_id)s, updated_at=NOW()
                    WHERE id=%(dar_id)s AND project_id=%(project_id)s
                    """,
                    {
                        **values,
                        "activities": json.dumps(values["activities"]),
                        "crew": json.dumps(values["crew"]),
                        "consumables": json.dumps(values["consumables"]),
                        "status": next_status,
                        "user_id": auth.user_id,
                        "dar_id": dar_id,
                        "project_id": project_id,
                    },
                )
                add_dar_event(
                    cur, dar_id, project_id, auth.user_id, "dar.updated",
                    current["status"], next_status,
                )
                audit(
                    cur, auth.user_id, project_id, "dar.update", "daily_activity_report",
                    dar_id,
                )
                saved = get_dar(cur, project_id, dar_id)
        return saved

    @router.post("/projects/{project_id}/dars/{dar_id}/submit")
    async def submit_daily_activity_report(
        project_id: int, dar_id: str, request: Request,
        background_tasks: BackgroundTasks,
    ):
        auth = current_auth_user(request)
        with get_conn() as conn:
            with conn.cursor() as cur:
                project, roles, contractor_names, client_access, linked_contractors = project_context(
                    cur, auth.user_id, project_id
                )
                if not roles & CREATE_DAR_ROLES:
                    raise HTTPException(403, "DAR submission permission is required")
                current = get_dar(cur, project_id, dar_id)
                require_dar_contractor_access(
                    client_access, contractor_names, linked_contractors, current
                )
                if current["status"] not in {"draft", "query", "rejected"}:
                    raise HTTPException(409, "This DAR cannot be submitted in its current state")
                values = dar_payload({}, current)
                validate_submission(values)
                revision = int(current["revision"]) + (
                    1 if current["status"] in {"query", "rejected"} else 0
                )
                cur.execute(
                    """
                    UPDATE daily_activity_reports
                    SET status='submitted', revision=%s, submitted_by=%s,
                        submitted_at=NOW(), reviewed_by=NULL, reviewed_at=NULL,
                        review_reason='', updated_by=%s, updated_at=NOW()
                    WHERE id=%s AND project_id=%s
                    """,
                    (revision, auth.user_id, auth.user_id, dar_id, project_id),
                )
                add_dar_event(
                    cur, dar_id, project_id, auth.user_id, "dar.submitted",
                    current["status"], "submitted", details={"revision": revision},
                )
                title = f"DAR ready for review · {project['name']}"
                body = (
                    f"{current['contractor']} submitted the {current['shift']} shift DAR "
                    f"for {current['hole_id']} on {current['report_date']}."
                )
                queue_notifications(
                    cur, approver_recipients(cur, project_id), project_id=project_id,
                    dar_id=dar_id, event_type="dar.submitted", event_version=revision,
                    title=title, body=body,
                )
                audit(
                    cur, auth.user_id, project_id, "dar.submit", "daily_activity_report",
                    dar_id, {"revision": revision},
                )
                saved = get_dar(cur, project_id, dar_id)
        background_tasks.add_task(deliver_pending_emails, get_conn)
        return saved

    @router.post("/projects/{project_id}/dars/{dar_id}/review")
    async def review_daily_activity_report(
        project_id: int, dar_id: str, request: Request,
        background_tasks: BackgroundTasks,
    ):
        auth = current_auth_user(request)
        payload = await request.json()
        decision = str(payload.get("status") or "").strip().lower()
        reason = str(payload.get("reason") or "").strip()
        if decision not in {"approved", "query", "rejected"}:
            raise HTTPException(400, "status must be approved, query, or rejected")
        if decision in {"query", "rejected"} and not reason:
            raise HTTPException(400, "A reason is required for a query or rejection")
        with get_conn() as conn:
            with conn.cursor() as cur:
                project, roles, contractor_names, client_access, linked_contractors = project_context(
                    cur, auth.user_id, project_id
                )
                if not roles & REVIEW_ROLES:
                    raise HTTPException(403, "DAR review permission is required")
                current = get_dar(cur, project_id, dar_id)
                require_dar_contractor_access(
                    client_access, contractor_names, linked_contractors, current
                )
                if current["status"] != "submitted":
                    raise HTTPException(409, "Only submitted DARs can be reviewed")
                cur.execute(
                    """
                    UPDATE daily_activity_reports
                    SET status=%s, review_reason=%s, reviewed_by=%s,
                        reviewed_at=NOW(), updated_by=%s, updated_at=NOW()
                    WHERE id=%s AND project_id=%s
                    """,
                    (decision, reason, auth.user_id, auth.user_id, dar_id, project_id),
                )
                updated = get_dar(cur, project_id, dar_id)
                if decision == "approved":
                    materialize_approved_dar(cur, project, updated)
                add_dar_event(
                    cur, dar_id, project_id, auth.user_id, f"dar.{decision}",
                    "submitted", decision, note=reason,
                    details={"revision": current["revision"]},
                )
                label = {"approved": "approved", "query": "queried", "rejected": "rejected"}[decision]
                title = f"DAR {label} · {project['name']}"
                body = (
                    f"The {current['shift']} shift DAR for {current['hole_id']} on "
                    f"{current['report_date']} was {label}."
                )
                if reason:
                    body += f" Review note: {reason}"
                queue_notifications(
                    cur,
                    contractor_recipients(
                        cur, project_id, current["contractor"], current["submitted_by"]
                    ),
                    project_id=project_id, dar_id=dar_id,
                    event_type=f"dar.{decision}",
                    event_version=int(current["revision"]), title=title, body=body,
                )
                audit(
                    cur, auth.user_id, project_id, f"dar.{decision}",
                    "daily_activity_report", dar_id,
                    {"reason": reason, "revision": current["revision"]},
                )
                saved = get_dar(cur, project_id, dar_id)
        background_tasks.add_task(deliver_pending_emails, get_conn)
        return saved

    @router.get("/notifications")
    def notifications(
        request: Request, background_tasks: BackgroundTasks,
        project_id: int | None = Query(None),
    ):
        auth = current_auth_user(request)
        with get_conn() as conn:
            with conn.cursor() as cur:
                profile(cur, auth.user_id)
                params = [auth.user_id]
                project_filter = ""
                if project_id is not None:
                    project_context(cur, auth.user_id, project_id)
                    project_filter = "AND notification.project_id=%s"
                    params.append(project_id)
                cur.execute(
                    f"""
                    SELECT notification.*, project.name AS project_name,
                           dar.status AS dar_status
                    FROM user_notifications notification
                    JOIN projects project ON project.id=notification.project_id
                    LEFT JOIN daily_activity_reports dar ON dar.id=notification.dar_id
                    WHERE notification.user_id=%s {project_filter}
                    ORDER BY notification.created_at DESC
                    LIMIT 100
                    """,
                    params,
                )
                items = [dict(row) for row in cur.fetchall()]
                cur.execute(
                    f"""
                    SELECT COUNT(*) AS count FROM user_notifications notification
                    WHERE notification.user_id=%s AND notification.read_at IS NULL
                    {project_filter}
                    """,
                    params,
                )
                unread = int(cur.fetchone()["count"])
        background_tasks.add_task(deliver_pending_emails, get_conn)
        return {
            "items": items,
            "unread_count": unread,
            "email_delivery": email_delivery_provider(),
        }

    @router.patch("/notifications/{notification_id}")
    async def mark_notification(
        notification_id: str, request: Request
    ):
        auth = current_auth_user(request)
        payload = await request.json()
        read = bool(payload.get("read", True))
        with get_conn() as conn:
            with conn.cursor() as cur:
                profile(cur, auth.user_id)
                cur.execute(
                    """
                    UPDATE user_notifications
                    SET read_at=CASE WHEN %s THEN COALESCE(read_at, NOW()) ELSE NULL END
                    WHERE id=%s AND user_id=%s
                    RETURNING *
                    """,
                    (read, notification_id, auth.user_id),
                )
                saved = cur.fetchone()
                if not saved:
                    raise HTTPException(404, "Notification not found")
                cur.execute(
                    """
                    SELECT notification.*, project.name AS project_name,
                           dar.status AS dar_status
                    FROM user_notifications notification
                    JOIN projects project ON project.id=notification.project_id
                    LEFT JOIN daily_activity_reports dar ON dar.id=notification.dar_id
                    WHERE notification.id=%s
                    """,
                    (notification_id,),
                )
                return dict(cur.fetchone())

    @router.post("/notifications/read-all")
    def mark_all_notifications_read(request: Request, project_id: int | None = Query(None)):
        auth = current_auth_user(request)
        with get_conn() as conn:
            with conn.cursor() as cur:
                profile(cur, auth.user_id)
                if project_id is not None:
                    project_context(cur, auth.user_id, project_id)
                    cur.execute(
                        """
                        UPDATE user_notifications SET read_at=COALESCE(read_at, NOW())
                        WHERE user_id=%s AND project_id=%s AND read_at IS NULL
                        """,
                        (auth.user_id, project_id),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE user_notifications SET read_at=COALESCE(read_at, NOW())
                        WHERE user_id=%s AND read_at IS NULL
                        """,
                        (auth.user_id,),
                    )
                return {"status": "updated", "count": cur.rowcount}

    @router.get("/notifications/preferences")
    def notification_preferences(request: Request):
        auth = current_auth_user(request)
        with get_conn() as conn:
            with conn.cursor() as cur:
                profile(cur, auth.user_id)
                cur.execute(
                    """
                    SELECT in_app_enabled, email_enabled
                    FROM notification_preferences WHERE user_id=%s
                    """,
                    (auth.user_id,),
                )
                row = cur.fetchone()
                return dict(row) if row else {
                    "in_app_enabled": True, "email_enabled": True
                }

    @router.put("/notifications/preferences")
    async def save_notification_preferences(request: Request):
        auth = current_auth_user(request)
        payload = await request.json()
        in_app_enabled = bool(payload.get("in_app_enabled", True))
        email_enabled = bool(payload.get("email_enabled", True))
        with get_conn() as conn:
            with conn.cursor() as cur:
                profile(cur, auth.user_id)
                cur.execute(
                    """
                    INSERT INTO notification_preferences
                      (user_id, in_app_enabled, email_enabled)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id) DO UPDATE
                    SET in_app_enabled=EXCLUDED.in_app_enabled,
                        email_enabled=EXCLUDED.email_enabled, updated_at=NOW()
                    RETURNING in_app_enabled, email_enabled
                    """,
                    (auth.user_id, in_app_enabled, email_enabled),
                )
                return dict(cur.fetchone())

    @router.post("/notifications/deliver-pending")
    def process_pending_email(request: Request):
        auth = current_auth_user(request)
        with get_conn() as conn:
            with conn.cursor() as cur:
                user_profile = profile(cur, auth.user_id)
                if user_profile["system_role"] != "system_admin":
                    raise HTTPException(403, "System administrator permission is required")
        return deliver_pending_emails(get_conn, limit=50)

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
