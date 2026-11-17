"""Shared FieldMaps identity, business hierarchy and scoped request authorization."""
from contextvars import ContextVar
from dataclasses import dataclass
import json
from uuid import UUID
from fastapi import APIRouter, HTTPException, Request
from security import current_auth_user

ARGO = "a7ecd88b-8ba9-4c5f-80c8-872fcc50f34f"
APPS = {"eos", "account", "project"}
CONTRACTOR_TYPES = ("Drilling", "Geophysical Logging", "Earthworks", "Labour", "Geological Support", "Lab Testing", "Misc")
current_business_scope = ContextVar("business_scope", default=None)


def uuid_value(value):
    if not value:
        return ""
    try:
        return str(UUID(str(value)))
    except ValueError:
        raise HTTPException(400, "Invalid workspace, project or campaign identifier")


def workspace_for(auth, workspace_id):
    return next((w for w in auth.workspaces if w["id"] == workspace_id), None)


def require_workspace(auth, workspace_id, manage=False):
    workspace = workspace_for(auth, workspace_id)
    if not workspace or (manage and not (auth.owner or workspace["role"] in {"owner", "admin"})):
        raise HTTPException(403, "Workspace access denied")
    return workspace


@dataclass(frozen=True)
class BusinessScope:
    workspace_id: str
    project_id: str = ""
    campaign_id: str = ""
    admin: bool = False
    read_projects: tuple = ()
    write_projects: tuple = ()
    read_campaigns: tuple = ()
    write_campaigns: tuple = ()

    def settings(self):
        return {
            "app.workspace_id": self.workspace_id,
            "app.business_project_id": self.project_id,
            "app.campaign_id": self.campaign_id,
            "app.workspace_admin": str(self.admin).lower(),
            "app.read_projects": ",".join(self.read_projects),
            "app.write_projects": ",".join(self.write_projects),
            "app.read_campaigns": ",".join(self.read_campaigns),
            "app.write_campaigns": ",".join(self.write_campaigns),
        }


def resolve_request_scope(auth, headers, method, get_conn, route_app_names):
    wid = uuid_value(headers.get("x-workspace-id"))
    if not wid:
        if auth.owner and workspace_for(auth, ARGO):
            wid = ARGO
        elif len(auth.workspaces) == 1:
            wid = auth.workspaces[0]["id"]
        else:
            raise HTTPException(409, "Select a company workspace first")
    workspace = require_workspace(auth, wid)
    pid = uuid_value(headers.get("x-business-project-id"))
    cid = uuid_value(headers.get("x-campaign-id"))
    app = headers.get("x-drillops-app", "")
    if app and (app not in APPS or (not auth.owner and (app not in route_app_names or app not in auth.apps))):
        raise HTTPException(403, "App access denied")
    apps = {app} if app else (APPS & set(auth.apps) & set(route_app_names))
    admin = auth.owner or workspace["role"] in {"owner", "admin"}
    with get_conn() as conn:
        with conn.cursor() as cur:
            if cid:
                cur.execute("SELECT project_id::text FROM business_campaigns WHERE id=%s AND workspace_id=%s", (cid, wid))
                campaign = cur.fetchone()
                if not campaign or (pid and pid != campaign["project_id"]):
                    raise HTTPException(403, "Campaign does not belong to this workspace/project")
                pid = campaign["project_id"]
            if pid:
                cur.execute("SELECT 1 FROM business_projects WHERE id=%s AND workspace_id=%s", (pid, wid))
                if not cur.fetchone():
                    raise HTTPException(403, "Project does not belong to this workspace")
            cur.execute("SELECT project_id::text,campaign_id::text,role,apps FROM business_shares WHERE workspace_id=%s AND user_id=%s", (wid, auth.canonical_id or auth.user_id))
            shares = [r for r in cur.fetchall() if apps & set(r["apps"])]
    rp = tuple(r["project_id"] for r in shares if r["project_id"])
    rc = tuple(r["campaign_id"] for r in shares if r["campaign_id"])
    wp = tuple(r["project_id"] for r in shares if r["project_id"] and r["role"] in {"editor", "admin"})
    wc = tuple(r["campaign_id"] for r in shares if r["campaign_id"] and r["role"] in {"editor", "admin"})
    if not admin:
        if not rp and not rc:
            raise HTTPException(403, "No projects or campaigns have been shared with you for this app")
        if cid and pid not in rp and cid not in rc:
            raise HTTPException(403, "Campaign access denied")
        if pid and pid not in rp and not cid:
            # Campaign-only users may aggregate their allowed campaigns in the parent project.
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1 FROM business_campaigns WHERE project_id=%s AND id=ANY(%s::uuid[]) LIMIT 1", (pid,list(rc)))
                    if not cur.fetchone():
                        raise HTTPException(403, "Project access denied")
        if method not in {"GET", "HEAD"} and not (wp or wc):
            raise HTTPException(403, "Your shared access is read-only")
    return BusinessScope(wid,pid,cid,admin,rp,wp,rc,wc)


def can_read_legacy_campaign(get_conn, legacy_id):
    """File-backed legacy reports must obey the same RLS as their campaign rows."""
    scope=current_business_scope.get()
    if scope is None:
        return True  # Internal startup maintenance, outside an authenticated request.
    if scope.workspace_id!=ARGO:
        return False
    with get_conn(read_only=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM projects WHERE id=%s",(legacy_id,))
            return bool(cur.fetchone())


def require_contractor_admin():
    scope=current_business_scope.get()
    if scope is not None and not scope.admin:
        raise HTTPException(403, "A workspace admin must configure contractors")


def import_destination(get_conn, program='', project='', client=''):
    """Resolve upload labels from the authorized campaign, never from report text."""
    scope = current_business_scope.get()
    if scope is None:
        return program, project, client
    if not scope.project_id or not scope.campaign_id:
        raise HTTPException(409, 'Select a company workspace, project and campaign before importing reports')
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute('''SELECT p.program, p.name, w.name AS client
                FROM business_campaigns c JOIN projects p ON p.id=c.legacy_project_id
                JOIN business_workspaces w ON w.id=c.workspace_id
                WHERE c.id=%s AND c.project_id=%s AND c.workspace_id=%s''',
                (scope.campaign_id, scope.project_id, scope.workspace_id))
            row = cur.fetchone()
    if not row:
        raise HTTPException(403, 'The selected import campaign is unavailable')
    return row['program'], row['name'], row['client']


def create_business_router(get_conn):
    router = APIRouter(prefix="/platform", tags=["workspaces"])

    def audit(cur, auth, wid, action, detail):
        cur.execute("INSERT INTO business_access_events(workspace_id,actor_id,action,detail) VALUES(%s,%s,%s,%s::jsonb)", (wid,auth.canonical_id or auth.user_id,action,json.dumps(detail)))

    def sync_workspaces(cur, auth):
        for w in auth.workspaces:
            cur.execute("INSERT INTO business_workspaces(id,name) VALUES(%s,%s) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name",(w["id"],w["name"]))

    @router.get("/context")
    def context(request: Request):
        auth = current_auth_user(request)
        with get_conn() as conn:
            with conn.cursor() as cur:
                sync_workspaces(cur,auth)
                ids = [w["id"] for w in auth.workspaces]
                cur.execute("SELECT id::text,workspace_id::text,name FROM business_projects WHERE workspace_id=ANY(%s::uuid[]) ORDER BY name",(ids,))
                projects = [dict(r) for r in cur.fetchall()]
                cur.execute("SELECT c.id::text,c.workspace_id::text,c.project_id::text,c.name,c.year,c.legacy_project_id,p.name legacy_name,p.program legacy_program,p.client_id FROM business_campaigns c LEFT JOIN projects p ON p.id=c.legacy_project_id WHERE c.workspace_id=ANY(%s::uuid[]) ORDER BY c.name",(ids,))
                campaigns = [dict(r) for r in cur.fetchall()]
                cur.execute("SELECT workspace_id::text,project_id::text,campaign_id::text,role,apps FROM business_shares WHERE user_id=%s",(auth.canonical_id or auth.user_id,))
                shares = [dict(r) for r in cur.fetchall()]
        admin_ids = {w["id"] for w in auth.workspaces if auth.owner or w["role"] in {"owner","admin"}}
        allowed_p = {s["project_id"] for s in shares if set(s["apps"]) & set(auth.apps)}
        allowed_c = {s["campaign_id"] for s in shares if set(s["apps"]) & set(auth.apps)}
        campaigns = [c for c in campaigns if c["workspace_id"] in admin_ids or c["project_id"] in allowed_p or c["id"] in allowed_c]
        parent_ids = {c["project_id"] for c in campaigns}
        projects = [p for p in projects if p["workspace_id"] in admin_ids or p["id"] in allowed_p or p["id"] in parent_ids]
        return {"user_id":auth.canonical_id or auth.user_id,"platform_admin":auth.owner,
            "workspaces":[{k:w.get(k) for k in ("id","name","role")} for w in auth.workspaces],"projects":projects,"campaigns":campaigns,"shares":shares}

    @router.get("/workspaces/{workspace_id}/settings")
    def settings(workspace_id: str, request: Request):
        auth = current_auth_user(request)
        w = require_workspace(auth,uuid_value(workspace_id),True)
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id::text,user_id::text,project_id::text,campaign_id::text,role,apps FROM business_shares WHERE workspace_id=%s ORDER BY updated_at DESC",(workspace_id,))
                shares=[dict(r) for r in cur.fetchall()]
                cur.execute("SELECT action,detail,created_at FROM business_access_events WHERE workspace_id=%s ORDER BY id DESC LIMIT 50",(workspace_id,))
                events=[dict(r) for r in cur.fetchall()]
                cur.execute("SELECT name,category,short_code,active FROM contractors WHERE workspace_id=%s ORDER BY name",(workspace_id,))
                contractors=[dict(r) for r in cur.fetchall()]
        return {"workspace":{k:w[k] for k in ("id","name","role")},"people":w.get("people",[]),"shares":shares,"events":events,"contractors":contractors,"contractor_types":CONTRACTOR_TYPES}

    @router.post("/workspaces/{workspace_id}/contractors")
    async def create_contractor(workspace_id: str, request: Request):
        auth=current_auth_user(request);require_workspace(auth,uuid_value(workspace_id),True)
        data=await request.json();name=str(data.get('name') or '').strip();category=data.get('category')
        if not name or len(name)>120 or category not in CONTRACTOR_TYPES:
            raise HTTPException(400,'Enter a contractor name and supported service type')
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("INSERT INTO contractors(workspace_id,name,short_code,category,program,sites,active) VALUES(%s,%s,%s,%s,'','',true) ON CONFLICT(workspace_id,name) DO NOTHING RETURNING name,category",(workspace_id,name,name[:3].upper(),category))
                row=cur.fetchone()
                if not row:raise HTTPException(409,'This contractor already exists in the workspace')
                audit(cur,auth,workspace_id,'contractor.created',{'name':name,'category':category})
        return dict(row)

    @router.patch("/workspaces/{workspace_id}/contractors/{name}")
    async def configure_contractor(workspace_id: str, name: str, request: Request):
        auth=current_auth_user(request)
        require_workspace(auth,uuid_value(workspace_id),True)
        data=await request.json()
        category=data.get('category')
        if category not in CONTRACTOR_TYPES:
            raise HTTPException(400,'Choose a supported contractor type')
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute('UPDATE contractors SET category=%s WHERE workspace_id=%s AND name=%s RETURNING name,category',(category,workspace_id,name))
                row=cur.fetchone()
                if not row:raise HTTPException(404,'Contractor not found in this workspace')
                audit(cur,auth,workspace_id,'contractor.type_updated',{'name':name,'category':category})
        return dict(row)

    @router.post("/workspaces/{workspace_id}/projects")
    async def create_project(workspace_id: str, request: Request):
        auth=current_auth_user(request);require_workspace(auth,uuid_value(workspace_id),True)
        data=await request.json();name=str(data.get("name") or "").strip()
        if not name or len(name)>120:raise HTTPException(400,"Enter a project name (1–120 characters)")
        with get_conn() as conn:
            with conn.cursor() as cur:
                sync_workspaces(cur,auth)
                cur.execute("INSERT INTO business_projects(workspace_id,name) VALUES(%s,%s) ON CONFLICT(workspace_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id::text",(workspace_id,name))
                result=dict(cur.fetchone());audit(cur,auth,workspace_id,"project.created",{"name":name})
        return result

    @router.post("/workspaces/{workspace_id}/campaigns")
    async def create_campaign(workspace_id: str, request: Request):
        auth=current_auth_user(request);w=require_workspace(auth,uuid_value(workspace_id),True)
        data=await request.json();pid=uuid_value(data.get("project_id"));name=str(data.get("name") or "").strip();year=str(data.get("year") or "")
        if not name or len(name)>120 or not(year.isdigit() and len(year)==4):raise HTTPException(400,"Enter a campaign name and four-digit year")
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT name FROM business_projects WHERE id=%s AND workspace_id=%s",(pid,workspace_id));project=cur.fetchone()
                if not project:raise HTTPException(404,"Project not found")
                cur.execute("SELECT client_id FROM business_workspaces WHERE id=%s",(workspace_id,));client_id=cur.fetchone()["client_id"]
                if not client_id:
                    cur.execute("INSERT INTO clients(name,code,status,workspace_id) VALUES(%s,'','Active',%s) RETURNING id",(w["name"],workspace_id));client_id=cur.fetchone()["id"]
                    cur.execute("UPDATE business_workspaces SET client_id=%s WHERE id=%s",(client_id,workspace_id))
                cur.execute("SELECT 1 FROM business_campaigns WHERE project_id=%s AND name=%s",(pid,name))
                if cur.fetchone():raise HTTPException(409,"A campaign with this name already exists")
                cur.execute("INSERT INTO projects(contractor,name,year,status,program,client_id,workspace_id) VALUES('Company',%s,%s,'Active',%s,%s,%s) RETURNING id",(name,year,project["name"],client_id,workspace_id));legacy=cur.fetchone()["id"]
                cur.execute("INSERT INTO business_campaigns(workspace_id,project_id,legacy_project_id,name,year) VALUES(%s,%s,%s,%s,%s) RETURNING id::text",(workspace_id,pid,legacy,name,year));result=dict(cur.fetchone())
                cur.execute("UPDATE projects SET business_project_id=%s,campaign_id=%s WHERE id=%s",(pid,result["id"],legacy))
                audit(cur,auth,workspace_id,"campaign.created",{"name":name,"project_id":pid})
        return result

    @router.post("/workspaces/{workspace_id}/shares")
    async def share(workspace_id: str, request: Request):
        auth=current_auth_user(request);w=require_workspace(auth,uuid_value(workspace_id),True)
        data=await request.json();uid=uuid_value(data.get("user_id"));pid=uuid_value(data.get("project_id"));cid=uuid_value(data.get("campaign_id"));role=data.get("role");apps=data.get("apps",[])
        person=next((p for p in w.get("people",[]) if p["id"]==uid and p["status"]=="active"),None)
        if not person:raise HTTPException(400,"Choose an active member of this FieldMaps workspace")
        if person.get("platform_admin") or person["role"] in {"owner","admin"}:raise HTTPException(400,"This protected workspace role already has full access")
        if bool(pid)==bool(cid) or role not in {"viewer","editor"} or not isinstance(apps,list) or not apps or not set(apps)<=APPS:raise HTTPException(400,"Choose a project or campaign, a role and the permitted apps")
        if not set(apps)<=set(person.get("apps",[])):raise HTTPException(400,"The member needs these app permissions in their existing DrillOps account first")
        table,key=("business_projects","project_id") if pid else ("business_campaigns","campaign_id")
        target=pid or cid
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(f"SELECT 1 FROM {table} WHERE id=%s AND workspace_id=%s",(target,workspace_id))
                if not cur.fetchone():raise HTTPException(404,"Sharing target not found in this workspace")
                cur.execute(f"DELETE FROM business_shares WHERE workspace_id=%s AND user_id=%s AND {key}=%s",(workspace_id,uid,target))
                cur.execute(f"INSERT INTO business_shares(workspace_id,user_id,{key},role,apps,created_by) VALUES(%s,%s,%s,%s,%s,%s) RETURNING id::text",(workspace_id,uid,target,role,apps,auth.canonical_id or auth.user_id));result=dict(cur.fetchone())
                audit(cur,auth,workspace_id,"access.shared",{"user_id":uid,key:target,"role":role,"apps":apps})
        return result

    @router.delete("/workspaces/{workspace_id}/shares/{share_id}")
    def revoke(workspace_id: str, share_id: str, request: Request):
        auth=current_auth_user(request);require_workspace(auth,uuid_value(workspace_id),True)
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM business_shares WHERE workspace_id=%s AND id=%s RETURNING user_id::text",(workspace_id,uuid_value(share_id)))
                row=cur.fetchone()
                if not row:raise HTTPException(404,"Sharing entry not found")
                audit(cur,auth,workspace_id,"access.revoked",{"user_id":row["user_id"],"share_id":share_id})
        return {"status":"revoked"}
    return router
