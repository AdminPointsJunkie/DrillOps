"""
DrillOps — FastAPI Backend v3
Database: Supabase (PostgreSQL)
Multi-contractor: every query is filtered by contractor
"""

import re
import os
from io import BytesIO
from typing import Optional

import pdfplumber
import pandas as pd
import psycopg2
import psycopg2.extras
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Form
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="DrillOps API", version="3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://www.drillops.com.au",
        "https://drillops.com.au",
        "http://localhost:3000",
        "http://localhost:8000",
        "http://127.0.0.1:5500",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set.")

CONTRACTORS = [
    ("Allianz Drilling",   "ALZ"),
    ("Mitchells Drilling", "MIT"),
    ("MCC Earthworks",     "MCC"),
    ("Weatherfords",       "WFD"),
    ("Epiroc",             "EPI"),
    ("Fortem",             "FOR"),
]


def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


# ── Schema ────────────────────────────────────────────────────────────────────
def init_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS activities (
                    id              SERIAL PRIMARY KEY,
                    source_file     TEXT,
                    contractor      TEXT DEFAULT 'Allianz Drilling',
                    date            TEXT,
                    hole_num        TEXT,
                    site_name       TEXT,
                    location        TEXT,
                    drill_rig       TEXT,
                    client          TEXT,
                    contract        TEXT,
                    shift           TEXT,
                    time_from       TEXT,
                    time_to         TEXT,
                    total_time      TEXT,
                    bit_type        TEXT,
                    diameter        TEXT,
                    metres_from     FLOAT,
                    metres_to       FLOAT,
                    total_metres    FLOAT,
                    code            TEXT,
                    notes           TEXT,
                    rate_year       TEXT,
                    unit_rate       FLOAT,
                    quantity        FLOAT,
                    line_cost       FLOAT,
                    rate_basis      TEXT,
                    po_id           INTEGER
                )
            """)
            # Safe migrations for existing tables
            for col, typedef in [
                ("contractor", "TEXT DEFAULT 'Allianz Drilling'"),
                ("po_id",      "INTEGER"),
                ("rate_year",  "TEXT"),
                ("unit_rate",  "FLOAT"),
                ("quantity",   "FLOAT"),
                ("line_cost",  "FLOAT"),
                ("rate_basis", "TEXT"),
            ]:
                cur.execute(f"ALTER TABLE activities ADD COLUMN IF NOT EXISTS {col} {typedef}")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS consumables (
                    id          SERIAL PRIMARY KEY,
                    source_file TEXT,
                    contractor  TEXT DEFAULT 'Allianz Drilling',
                    date        TEXT,
                    hole_num    TEXT,
                    site_name   TEXT,
                    consumable  TEXT,
                    type        TEXT,
                    quantity    TEXT,
                    unit        TEXT
                )
            """)
            cur.execute("ALTER TABLE consumables ADD COLUMN IF NOT EXISTS contractor TEXT DEFAULT 'Allianz Drilling'")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS crew (
                    id          SERIAL PRIMARY KEY,
                    source_file TEXT,
                    contractor  TEXT DEFAULT 'Allianz Drilling',
                    date        TEXT,
                    hole_num    TEXT,
                    site_name   TEXT,
                    role        TEXT,
                    name        TEXT,
                    hours       TEXT
                )
            """)
            cur.execute("ALTER TABLE crew ADD COLUMN IF NOT EXISTS contractor TEXT DEFAULT 'Allianz Drilling'")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS imported_files (
                    filename   TEXT,
                    contractor TEXT DEFAULT 'Allianz Drilling',
                    PRIMARY KEY (filename, contractor)
                )
            """)
            # Safe migration: add contractor col if old single-col PK existed
            cur.execute("ALTER TABLE imported_files ADD COLUMN IF NOT EXISTS contractor TEXT DEFAULT 'Allianz Drilling'")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS drilling_rates (
                    id         SERIAL PRIMARY KEY,
                    contractor TEXT NOT NULL DEFAULT 'Allianz Drilling',
                    year       TEXT NOT NULL,
                    bit_type   TEXT NOT NULL,
                    depth_from FLOAT NOT NULL,
                    depth_to   FLOAT NOT NULL,
                    rate       FLOAT NOT NULL
                )
            """)
            cur.execute("ALTER TABLE drilling_rates ADD COLUMN IF NOT EXISTS contractor TEXT NOT NULL DEFAULT 'Allianz Drilling'")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS hourly_rates (
                    id          SERIAL PRIMARY KEY,
                    contractor  TEXT NOT NULL DEFAULT 'Allianz Drilling',
                    year        TEXT NOT NULL,
                    code        TEXT NOT NULL,
                    description TEXT,
                    rate        FLOAT NOT NULL,
                    unit        TEXT NOT NULL
                )
            """)
            cur.execute("ALTER TABLE hourly_rates ADD COLUMN IF NOT EXISTS contractor TEXT NOT NULL DEFAULT 'Allianz Drilling'")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS purchase_orders (
                    id              SERIAL PRIMARY KEY,
                    po_number       TEXT NOT NULL,
                    contractor      TEXT NOT NULL DEFAULT 'Allianz Drilling',
                    description     TEXT,
                    issue_date      TEXT,
                    expiry_date     TEXT,
                    po_value        FLOAT DEFAULT 0,
                    status          TEXT DEFAULT 'Active',
                    notes           TEXT
                )
            """)
        conn.commit()


init_db()


# ── Seed 2025 rates (Allianz Drilling) ────────────────────────────────────────
def seed_2025_rates():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM drilling_rates WHERE year='2025' AND contractor='Allianz Drilling'")
            if cur.fetchone()["n"] > 0:
                return
            YEAR = "2025"
            CON  = "Allianz Drilling"
            drilling = [
                (CON, YEAR, "HQ_HQ3",    0,   100,  46.00),
                (CON, YEAR, "HQ_HQ3",  100,   200,  51.00),
                (CON, YEAR, "HQ_HQ3",  200,   300,  59.00),
                (CON, YEAR, "HQ_HQ3",  300,   400,  66.00),
                (CON, YEAR, "HQ_HQ3",  400,   500,  70.00),
                (CON, YEAR, "PCD_S",     0,   200,  51.00),
                (CON, YEAR, "PCD_S",   200,   300,  61.00),
                (CON, YEAR, "PCD_S",   400,   500,  90.00),
                (CON, YEAR, "PCD_M",     0,   200,  60.00),
                (CON, YEAR, "PCD_M",   200,   300,  73.00),
                (CON, YEAR, "PCD_M",   400,   500, 103.00),
                (CON, YEAR, "PCD_L",     0,   200,  76.00),
                (CON, YEAR, "PCD_L",   200,   300,  86.00),
                (CON, YEAR, "HAMMER_S",  0,   100, 196.00),
                (CON, YEAR, "HAMMER_S",100,   200, 239.00),
                (CON, YEAR, "HAMMER_S",200,   300, 278.00),
                (CON, YEAR, "HAMMER_S",300,   400, 324.00),
                (CON, YEAR, "HAMMER_S",400,   500, 367.00),
                (CON, YEAR, "HAMMER_S",500,   600, 422.00),
                (CON, YEAR, "HAMMER_M",  0,   100, 227.00),
                (CON, YEAR, "HAMMER_M",100,   200, 273.00),
                (CON, YEAR, "HAMMER_M",200,   300, 327.00),
                (CON, YEAR, "HAMMER_M",300,   400, 374.00),
            ]
            psycopg2.extras.execute_batch(cur, """
                INSERT INTO drilling_rates (contractor,year,bit_type,depth_from,depth_to,rate)
                VALUES (%s,%s,%s,%s,%s,%s)
            """, drilling)

            hourly = [
                (CON, YEAR, "H_Active",           "Active drilling rate (per hour)",           745.00, "hour"),
                (CON, YEAR, "H_Inactive",          "Inactive / standby rate (per hour)",        675.00, "hour"),
                (CON, YEAR, "H_Standby_NoCrew",    "Standby without crew (per day)",           4470.00, "day"),
                (CON, YEAR, "H_Min_Shift",         "Minimum shift rate (per shift)",           8940.00, "shift"),
                (CON, YEAR, "D_Backhoe",           "Backhoe day rate (with operator)",         1850.00, "day"),
                (CON, YEAR, "D_Backhoe_Standby",   "Backhoe standby rate",                      620.00, "day"),
                (CON, YEAR, "D_Water_Cart",        "Water cart day rate (20,000L)",            1650.00, "day"),
                (CON, YEAR, "D_Water_Cart_Standby","Water cart standby rate",                    550.00, "day"),
                (CON, YEAR, "MOB",                 "Mobilisation to site",                   38760.00, "event"),
                (CON, YEAR, "DEMOB",               "Demobilisation from site",               38760.00, "event"),
            ]
            psycopg2.extras.execute_batch(cur, """
                INSERT INTO hourly_rates (contractor,year,code,description,rate,unit)
                VALUES (%s,%s,%s,%s,%s,%s)
            """, hourly)
        conn.commit()


seed_2025_rates()


# ── Pricing engine ────────────────────────────────────────────────────────────
ACTIVE_CODES = {
    "Drill_Core","Drill_Chip_or_Open_hole","H_Tripping_Rods",
    "H_Circulation_Flush","H_Circulation_Lost","H_Reaming",
    "H_Change_Drill_Mthd","H_Surface_Setup","H_Casing_Install",
    "H_Rig_Cementing","H_Mud_Mixing","H_Water_Flow_Measure",
    "H_Repairs","H_Training","H_Safety_Prestart","H_Safety_Contractor",
}
STANDBY_CODES = {
    "H_Standby_Sumps","H_Standby_AAC","H_Standby_Logger",
    "H_Standby_Grout","H_Standby_Cement_Set",
}
DAY_RATE_CODES = {
    "D_Backhoe":                ("D_Backhoe",            "day"),
    "D_Backhoe - Day Rate":     ("D_Backhoe",            "day"),
    "D_Backhoe - Standby Rate": ("D_Backhoe_Standby",    "day"),
    "D_Water_Cart_Day_Rate":    ("D_Water_Cart",         "day"),
    "D_Water Cart - Standby Rate":("D_Water_Cart_Standby","day"),
    "D_Water_Cart":             ("D_Water_Cart",         "day"),
}
BIT_TYPE_MAP = {"HQ_HQ3":"HQ_HQ3","HQ":"HQ_HQ3","NQ":"HQ_HQ3","PCD":"PCD_S"}


def time_str_to_hours(t):
    try:
        h, m = str(t).split(":")
        return int(h) + int(m) / 60
    except:
        return 0.0


def extract_year(date_str):
    m = re.search(r"(\d{4})", str(date_str))
    if m: return m.group(1)
    m2 = re.search(r"/(\d{2})$", str(date_str))
    if m2: return str(2000 + int(m2.group(1)))
    return "2025"


def price_activity(cur, row, contractor):
    code         = row.get("code","") or ""
    total_time   = row.get("total_time","") or ""
    total_metres = row.get("total_metres")
    metres_to    = row.get("metres_to")
    bit_type     = row.get("bit_type","") or ""
    date_str     = row.get("date","") or ""
    year         = extract_year(date_str)
    hours        = time_str_to_hours(total_time)
    unit_rate = quantity = line_cost = rate_basis = None

    def get_dr(bit_key, depth):
        cur.execute("""
            SELECT rate FROM drilling_rates
            WHERE contractor=%s AND year=%s AND bit_type=%s
              AND depth_from<=%s AND depth_to>%s
            ORDER BY depth_from LIMIT 1
        """, (contractor, year, bit_key, depth, depth))
        r = cur.fetchone()
        return float(r["rate"]) if r else None

    def get_hr(code_key):
        cur.execute("SELECT rate FROM hourly_rates WHERE contractor=%s AND year=%s AND code=%s",
                    (contractor, year, code_key))
        r = cur.fetchone()
        return float(r["rate"]) if r else None

    if code in ("Drill_Core","Drill_Chip_or_Open_hole") and total_metres and total_metres > 0:
        bk = BIT_TYPE_MAP.get(bit_type.upper().replace(" ","_"), "PCD_S" if "Chip" in code else "HQ_HQ3")
        r = get_dr(bk, metres_to or 0)
        if r:
            unit_rate  = r
            quantity   = total_metres
            line_cost  = round(r * total_metres, 2)
            rate_basis = f"$/m @ {(metres_to or 0):.0f}m ({bk})"
    elif any(k in code for k in DAY_RATE_CODES):
        matched = next((v for k,v in DAY_RATE_CODES.items() if k in code or code in k), None)
        if matched:
            r = get_hr(matched[0])
            if r:
                unit_rate  = r; quantity = 1; line_cost = r
                rate_basis = f"${r:,.2f}/{matched[1]}"
    elif "Standby" in code or code in STANDBY_CODES:
        r = get_hr("H_Inactive")
        if r and hours > 0:
            unit_rate  = r; quantity = round(hours,2)
            line_cost  = round(r * hours, 2); rate_basis = f"inactive $/hr × {hours:.2f}h"
    elif hours > 0 and (code in ACTIVE_CODES or "H_" in code or "Crew_Travel" in code):
        r = get_hr("H_Active")
        if r:
            unit_rate  = r; quantity = round(hours,2)
            line_cost  = round(r * hours, 2); rate_basis = f"active $/hr × {hours:.2f}h"

    row.update(rate_year=year, unit_rate=unit_rate, quantity=quantity,
               line_cost=line_cost, rate_basis=rate_basis)
    return row


# ── PDF Parsing ───────────────────────────────────────────────────────────────
def parse_header(text):
    patterns = {
        "client":    r"CLIENT:\s*(.+?)\s+CONTRACT #:",
        "contract":  r"CONTRACT #:\s*(\S+)",
        "date":      r"DATE:\s*(\S+)",
        "hole_num":  r"HOLE #:\s*(\S+)",
        "shift":     r"SHIFT:\s*(\S+)",
        "site_name": r"SITE NAME:\s*(\S+)",
        "location":  r"LOCATION:\s*(\S+)",
        "drill_rig": r"DRILL RIG #\s*(\S+)",
    }
    return {k: (re.search(p, text, re.IGNORECASE).group(1).strip()
                if re.search(p, text, re.IGNORECASE) else "") for k, p in patterns.items()}


def parse_activities(text, header, filename, contractor):
    time_pat = r"\d{1,2}:\d{2}"
    row_re = re.compile(
        r"^(.*?)(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})"
        r"(?:\s+(HQ_HQ3|PCD|NQ|HQ)\s+(\S+))?"
        r"(?:\s+(\d+\.?\d*))?(?:\s+(\d+\.?\d*))?(?:\s+(\d+\.?\d*))?"
        r"(?:\s+([\w_]+))?\s*$", re.IGNORECASE)
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line or len(re.findall(time_pat, line)) < 2:
            continue
        m = row_re.match(line)
        if m:
            notes,tf,tt,total,bt,diam,mf,mt,mto,code = m.groups()
            rows.append({
                "source_file": filename, "contractor": contractor,
                "date": header.get("date",""), "hole_num": header.get("hole_num",""),
                "site_name": header.get("site_name",""), "location": header.get("location",""),
                "drill_rig": header.get("drill_rig",""), "client": header.get("client",""),
                "contract": header.get("contract",""), "shift": header.get("shift",""),
                "time_from": tf, "time_to": tt, "total_time": total,
                "bit_type": bt or "", "diameter": diam or "",
                "metres_from": float(mf) if mf else None,
                "metres_to":   float(mt) if mt else None,
                "total_metres":float(mto) if mto else None,
                "code": code or "", "notes": notes.strip(),
                "rate_year": None, "unit_rate": None, "quantity": None,
                "line_cost": None, "rate_basis": None, "po_id": None,
            })
    return rows


def parse_consumables(text, header, filename, contractor):
    rows = []
    m = re.search(r"CONSUMABLES\s*\n(.*?)(?:ALLIANZ REPRESENTATIVE|$)", text, re.DOTALL|re.IGNORECASE)
    if not m: return rows
    for cm in re.finditer(
        r"^(.+?)\s+(drum|bucket|bags?|tins?|slurry|Kgs?|Ltrs?|Mtrs?|cube)\s+(\d+)\s+(\S+)\s*$",
        m.group(1), re.IGNORECASE|re.MULTILINE
    ):
        rows.append({"source_file":filename,"contractor":contractor,
                     "date":header.get("date",""),"hole_num":header.get("hole_num",""),
                     "site_name":header.get("site_name",""),
                     "consumable":cm.group(1).strip(),"type":cm.group(2).strip(),
                     "quantity":cm.group(3).strip(),"unit":cm.group(4).strip()})
    return rows


def parse_crew(text, header, filename, contractor):
    rows = []
    for role in ["Rig Manager","Driller","Trainee Driller","Offsider","Operator"]:
        m = re.search(rf"{role}\s+([\w\s\.]+?)\s+(\d+)\s", text, re.IGNORECASE)
        if m:
            rows.append({"source_file":filename,"contractor":contractor,
                         "date":header.get("date",""),"hole_num":header.get("hole_num",""),
                         "site_name":header.get("site_name",""),
                         "role":role,"name":m.group(1).strip(),"hours":m.group(2)})
    return rows


# ── API ───────────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "ok", "app": "DrillOps API v3", "contractors": [c[0] for c in CONTRACTORS]}


@app.get("/contractors")
def get_contractors():
    return [{"name": c[0], "short_code": c[1]} for c in CONTRACTORS]


@app.post("/import")
async def import_pdf(
    file: UploadFile = File(...),
    contractor: str = Form(default="Allianz Drilling"),
):
    filename = file.filename
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM imported_files WHERE filename=%s AND contractor=%s",
                        (filename, contractor))
            if cur.fetchone():
                return {"status":"skipped","filename":filename,"rows":0,"contractor":contractor}

    content = await file.read()
    try:
        with pdfplumber.open(BytesIO(content)) as pdf:
            text = "\n".join(p.extract_text() or "" for p in pdf.pages)
    except Exception as e:
        raise HTTPException(400, f"Could not read PDF: {e}")

    header = parse_header(text)
    acts   = parse_activities(text, header, filename, contractor)
    cons   = parse_consumables(text, header, filename, contractor)
    crew   = parse_crew(text, header, filename, contractor)

    with get_conn() as conn:
        with conn.cursor() as cur:
            acts = [price_activity(cur, row, contractor) for row in acts]
            if acts:
                psycopg2.extras.execute_batch(cur, """
                    INSERT INTO activities
                    (source_file,contractor,date,hole_num,site_name,location,drill_rig,
                     client,contract,shift,time_from,time_to,total_time,bit_type,diameter,
                     metres_from,metres_to,total_metres,code,notes,
                     rate_year,unit_rate,quantity,line_cost,rate_basis,po_id)
                    VALUES
                    (%(source_file)s,%(contractor)s,%(date)s,%(hole_num)s,%(site_name)s,
                     %(location)s,%(drill_rig)s,%(client)s,%(contract)s,%(shift)s,
                     %(time_from)s,%(time_to)s,%(total_time)s,%(bit_type)s,%(diameter)s,
                     %(metres_from)s,%(metres_to)s,%(total_metres)s,%(code)s,%(notes)s,
                     %(rate_year)s,%(unit_rate)s,%(quantity)s,%(line_cost)s,%(rate_basis)s,%(po_id)s)
                """, acts)
            if cons:
                psycopg2.extras.execute_batch(cur, """
                    INSERT INTO consumables (source_file,contractor,date,hole_num,site_name,consumable,type,quantity,unit)
                    VALUES (%(source_file)s,%(contractor)s,%(date)s,%(hole_num)s,%(site_name)s,%(consumable)s,%(type)s,%(quantity)s,%(unit)s)
                """, cons)
            if crew:
                psycopg2.extras.execute_batch(cur, """
                    INSERT INTO crew (source_file,contractor,date,hole_num,site_name,role,name,hours)
                    VALUES (%(source_file)s,%(contractor)s,%(date)s,%(hole_num)s,%(site_name)s,%(role)s,%(name)s,%(hours)s)
                """, crew)
            cur.execute("INSERT INTO imported_files (filename,contractor) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                        (filename, contractor))
        conn.commit()

    return {"status":"imported","filename":filename,"rows":len(acts),
            "contractor":contractor,
            "total_cost":round(sum(r["line_cost"] for r in acts if r["line_cost"]),2)}


@app.get("/activities")
def get_activities(
    contractor: str = Query(...),
    dates:  Optional[str] = Query(None),
    holes:  Optional[str] = Query(None),
    sites:  Optional[str] = Query(None),
    codes:  Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    conds = ["contractor=%(contractor)s"]
    params = {"contractor": contractor}
    if dates: conds.append("date=ANY(%(dates)s)");     params["dates"]=dates.split(",")
    if holes: conds.append("hole_num=ANY(%(holes)s)"); params["holes"]=holes.split(",")
    if sites: conds.append("site_name=ANY(%(sites)s)");params["sites"]=sites.split(",")
    if codes: conds.append("code=ANY(%(codes)s)");     params["codes"]=codes.split(",")
    if search:
        conds.append("(notes ILIKE %(search)s OR code ILIKE %(search)s)")
        params["search"] = f"%{search}%"
    q = f"SELECT * FROM activities WHERE {' AND '.join(conds)} ORDER BY date,time_from"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q, params)
            return [dict(r) for r in cur.fetchall()]


@app.patch("/activities/{row_id}")
def update_activity(row_id: int, payload: dict):
    safe = {"date","hole_num","site_name","location","drill_rig","client","contract","shift",
            "time_from","time_to","total_time","bit_type","diameter",
            "metres_from","metres_to","total_metres","code","notes",
            "rate_year","unit_rate","quantity","line_cost","rate_basis","po_id"}
    updates = {k:v for k,v in payload.items() if k in safe}
    if not updates: raise HTTPException(400,"No valid fields")
    set_clause = ",".join(f"{k}=%({k})s" for k in updates)
    updates["row_id"] = row_id
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE activities SET {set_clause} WHERE id=%(row_id)s", updates)
        conn.commit()
    return {"status":"updated"}


@app.get("/consumables")
def get_consumables(contractor: str = Query(...), dates: Optional[str] = Query(None)):
    q = "SELECT * FROM consumables WHERE contractor=%(contractor)s"
    p = {"contractor": contractor}
    if dates: q += " AND date=ANY(%(dates)s)"; p["dates"]=dates.split(",")
    q += " ORDER BY date"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q,p); return [dict(r) for r in cur.fetchall()]


@app.get("/crew")
def get_crew(contractor: str = Query(...), dates: Optional[str] = Query(None)):
    q = "SELECT * FROM crew WHERE contractor=%(contractor)s"
    p = {"contractor": contractor}
    if dates: q += " AND date=ANY(%(dates)s)"; p["dates"]=dates.split(",")
    q += " ORDER BY date"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q,p); return [dict(r) for r in cur.fetchall()]


@app.get("/filters")
def get_filters(contractor: str = Query(...)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            def q(sql): cur.execute(sql,(contractor,)); return [r[0] for r in cur.fetchall()]
            dates = q("SELECT DISTINCT date FROM activities WHERE contractor=%s ORDER BY date")
            holes = q("SELECT DISTINCT hole_num FROM activities WHERE contractor=%s ORDER BY hole_num")
            sites = q("SELECT DISTINCT site_name FROM activities WHERE contractor=%s ORDER BY site_name")
            codes = q("SELECT DISTINCT code FROM activities WHERE contractor=%s AND code!='' ORDER BY code")
            cur.execute("SELECT COUNT(*) AS n FROM activities WHERE contractor=%s",(contractor,))
            total = cur.fetchone()["n"]
    return {"dates":dates,"holes":holes,"sites":sites,"codes":codes,"total_rows":total}


@app.get("/analytics")
def get_analytics(contractor: str = Query(...), hole: Optional[str] = Query(None)):
    q = "SELECT * FROM activities WHERE contractor=%(contractor)s"
    p = {"contractor": contractor}
    if hole and hole != "all":
        q += " AND hole_num=%(hole)s"; p["hole"]=hole
    with get_conn() as conn:
        df = pd.read_sql(q, conn, params=p)

    if df.empty:
        return {"kpis":{},"daily_categories":[],"drill_runs":[],"anomalies":[],"heatmap":[]}

    def toh(t):
        try: h,m=str(t).split(":"); return int(h)+int(m)/60
        except: return 0.0

    df["hours"] = df["total_time"].apply(toh)

    def cat(c):
        if not c: return "Other"
        if any(p in c for p in ["Drill_Core","Drill_Chip"]): return "Productive Drilling"
        if "Repair" in c: return "Repairs"
        if any(p in c for p in ["Standby","Grout","Cement_Set","AAC","Logger","Sumps"]): return "Standby / Delays"
        if "Circulation" in c: return "Circulation"
        if "Travel" in c: return "Travel"
        if any(p in c for p in ["Safety","Training","Prestart"]): return "Safety & Admin"
        if "Tripping" in c: return "Tripping Rods"
        return "Other"

    df["category"] = df["code"].apply(cat)
    th = df["hours"].sum()
    dh = df[df["category"]=="Productive Drilling"]["hours"].sum()
    rh = df[df["category"]=="Repairs"]["hours"].sum()
    sh = df[df["category"]=="Standby / Delays"]["hours"].sum()
    tm = df["total_metres"].dropna().sum()
    tc = float(df["line_cost"].dropna().sum())

    daily = df.groupby(["date","category"])["hours"].sum().reset_index()
    runs  = df[df["total_metres"].notna()&(df["total_metres"]>0)].copy()
    runs  = runs.sort_values(["date","time_from"])
    runs["cumulative"] = runs.groupby("hole_num")["total_metres"].cumsum()

    anomalies = []
    for date,day in df.groupby("date"):
        d2=day[day["category"]=="Productive Drilling"]["hours"].sum()
        r2=day[day["category"]=="Repairs"]["hours"].sum()
        s2=day[day["category"]=="Standby / Delays"]["hours"].sum()
        h2=day["hole_num"].iloc[0] if len(day) else ""
        if d2==0: anomalies.append({"date":date,"hole":h2,"type":"No Drilling","severity":"critical","detail":"Zero productive drilling hours"})
        if r2>=2: anomalies.append({"date":date,"hole":h2,"type":"High Repairs","severity":"warning","detail":f"{r2:.1f}h repairs"})
        if s2>=3: anomalies.append({"date":date,"hole":h2,"type":"High Standby","severity":"caution","detail":f"{s2:.1f}h standby"})
    for _,r in df[df["total_metres"].notna()&(df["total_metres"]<1)&(df["total_metres"]>0)].iterrows():
        anomalies.append({"date":r["date"],"hole":r["hole_num"],"type":"Short Run","severity":"info","detail":f"{r['total_metres']}m"})
    for _,r in df[df["code"].str.contains("Circulation_Lost",na=False)].iterrows():
        anomalies.append({"date":r["date"],"hole":r["hole_num"],"type":"Lost Circulation","severity":"critical","detail":r["notes"] or "Lost returns"})

    npt = df[df["category"].isin(["Repairs","Standby / Delays","Circulation"])].groupby(["date","category"])["hours"].sum().reset_index()

    return {
        "kpis": {"total_hours":round(th,1),"drill_hours":round(dh,1),"repair_hours":round(rh,1),
                 "delay_hours":round(sh,1),"total_metres":round(tm,1),"efficiency":round(dh/th*100,1) if th else 0,
                 "total_cost":round(tc,2)},
        "daily_categories": daily.to_dict(orient="records"),
        "drill_runs": runs[["date","hole_num","time_from","total_metres","cumulative","notes"]].to_dict(orient="records"),
        "anomalies": anomalies,
        "heatmap": npt.to_dict(orient="records"),
    }


@app.get("/costing")
def get_costing(contractor: str = Query(...), holes: Optional[str]=Query(None), dates: Optional[str]=Query(None)):
    conds = ["contractor=%(contractor)s","line_cost IS NOT NULL"]
    p = {"contractor": contractor}
    if holes: conds.append("hole_num=ANY(%(holes)s)"); p["holes"]=holes.split(",")
    if dates: conds.append("date=ANY(%(dates)s)");     p["dates"]=dates.split(",")
    where = " AND ".join(conds)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT hole_num,
                    SUM(line_cost) AS total_cost,
                    SUM(CASE WHEN code IN ('Drill_Core','Drill_Chip_or_Open_hole') THEN line_cost ELSE 0 END) AS drilling_cost,
                    SUM(CASE WHEN code NOT IN ('Drill_Core','Drill_Chip_or_Open_hole') THEN line_cost ELSE 0 END) AS non_drilling_cost,
                    SUM(total_metres) AS total_metres, COUNT(*) AS activity_count
                FROM activities WHERE {where} GROUP BY hole_num ORDER BY hole_num
            """, p)
            by_hole = [dict(r) for r in cur.fetchall()]
            cur.execute(f"""
                SELECT date,hole_num,SUM(line_cost) AS total_cost,SUM(total_metres) AS total_metres
                FROM activities WHERE {where} GROUP BY date,hole_num ORDER BY date
            """, p)
            by_date = [dict(r) for r in cur.fetchall()]
            cur.execute(f"SELECT SUM(line_cost) AS g FROM activities WHERE {where}", p)
            grand = float(cur.fetchone()["g"] or 0)
    return {"by_hole":by_hole,"by_date":by_date,"grand_total":grand}


@app.get("/rates/years")
def get_rate_years(contractor: str = Query(...)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT year FROM drilling_rates WHERE contractor=%s ORDER BY year",(contractor,))
            dy = [r["year"] for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT year FROM hourly_rates WHERE contractor=%s ORDER BY year",(contractor,))
            hy = [r["year"] for r in cur.fetchall()]
    return {"years": sorted(set(dy+hy))}


@app.get("/rates/drilling")
def get_drilling_rates(contractor: str = Query(...), year: Optional[str]=Query(None)):
    q = "SELECT * FROM drilling_rates WHERE contractor=%(contractor)s"
    p = {"contractor":contractor}
    if year: q += " AND year=%(year)s"; p["year"]=year
    q += " ORDER BY year,bit_type,depth_from"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q,p); return [dict(r) for r in cur.fetchall()]


@app.get("/rates/hourly")
def get_hourly_rates(contractor: str = Query(...), year: Optional[str]=Query(None)):
    q = "SELECT * FROM hourly_rates WHERE contractor=%(contractor)s"
    p = {"contractor":contractor}
    if year: q += " AND year=%(year)s"; p["year"]=year
    q += " ORDER BY year,code"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q,p); return [dict(r) for r in cur.fetchall()]


@app.patch("/rates/drilling/{rid}")
def update_drilling_rate(rid: int, payload: dict):
    safe = {"year","bit_type","depth_from","depth_to","rate"}
    u = {k:v for k,v in payload.items() if k in safe}
    if not u: raise HTTPException(400,"No valid fields")
    u["rid"]=rid
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE drilling_rates SET {','.join(f'{k}=%('+k+')s' for k in u if k!='rid')} WHERE id=%(rid)s", u)
        conn.commit()
    return {"status":"updated"}


@app.patch("/rates/hourly/{rid}")
def update_hourly_rate(rid: int, payload: dict):
    safe = {"year","code","description","rate","unit"}
    u = {k:v for k,v in payload.items() if k in safe}
    if not u: raise HTTPException(400,"No valid fields")
    u["rid"]=rid
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE hourly_rates SET {','.join(f'{k}=%('+k+')s' for k in u if k!='rid')} WHERE id=%(rid)s", u)
        conn.commit()
    return {"status":"updated"}


@app.post("/rates/drilling")
def add_drilling_rate(payload: dict):
    req = {"contractor","year","bit_type","depth_from","depth_to","rate"}
    if not req.issubset(payload): raise HTTPException(400,f"Required: {req}")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO drilling_rates (contractor,year,bit_type,depth_from,depth_to,rate) VALUES (%(contractor)s,%(year)s,%(bit_type)s,%(depth_from)s,%(depth_to)s,%(rate)s) RETURNING id", payload)
            nid = cur.fetchone()["id"]
        conn.commit()
    return {"status":"created","id":nid}


@app.post("/rates/hourly")
def add_hourly_rate(payload: dict):
    req = {"contractor","year","code","rate","unit"}
    if not req.issubset(payload): raise HTTPException(400,f"Required: {req}")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO hourly_rates (contractor,year,code,description,rate,unit) VALUES (%(contractor)s,%(year)s,%(code)s,%(description)s,%(rate)s,%(unit)s) RETURNING id",
                        {**{"description":""},**payload})
            nid = cur.fetchone()["id"]
        conn.commit()
    return {"status":"created","id":nid}


@app.delete("/rates/drilling/{rid}")
def del_drilling_rate(rid: int):
    with get_conn() as conn:
        with conn.cursor() as cur: cur.execute("DELETE FROM drilling_rates WHERE id=%s",(rid,))
        conn.commit()
    return {"status":"deleted"}


@app.delete("/rates/hourly/{rid}")
def del_hourly_rate(rid: int):
    with get_conn() as conn:
        with conn.cursor() as cur: cur.execute("DELETE FROM hourly_rates WHERE id=%s",(rid,))
        conn.commit()
    return {"status":"deleted"}


@app.get("/purchase_orders")
def get_pos(contractor: str = Query(...)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT p.*, COALESCE(SUM(a.line_cost),0) AS spent_to_date,
                       p.po_value - COALESCE(SUM(a.line_cost),0) AS remaining
                FROM purchase_orders p
                LEFT JOIN activities a ON a.po_id=p.id AND a.contractor=p.contractor
                WHERE p.contractor=%s GROUP BY p.id ORDER BY p.issue_date DESC
            """, (contractor,))
            return [dict(r) for r in cur.fetchall()]


@app.post("/purchase_orders")
def add_po(payload: dict):
    if "po_number" not in payload: raise HTTPException(400,"po_number required")
    if "contractor" not in payload: raise HTTPException(400,"contractor required")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO purchase_orders (po_number,contractor,description,issue_date,expiry_date,po_value,status,notes)
                VALUES (%(po_number)s,%(contractor)s,%(description)s,%(issue_date)s,%(expiry_date)s,%(po_value)s,%(status)s,%(notes)s)
                RETURNING id
            """, {"po_number":payload["po_number"],"contractor":payload["contractor"],
                  "description":payload.get("description",""),"issue_date":payload.get("issue_date",""),
                  "expiry_date":payload.get("expiry_date",""),"po_value":payload.get("po_value",0),
                  "status":payload.get("status","Active"),"notes":payload.get("notes","")})
            nid = cur.fetchone()["id"]
        conn.commit()
    return {"status":"created","id":nid}


@app.patch("/purchase_orders/{po_id}")
def update_po(po_id: int, payload: dict):
    safe = {"po_number","description","issue_date","expiry_date","po_value","status","notes"}
    u = {k:v for k,v in payload.items() if k in safe}
    if not u: raise HTTPException(400,"No valid fields")
    u["po_id"]=po_id
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE purchase_orders SET {','.join(f'{k}=%('+k+')s' for k in u if k!='po_id')} WHERE id=%(po_id)s", u)
        conn.commit()
    return {"status":"updated"}


@app.delete("/purchase_orders/{po_id}")
def delete_po(po_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur: cur.execute("DELETE FROM purchase_orders WHERE id=%s",(po_id,))
        conn.commit()
    return {"status":"deleted"}


@app.delete("/reset")
def reset_db(contractor: Optional[str]=Query(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            if contractor:
                for tbl in ("activities","consumables","crew","imported_files"):
                    cur.execute(f"DELETE FROM {tbl} WHERE contractor=%s",(contractor,))
            else:
                for tbl in ("activities","consumables","crew","imported_files","purchase_orders"):
                    cur.execute(f"DELETE FROM {tbl}")
        conn.commit()
    return {"status":"cleared","contractor":contractor or "all"}
