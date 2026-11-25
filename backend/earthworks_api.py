"""EOS native earthworks reports, using the existing DrillOps identity and scope."""
import base64
import copy
import json
import math
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from business_platform import current_business_scope, workspace_for
from security import current_auth_user

MAX_BODY = 9_000_000
STATES = {"draft", "submitted", "approved", "returned"}
COMPLETION = {"inProgress", "preparationComplete", "rehabilitationComplete"}


def identifier(value):
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(400, "Invalid record identifier")


def scope_for(write=False):
    scope = current_business_scope.get()
    if not scope or not scope.project_id or not scope.campaign_id:
        raise HTTPException(409, "Select a workspace, project and campaign")
    projects = scope.write_projects if write else scope.read_projects
    campaigns = scope.write_campaigns if write else scope.read_campaigns
    if not scope.admin and scope.project_id not in projects and scope.campaign_id not in campaigns:
        raise HTTPException(403, "Campaign access denied")
    return scope


def validate_report(source, codes, submission=False):
    """Validate untrusted input independently of the phone; retain incomplete drafts."""
    if not isinstance(source, dict):
        raise HTTPException(400, "Expected a report")
    report = copy.deepcopy(source)
    for key in ("pendingID", "history", "ownerID", "revision", "status", "finalised"):
        report.pop(key, None)
    report["id"] = identifier(report.get("id"))
    if type(report.get("date")) not in (int, float) or not math.isfinite(report["date"]):
        raise HTTPException(400, "Invalid report date")
    try:
        date.fromisoformat(report.get("reportDate", ""))
    except (ValueError, TypeError):
        raise HTTPException(400, "Report date must use YYYY-MM-DD")
    if not isinstance(report.get("operatorName"), str) or len(report["operatorName"]) > 160:
        raise HTTPException(400, "Enter a valid operator name")
    activities = report.get("activities", [])
    if not isinstance(activities, list) or len(activities) > 100:
        raise HTTPException(400, "A report supports up to 100 activities")
    issues, intervals, photos, ids = [], [], 0, set()
    if not report["operatorName"].strip() or not activities:
        issues.append("Enter an operator and at least one activity")
    for entry in activities:
        if not isinstance(entry, dict):
            raise HTTPException(400, "Invalid activity")
        eid = identifier(entry.get("id"))
        if eid in ids:
            raise HTTPException(400, "Duplicate activity identifier")
        ids.add(eid)
        for key, limit in (("task", 500), ("site", 160), ("equipment", 160), ("equipmentID", 100), ("notes", 4000)):
            value = entry.get(key) or ""
            if not isinstance(value, str) or len(value) > limit:
                raise HTTPException(400, f"Invalid {key}")
        start, end = entry.get("start"), entry.get("end")
        if type(start) is not int or type(end) is not int or not (0 <= start <= 1440 and 0 <= end <= 1440):
            raise HTTPException(400, "Times must be minutes within the report day")
        duration = max(0, end - start)
        if end <= start:
            issues.append("Finish must be after start")
        else:
            intervals.append((start, end))
        if not entry.get("task", "").strip():
            issues.append("Describe every activity")
        code = codes.get(str(entry.get("siteCodeID", "")).lower())
        if not code or not code["active"]:
            issues.append("Select an active managed site or overhead code")
        else:
            entry.update(site=code["code"], siteKind=code["kind"], chargeable=code["chargeable"])
        operating, standby = entry.get("operatingMinutes") or 0, entry.get("standbyMinutes") or 0
        if type(operating) is not int or type(standby) is not int or min(operating, standby) < 0 or operating + standby > duration:
            raise HTTPException(400, "Machine operating and standby minutes must fit within the activity")
        if (operating or standby or entry.get("equipment")) and not (entry.get("equipmentID") or "").strip():
            issues.append("Enter an equipment ID for machine work")
        if (operating or standby) and not (entry.get("equipment") or "").strip():
            issues.append("Enter the equipment description")
        meters = (entry.get("meterStart"), entry.get("meterEnd"))
        if any(x is not None for x in meters):
            if any(type(x) not in (float, int) or not math.isfinite(x) or x < 0 for x in meters) or meters[1] < meters[0]:
                raise HTTPException(400, "Enter both meter readings; end must be at least start")
            if not (entry.get("equipmentID") or "").strip():
                issues.append("Meter readings require an equipment ID")
        completion = entry.get("completion") or "inProgress"
        if completion not in COMPLETION:
            raise HTTPException(400, "Invalid completion status")
        if code and code["kind"] == "overhead" and completion != "inProgress":
            issues.append("Completion status applies only to site work")
        evidence = entry.get("photos") or []
        if not isinstance(evidence, list) or len(evidence) > 5:
            raise HTTPException(400, "Up to five photos per activity")
        for photo in evidence:
            if not isinstance(photo, dict):
                raise HTTPException(400, "Invalid evidence photo")
            identifier(photo.get("id"))
            encoded = photo.get("jpeg", "")
            if not isinstance(encoded, str) or len(encoded) > 280_000:
                raise HTTPException(400, "Evidence photo is too large")
            try:
                data = base64.b64decode(encoded, validate=True)
            except (ValueError, TypeError):
                raise HTTPException(400, "Invalid photo encoding")
            if len(data) > 200_000 or not data.startswith(b'\xff\xd8\xff') or not data.endswith(b'\xff\xd9'):
                raise HTTPException(400, "Evidence must be a JPEG up to 200 KB")
            photos += 1
        if completion != "inProgress" and not ((entry.get("notes") or "").strip() or evidence):
            issues.append("Add notes or a photo for completed site work")
    if photos > 30:
        raise HTTPException(400, "Up to 30 photos per report")
    intervals.sort()
    total, finish = 0, 0
    for start, end in intervals:
        if start < finish:
            issues.append("Activities overlap")
        total += max(0, end - max(finish, start))
        finish = max(finish, end)
    if submission and issues:
        raise HTTPException(400, "; ".join(dict.fromkeys(issues)))
    report["operatorMinutes"] = total
    report["validationIssues"] = list(dict.fromkeys(issues))
    return report


def next_state(state, action, own, reviewer, reason):
    if action == "submit" and state in {"draft", "returned"} and own:
        return "submitted"
    if action in {"approve", "return"} and state == "submitted" and reviewer and not own:
        if action == "return" and not reason.strip():
            raise HTTPException(400, "Explain what the operator needs to correct")
        return "approved" if action == "approve" else "returned"
    raise HTTPException(403, "This review action is not permitted; authors cannot approve their own reports")


async def body(request):
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_BODY:
            raise HTTPException(413, "Report exceeds the upload limit")
    try:
        result = json.loads(data)
    except (ValueError, UnicodeError):
        raise HTTPException(400, "Invalid JSON")
    if not isinstance(result, dict):
        raise HTTPException(400, "Expected an object")
    return result


def create_earthworks_router(get_conn):
    router = APIRouter(prefix="/eos/earthworks", tags=["earthworks"])

    def keys(scope):
        return scope.workspace_id, scope.project_id, scope.campaign_id

    def reviewer(cur, scope, uid):
        if scope.admin:
            return True
        cur.execute("SELECT 1 FROM eos_earthworks_reviewers WHERE workspace_id=%s AND business_project_id=%s AND campaign_id=%s AND user_id=%s", (*keys(scope), uid))
        return bool(cur.fetchone())

    def catalog(cur, scope):
        cur.execute("SELECT id::text,code,label,kind,chargeable,active FROM eos_earthworks_codes WHERE workspace_id=%s AND business_project_id=%s AND campaign_id=%s ORDER BY kind,code", keys(scope))
        return [dict(row) for row in cur.fetchall()]

    def load(cur, scope, rid):
        cur.execute("SELECT * FROM eos_earthworks_reports WHERE workspace_id=%s AND business_project_id=%s AND campaign_id=%s AND id=%s FOR UPDATE", (*keys(scope), rid))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Report not found")
        return dict(row)

    def response(row):
        result = dict(row["document"])
        result.update(revision=row["revision"], status=row["status"], ownerID=str(row["owner_id"]), history=row["history"], finalised=row["status"] in {"submitted", "approved"})
        return result

    def check_revision(row, payload):
        if type(payload.get("expectedRevision")) is not int or row["revision"] != payload["expectedRevision"]:
            raise HTTPException(409, "Report changed on another device. Keep your draft and reload the server version before retrying.")

    @router.get("/catalog")
    def get_catalog(request: Request):
        scope = scope_for(); auth = current_auth_user(request); uid = auth.canonical_id or auth.user_id
        with get_conn() as conn, conn.cursor() as cur:
            codes = catalog(cur, scope)
            can_review = reviewer(cur, scope, uid)
            cur.execute("SELECT user_id::text FROM eos_earthworks_reviewers WHERE workspace_id=%s AND business_project_id=%s AND campaign_id=%s", keys(scope))
            reviewer_ids = [r["user_id"] for r in cur.fetchall()]
            return {"codes": codes, "canManage": scope.admin, "canReview": can_review, "canWrite": scope.admin or scope.project_id in scope.write_projects or scope.campaign_id in scope.write_campaigns, "reviewerIDs": reviewer_ids}

    @router.put("/codes/{code_id}")
    async def save_code(code_id: str, request: Request):
        scope = scope_for(True)
        if not scope.admin:
            raise HTTPException(403, "A workspace administrator manages codes")
        code_id = identifier(code_id); data = await body(request)
        code, label, kind = data.get("code"), data.get("label"), data.get("kind")
        if not isinstance(code, str) or not code.strip() or len(code) > 100 or not isinstance(label, str) or len(label) > 160 or kind not in {"site", "overhead"}:
            raise HTTPException(400, "Enter a code, label and site/overhead type")
        if type(data.get("active")) is not bool or type(data.get("chargeable")) is not bool:
            raise HTTPException(400, "Active and chargeable must be true or false")
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT id::text FROM eos_earthworks_codes WHERE workspace_id=%s AND business_project_id=%s AND campaign_id=%s AND lower(code)=lower(%s) AND id<>%s", (*keys(scope), code.strip(), code_id))
            if cur.fetchone():
                raise HTTPException(409, "This code already exists")
            cur.execute("INSERT INTO eos_earthworks_codes(id,workspace_id,business_project_id,campaign_id,code,label,kind,chargeable,active) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(workspace_id,business_project_id,campaign_id,id) DO UPDATE SET label=EXCLUDED.label,active=EXCLUDED.active RETURNING id", (code_id,*keys(scope),code.strip(),label,kind,data["chargeable"],data["active"]))
            # Existing code identity/classification is immutable to preserve historical allocation.
        return {"ok": True}

    @router.put("/reviewers/{user_id}")
    async def grant_reviewer(user_id: str, request: Request):
        scope = scope_for(True); auth = current_auth_user(request); uid = identifier(user_id)
        if not scope.admin:
            raise HTTPException(403, "A workspace administrator assigns supervisors")
        data = await body(request)
        if type(data.get("active")) is not bool:
            raise HTTPException(400, "Choose active or inactive")
        people = (workspace_for(auth, scope.workspace_id) or {}).get("people", [])
        if data["active"] and not any(str(p.get("user_id", p.get("id", ""))) == uid and p.get("status") == "active" and "eos" in p.get("apps", []) for p in people):
            raise HTTPException(400, "Choose an existing workspace member with EOS access")
        with get_conn() as conn, conn.cursor() as cur:
            if data["active"]:
                cur.execute("INSERT INTO eos_earthworks_reviewers(workspace_id,business_project_id,campaign_id,user_id) VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING", (*keys(scope),uid))
            else:
                cur.execute("DELETE FROM eos_earthworks_reviewers WHERE workspace_id=%s AND business_project_id=%s AND campaign_id=%s AND user_id=%s", (*keys(scope),uid))
        return {"ok": True}

    @router.get("/reports")
    def reports(request: Request, after: str = ""):
        scope = scope_for(); auth = current_auth_user(request); uid = auth.canonical_id or auth.user_id
        after_id = identifier(after) if after else "00000000-0000-0000-0000-000000000000"
        with get_conn() as conn, conn.cursor() as cur:
            can_review = reviewer(cur, scope, uid)
            cur.execute("SELECT * FROM eos_earthworks_reports WHERE workspace_id=%s AND business_project_id=%s AND campaign_id=%s AND id>%s AND (owner_id=%s OR (%s AND status<>'draft')) ORDER BY id LIMIT 10", (*keys(scope),after_id,uid,can_review))
            rows = [dict(row) for row in cur.fetchall()]
        return {"reports": [response(row) for row in rows], "next": str(rows[-1]["id"]) if len(rows) == 10 else None}

    @router.put("/reports/{report_id}")
    async def save_report(report_id: str, request: Request):
        scope = scope_for(True); auth = current_auth_user(request); uid = auth.canonical_id or auth.user_id
        rid = identifier(report_id); data = await body(request); mutation = identifier(data.get("mutationID"))
        with get_conn() as conn, conn.cursor() as cur:
            # Serialise create/update for this scoped report, including retries after a lost response.
            cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", ("/".join((*keys(scope),rid)),))
            cur.execute("SELECT * FROM eos_earthworks_reports WHERE workspace_id=%s AND business_project_id=%s AND campaign_id=%s AND id=%s FOR UPDATE", (*keys(scope),rid))
            found = cur.fetchone(); row = dict(found) if found else None
            if row:
                if str(row["owner_id"]) != uid:
                    raise HTTPException(403, "Only the report author can edit it")
                if str(row["last_mutation"]) == mutation:
                    return response(row)
                check_revision(row, data)
                if row["status"] not in {"draft", "returned"}:
                    raise HTTPException(409, "Submitted and approved reports are locked")
            elif data.get("expectedRevision") != 0:
                raise HTTPException(409, "Report does not exist at that revision")
            report = validate_report(data.get("report"), {r["id"]:r for r in catalog(cur, scope)})
            if report["id"] != rid:
                raise HTTPException(400, "Report identifier does not match")
            report.update(workspaceID=scope.workspace_id, projectID=scope.project_id, campaignID=scope.campaign_id)
            status = row["status"] if row else "draft"
            revision = row["revision"] + 1 if row else 1
            history = row["history"] if row else []
            cur.execute("INSERT INTO eos_earthworks_reports(id,workspace_id,business_project_id,campaign_id,owner_id,status,revision,document,history,last_mutation) VALUES(%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s) ON CONFLICT(workspace_id,business_project_id,campaign_id,id) DO UPDATE SET document=EXCLUDED.document,revision=EXCLUDED.revision,last_mutation=EXCLUDED.last_mutation,updated_at=now() RETURNING *", (rid,*keys(scope),uid,status,revision,json.dumps(report),json.dumps(history),mutation))
            return response(dict(cur.fetchone()))

    @router.post("/reports/{report_id}/transition")
    async def transition(report_id: str, request: Request):
        scope = scope_for(True); auth = current_auth_user(request); uid = auth.canonical_id or auth.user_id
        data = await body(request); mutation = identifier(data.get("mutationID")); reason = data.get("reason") or ""
        if not isinstance(reason, str) or len(reason) > 4000:
            raise HTTPException(400, "Review comments must be at most 4000 characters")
        with get_conn() as conn, conn.cursor() as cur:
            row = load(cur,scope,identifier(report_id)); own = str(row["owner_id"]) == uid
            can_review = reviewer(cur,scope,uid)
            if not own and not can_review:
                raise HTTPException(403, "Supervisor permission required")
            if str(row["last_mutation"]) == mutation:
                return response(row)
            check_revision(row,data)
            status = next_state(row["status"],data.get("action"),own,can_review,reason)
            if status in {"submitted", "approved"}:
                validate_report(row["document"],{r["id"]:r for r in catalog(cur,scope)},submission=True)
            history = row["history"] + [{"id":mutation,"status":status,"actorID":uid,"actorName":auth.display_name or auth.email,"reason":reason,"timestamp":datetime.now(timezone.utc).isoformat()}]
            cur.execute("UPDATE eos_earthworks_reports SET status=%s,revision=revision+1,history=%s::jsonb,last_mutation=%s,updated_at=now() WHERE workspace_id=%s AND business_project_id=%s AND campaign_id=%s AND id=%s RETURNING *", (status,json.dumps(history),mutation,*keys(scope),row["id"]))
            return response(dict(cur.fetchone()))

    return router
