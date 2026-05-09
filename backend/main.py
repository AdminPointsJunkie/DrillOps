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
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Form, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="DrillOps API", version="3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
                try:
                    cur.execute(f"ALTER TABLE activities ADD COLUMN IF NOT EXISTS {col} {typedef}")
                except Exception:
                    conn.rollback()

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
            try:
                cur.execute("ALTER TABLE consumables ADD COLUMN IF NOT EXISTS contractor TEXT DEFAULT 'Allianz Drilling'")
            except Exception:
                conn.rollback()

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
            try:
                cur.execute("ALTER TABLE crew ADD COLUMN IF NOT EXISTS contractor TEXT DEFAULT 'Allianz Drilling'")
            except Exception:
                conn.rollback()

            cur.execute("""
                CREATE TABLE IF NOT EXISTS imported_files (
                    filename   TEXT,
                    contractor TEXT DEFAULT 'Allianz Drilling',
                    PRIMARY KEY (filename, contractor)
                )
            """)
            try:
                cur.execute("ALTER TABLE imported_files ADD COLUMN IF NOT EXISTS contractor TEXT DEFAULT 'Allianz Drilling'")
            except Exception:
                conn.rollback()

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
            try:
                cur.execute("ALTER TABLE drilling_rates ADD COLUMN IF NOT EXISTS contractor TEXT NOT NULL DEFAULT 'Allianz Drilling'")
            except Exception:
                conn.rollback()

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
            try:
                cur.execute("ALTER TABLE hourly_rates ADD COLUMN IF NOT EXISTS contractor TEXT NOT NULL DEFAULT 'Allianz Drilling'")
            except Exception:
                conn.rollback()

            cur.execute("""
                CREATE TABLE IF NOT EXISTS boreholes (
                    id              SERIAL PRIMARY KEY,
                    contractor      TEXT NOT NULL DEFAULT 'Allianz Drilling',
                    project         TEXT,
                    planned_year    TEXT,
                    site_id         TEXT,
                    hole_id         TEXT NOT NULL,
                    drill_order     INTEGER,
                    days_budgeted   FLOAT,
                    bh_type         TEXT,
                    bit_type        TEXT,
                    purpose         TEXT,
                    easting         FLOAT,
                    northing        FLOAT,
                    rl              FLOAT,
                    chip_depth      FLOAT,
                    eoh_depth       FLOAT,
                    total_core      FLOAT,
                    seam_tk         FLOAT,
                    lat             FLOAT,
                    lng             FLOAT,
                    status          TEXT DEFAULT 'Planned',
                    notes           TEXT,
                    budget_total    FLOAT,
                    actual_total    FLOAT,
                    UNIQUE(contractor, hole_id)
                )
            """)
            for col, typedef in [
                ("project", "TEXT"),
                ("planned_year", "TEXT"),
                ("site_id", "TEXT"),
                ("eoh_depth", "FLOAT"),
                ("total_core", "FLOAT"),
            ]:
                try:
                    cur.execute(f"ALTER TABLE boreholes ADD COLUMN IF NOT EXISTS {col} {typedef}")
                except Exception:
                    conn.rollback()

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

            cur.execute("""
                CREATE TABLE IF NOT EXISTS contractors (
                    id         SERIAL PRIMARY KEY,
                    name       TEXT NOT NULL UNIQUE,
                    short_code TEXT,
                    active     BOOLEAN DEFAULT TRUE
                )
            """)

            # ── Invoices ──────────────────────────────────────────────────────
            cur.execute("""
                CREATE TABLE IF NOT EXISTS invoices (
                    id              SERIAL PRIMARY KEY,
                    source_file     TEXT,
                    contractor      TEXT NOT NULL DEFAULT 'Allianz Drilling',
                    invoice_number  TEXT,
                    invoice_date    TEXT,
                    due_date        TEXT,
                    po_reference    TEXT,
                    client          TEXT,
                    abn             TEXT,
                    subtotal        FLOAT DEFAULT 0,
                    gst             FLOAT DEFAULT 0,
                    total_aud       FLOAT DEFAULT 0,
                    amount_paid     FLOAT DEFAULT 0,
                    amount_due      FLOAT DEFAULT 0,
                    status          TEXT DEFAULT 'Unpaid',
                    notes           TEXT,
                    pdf_data        BYTEA
                )
            """)
            try:
                cur.execute("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pdf_data BYTEA")
            except Exception:
                conn.rollback()

            # ── Invoice line items ────────────────────────────────────────────
            cur.execute("""
                CREATE TABLE IF NOT EXISTS invoice_lines (
                    id              SERIAL PRIMARY KEY,
                    invoice_id      INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
                    contractor      TEXT NOT NULL DEFAULT 'Allianz Drilling',
                    invoice_number  TEXT,
                    description     TEXT,
                    quantity        FLOAT DEFAULT 0,
                    unit_price      FLOAT DEFAULT 0,
                    gst_rate        TEXT DEFAULT '10%',
                    amount          FLOAT DEFAULT 0,
                    category        TEXT,
                    matched_eos_cost FLOAT,
                    variance        FLOAT,
                    match_status    TEXT DEFAULT 'unmatched'
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS invoice_imports (
                    filename  TEXT,
                    contractor TEXT DEFAULT 'Allianz Drilling',
                    PRIMARY KEY (filename, contractor)
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
    """Return contractors from DB, falling back to defaults if empty."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM contractors ORDER BY name")
            rows = [dict(r) for r in cur.fetchall()]
    if not rows:
        # Seed defaults on first call
        with get_conn() as conn:
            with conn.cursor() as cur:
                for name, code in CONTRACTORS:
                    cur.execute("""
                        INSERT INTO contractors (name, short_code)
                        VALUES (%s, %s) ON CONFLICT (name) DO NOTHING
                    """, (name, code))
            conn.commit()
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM contractors ORDER BY name")
                rows = [dict(r) for r in cur.fetchall()]
    return rows


@app.post("/contractors")
async def add_contractor(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")
    name = payload.get("name", "").strip()
    code = payload.get("short_code", "").strip().upper() or name[:3].upper()
    if not name:
        raise HTTPException(400, "name is required")
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO contractors (name, short_code, active)
                    VALUES (%s, %s, TRUE)
                    ON CONFLICT (name) DO UPDATE SET short_code=EXCLUDED.short_code
                    RETURNING id
                """, (name, code))
                new_id = cur.fetchone()["id"]
            conn.commit()
        return {"status": "created", "id": new_id, "name": name, "short_code": code}
    except Exception as e:
        raise HTTPException(500, f"Failed to add contractor: {str(e)}")


@app.delete("/contractors/{name}")
def remove_contractor(name: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM contractors WHERE name=%s", (name,))
        conn.commit()
    return {"status": "deleted"}


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
async def update_activity(row_id: int, request: Request):
    payload = await request.json()
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
            cur.execute("SELECT DISTINCT date FROM activities WHERE contractor=%s AND date IS NOT NULL ORDER BY date", (contractor,))
            dates = [r["date"] for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT hole_num FROM activities WHERE contractor=%s AND hole_num IS NOT NULL ORDER BY hole_num", (contractor,))
            holes = [r["hole_num"] for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT site_name FROM activities WHERE contractor=%s AND site_name IS NOT NULL ORDER BY site_name", (contractor,))
            sites = [r["site_name"] for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT code FROM activities WHERE contractor=%s AND code!='' ORDER BY code", (contractor,))
            codes = [r["code"] for r in cur.fetchall()]
            cur.execute("SELECT COUNT(*) AS n FROM activities WHERE contractor=%s", (contractor,))
            total = cur.fetchone()["n"]
    return {"dates": dates, "holes": holes, "sites": sites, "codes": codes, "total_rows": total}


@app.get("/analytics")
def get_analytics(contractor: str = Query(...), hole: Optional[str] = Query(None)):
    try:
        q = "SELECT * FROM activities WHERE contractor=%(contractor)s"
        p = {"contractor": contractor}
        if hole and hole != "all":
            q += " AND hole_num=%(hole)s"; p["hole"] = hole

        with psycopg2.connect(DATABASE_URL) as conn:
            df = pd.read_sql(q, conn, params=p)

        if df.empty:
            return {"kpis":{},"daily_categories":[],"drill_runs":[],"anomalies":[],"heatmap":[]}

        def toh(t):
            try: h,m=str(t).split(":"); return int(h)+int(m)/60
            except: return 0.0

        df["hours"] = df["total_time"].apply(toh)

        def cat(c):
            if not c: return "Other"
            if any(x in c for x in ["Drill_Core","Drill_Chip"]): return "Productive Drilling"
            if "Repair" in c: return "Repairs"
            if any(x in c for x in ["Standby","Grout","Cement_Set","AAC","Logger","Sumps"]): return "Standby / Delays"
            if "Circulation" in c: return "Circulation"
            if "Travel" in c: return "Travel"
            if any(x in c for x in ["Safety","Training","Prestart"]): return "Safety & Admin"
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

        runs = df[df["total_metres"].notna() & (df["total_metres"]>0)].copy()
        runs = runs.sort_values(["date","time_from"])
        runs["cumulative"] = runs.groupby("hole_num")["total_metres"].cumsum()

        anomalies = []
        for date, day in df.groupby("date"):
            d2 = day[day["category"]=="Productive Drilling"]["hours"].sum()
            r2 = day[day["category"]=="Repairs"]["hours"].sum()
            s2 = day[day["category"]=="Standby / Delays"]["hours"].sum()
            h2 = day["hole_num"].iloc[0] if len(day) else ""
            if d2==0: anomalies.append({"date":date,"hole":h2,"type":"No Drilling","severity":"critical","detail":"Zero productive drilling hours"})
            if r2>=2: anomalies.append({"date":date,"hole":h2,"type":"High Repairs","severity":"warning","detail":f"{r2:.1f}h repairs"})
            if s2>=3: anomalies.append({"date":date,"hole":h2,"type":"High Standby","severity":"caution","detail":f"{s2:.1f}h standby"})
        for _,r in df[df["total_metres"].notna()&(df["total_metres"]<1)&(df["total_metres"]>0)].iterrows():
            anomalies.append({"date":r["date"],"hole":r["hole_num"],"type":"Short Run","severity":"info","detail":f"{r['total_metres']}m"})
        for _,r in df[df["code"].str.contains("Circulation_Lost",na=False)].iterrows():
            anomalies.append({"date":r["date"],"hole":r["hole_num"],"type":"Lost Circulation","severity":"critical","detail":r["notes"] or "Lost returns"})

        npt = df[df["category"].isin(["Repairs","Standby / Delays","Circulation"])].groupby(["date","category"])["hours"].sum().reset_index()

        run_cols = [c for c in ["date","hole_num","time_from","total_metres","cumulative","notes"] if c in runs.columns]

        return {
            "kpis": {
                "total_hours": round(th,1), "drill_hours": round(dh,1),
                "repair_hours": round(rh,1), "delay_hours": round(sh,1),
                "total_metres": round(tm,1),
                "efficiency": round(dh/th*100,1) if th else 0,
                "total_cost": round(tc,2),
            },
            "daily_categories": daily.to_dict(orient="records"),
            "drill_runs": runs[run_cols].to_dict(orient="records"),
            "anomalies": anomalies,
            "heatmap": npt.to_dict(orient="records"),
        }
    except Exception as e:
        raise HTTPException(500, f"Analytics error: {str(e)}")


@app.get("/costing")
def get_costing(contractor: str = Query(...), holes: Optional[str]=Query(None), dates: Optional[str]=Query(None)):
    try:
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
                    SELECT date, hole_num, SUM(line_cost) AS total_cost, SUM(total_metres) AS total_metres
                    FROM activities WHERE {where} GROUP BY date, hole_num ORDER BY date
                """, p)
                by_date = [dict(r) for r in cur.fetchall()]
                cur.execute(f"SELECT SUM(line_cost) AS g FROM activities WHERE {where}", p)
                grand = float(cur.fetchone()["g"] or 0)
        return {"by_hole": by_hole, "by_date": by_date, "grand_total": grand}
    except Exception as e:
        raise HTTPException(500, f"Costing error: {str(e)}")


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
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, po_number, contractor, description,
                           issue_date, expiry_date, po_value, status, notes
                    FROM purchase_orders
                    WHERE contractor=%s
                    ORDER BY issue_date DESC
                """, (contractor,))
                pos = [dict(r) for r in cur.fetchall()]

                # Add spent/remaining for each PO
                for po in pos:
                    cur.execute("""
                        SELECT COALESCE(SUM(line_cost),0) AS spent
                        FROM activities
                        WHERE po_id=%s AND contractor=%s AND line_cost IS NOT NULL
                    """, (po["id"], contractor))
                    spent = float(cur.fetchone()["spent"] or 0)
                    po["spent_to_date"] = spent
                    po["remaining"] = (po["po_value"] or 0) - spent

                return pos
    except Exception as e:
        raise HTTPException(500, f"PO error: {str(e)}")


@app.post("/purchase_orders")
async def add_po(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")
    if "po_number" not in payload: raise HTTPException(400,"po_number required")
    if "contractor" not in payload: raise HTTPException(400,"contractor required")
    try:
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
    except Exception as e:
        raise HTTPException(500, f"Failed to create PO: {str(e)}")


@app.patch("/purchase_orders/{po_id}")
async def update_po(po_id: int, request: Request):
    payload = await request.json()
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



# ── Invoice PDF Parser ────────────────────────────────────────────────────────

# Map invoice line descriptions to EOS activity categories for matching
INV_CATEGORY_MAP = [
    # Drilling metres
    ("HQ/HQ3",          "drilling_metres"),
    ("HQ_HQ3",          "drilling_metres"),
    ("PCD",             "drilling_metres"),
    ("Hammer",          "drilling_metres"),
    # Active rate items — match both spaced and stripped
    ("tripping",        "active"),
    ("casing",          "active"),
    ("changingdrilling","active"),
    ("changing drilling","active"),
    ("flushing",        "active"),
    ("circulation",     "active"),
    ("reaming",         "active"),
    ("cementing",       "active"),
    ("mixingdrilling",  "active"),
    ("mixing drilling", "active"),
    ("measuringand",    "active"),
    ("measuring and",   "active"),
    ("T-Piece",         "active"),
    ("blooey",          "active"),
    ("repairs",         "active"),
    ("unplanned",       "active"),
    # Standby / inactive
    ("standby",         "standby"),
    ("waiting",         "standby"),
    # Travel / setup
    ("travel",          "travel"),
    ("movingbetween",   "travel"),
    ("moving between",  "travel"),
    ("settingup",       "setup"),
    ("packingup",       "setup"),
    ("setting up",      "setup"),
    ("packing up",      "setup"),
    # Safety / admin
    ("safety",          "safety"),
    ("pre-start",       "safety"),
    ("prestart",        "safety"),
    ("induction",       "safety"),
    ("training",        "safety"),
    ("toolbox",         "safety"),
    ("authorisation",   "safety"),
    ("consumables from local", "active"),
    ("consumablesfromlocal",   "active"),
    # Equipment day rates
    ("watercart",       "equipment"),
    ("water cart",      "equipment"),
    ("backhoe",         "equipment"),
    # Consumables
    ("AMC",             "consumable"),
    ("cement",          "consumable"),
    ("PVC",             "consumable"),
    ("MUDLOGIC",        "consumable"),
    ("foam",            "consumable"),
    ("slurry",          "consumable"),
    ("GRIP",            "consumable"),
    ("SUPERLUBE",       "consumable"),
    ("SUPERFOAM",       "consumable"),
    ("HARD SET",        "consumable"),
    ("HARDSET",         "consumable"),
    ("TORQ",            "consumable"),
    ("SWELL",           "consumable"),
    ("CR650",           "consumable"),
    # Mobilisation
    ("mobilisation",    "mobilisation"),
    ("mobilization",    "mobilisation"),
    ("demobilisation",  "mobilisation"),
    ("compliance",      "compliance"),
]

def categorise_invoice_line(description: str) -> str:
    dl = description.lower()
    for keyword, cat in INV_CATEGORY_MAP:
        if keyword.lower() in dl:
            return cat
    return "other"


def parse_invoice_pdf(text: str, filename: str, contractor: str) -> dict:
    """Parse an Allianz-style tax invoice PDF.
    Note: pdfplumber strips spaces from words so 'Invoice Number' becomes 'InvoiceNumber'.
    """

    def find(pattern, default=""):
        m = re.search(pattern, text, re.IGNORECASE)
        return m.group(1).strip() if m else default

    # Header — pdfplumber strips spaces, layout is non-standard
    # "InvoiceNumber NOOSAVILLEQLD4566\nFitzroyAustraliaResourcesPtyLtd INV-0509"
    invoice_number = find(r"(INV-\d+)")  # just find it anywhere
    invoice_date   = find(r"Invoice\s*Date\s*\n?\s*(\d+\s*\w+\s*\d{4})")
    if not invoice_date:
        # format: "InvoiceDate\n3Apr2026" or "24Feb2026"
        invoice_date = find(r"InvoiceDate\s*\n?\s*(\d+\w+\d{4})")
    due_date       = find(r"Due\s*Date[:\s]+(\d+\s+\w+\s+\d{4})")
    po_reference   = (find(r"Reference\s*\n?\s*(Purchase\s*Order\s*\S+)") or
                      find(r"Reference\s*\n?\s*(PO\s+\S+)") or
                      find(r"PurchaseOrder(\S+)") or
                      find(r"(C\d{6,}|F\d{6,})"))
    client         = find(r"(Fitzroy[\w\s]+?(?:Pty\s*Ltd|Resources\s*Pty\s*Ltd))")
    abn_raw        = find(r"ABN\s*\n?\s*([\d\s]{10,})")
    abn            = abn_raw.strip() if abn_raw else ""

    # Totals — handle both "Subtotal" and no-space versions
    def find_amount(pattern):
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            try: return float(m.group(1).replace(",",""))
            except: return 0.0
        return 0.0

    subtotal    = find_amount(r"Subtotal\s+([\d,]+\.?\d*)")
    gst         = find_amount(r"TOTAL\s*GST\s*10%\s+([\d,]+\.?\d*)")
    total_aud   = find_amount(r"TOTAL\s*AUD\s+([\d,]+\.?\d*)")
    amount_paid = find_amount(r"Less\s*Amount\s*Paid\s+([\d,]+\.?\d*)")
    amount_due  = find_amount(r"AMOUNT\s*DUE\s*AUD\s+([\d,]+\.?\d*)")

    # Determine status
    if amount_paid > 0 and amount_due == 0:
        status = "Paid"
    elif amount_due > 0 and amount_paid > 0:
        status = "Partial"
    elif amount_due > 0:
        status = "Unpaid"
    else:
        status = "Paid"

    # ── Line items ─────────────────────────────────────────────────────────────
    # Each line: description qty unit_price 10% amount
    # In stripped text spaces between words are removed so we match on
    # the numeric columns which are preserved: qty unit_price 10% amount
    # Pattern: any text ending with qty price 10% amount on the same line
    line_re = re.compile(
        r"^(.+?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+10%\s+([\d,]+\.\d{2})\s*$",
        re.MULTILINE
    )

    lines = []
    skip_words = {"description", "subtotal", "quantity", "unitprice", "gst", "amountaud"}

    for m in line_re.finditer(text):
        desc  = m.group(1).strip()
        desc_lower = desc.lower().replace(" ","")

        if any(s in desc_lower for s in skip_words):
            continue

        try:
            qty   = float(m.group(2).replace(",",""))
            price = float(m.group(3).replace(",",""))
            amt   = float(m.group(4).replace(",",""))
        except ValueError:
            continue

        # Sanity check with 2% tolerance
        if qty > 0 and price > 0:
            expected = qty * price
            if expected > 0 and abs(expected - amt) / expected > 0.02:
                continue

        lines.append({
            "description": desc,
            "quantity":    qty,
            "unit_price":  price,
            "gst_rate":    "10%",
            "amount":      amt,
            "category":    categorise_invoice_line(desc),
        })

    # If subtotal wasn't found, calculate from lines
    if subtotal == 0 and lines:
        subtotal = round(sum(l["amount"] for l in lines), 2)
    if gst == 0 and subtotal:
        gst = round(subtotal * 0.1, 2)
    if total_aud == 0 and subtotal:
        total_aud = round(subtotal * 1.1, 2)

    return {
        "invoice_number": invoice_number,
        "invoice_date":   invoice_date,
        "due_date":       due_date,
        "po_reference":   po_reference,
        "client":         client,
        "abn":            abn,
        "subtotal":       subtotal,
        "gst":            gst,
        "total_aud":      total_aud,
        "amount_paid":    amount_paid,
        "amount_due":     amount_due,
        "status":         status,
        "lines":          lines,
    }


def match_invoice_to_eos(cur, invoice_id: int, contractor: str, po_reference: str):
    """
    Compare invoice line totals by category against EOS activity costs.
    Updates match_status and variance on each invoice line.
    """
    # Get EOS cost totals by category for this contractor
    cur.execute("""
        SELECT
            CASE
                WHEN code IN ('Drill_Core','Drill_Chip_or_Open_hole') THEN 'drilling_metres'
                WHEN code LIKE '%Standby%' OR code LIKE '%standby%' THEN 'standby'
                WHEN code LIKE '%Travel%' OR code LIKE '%travel%' THEN 'travel'
                WHEN code LIKE '%Safety%' OR code LIKE '%Repair%' OR code LIKE '%Training%'
                  OR code LIKE '%Prestart%' THEN 'safety'
                WHEN code LIKE 'D_Backhoe%' OR code LIKE 'D_Water%' THEN 'equipment'
                WHEN code LIKE '%Setup%' OR code LIKE '%Surface%' THEN 'setup'
                ELSE 'active'
            END AS category,
            SUM(line_cost) AS eos_total
        FROM activities
        WHERE contractor=%s AND line_cost IS NOT NULL
        GROUP BY 1
    """, (contractor,))
    eos_by_cat = {r["category"]: float(r["eos_total"] or 0) for r in cur.fetchall()}

    # Get invoice lines
    cur.execute("SELECT * FROM invoice_lines WHERE invoice_id=%s", (invoice_id,))
    inv_lines = cur.fetchall()

    # Group invoice lines by category
    inv_by_cat = {}
    for line in inv_lines:
        cat = line["category"]
        inv_by_cat.setdefault(cat, 0)
        inv_by_cat[cat] += float(line["amount"] or 0)

    # Update each line with match info
    for line in inv_lines:
        cat = line["category"]
        eos_total = eos_by_cat.get(cat, 0)
        inv_total = inv_by_cat.get(cat, 0)
        # Pro-rate EOS cost to this line's share
        line_share = (float(line["amount"] or 0) / inv_total) if inv_total else 0
        matched_eos = round(eos_total * line_share, 2) if eos_total else None
        variance = round(float(line["amount"] or 0) - matched_eos, 2) if matched_eos is not None else None

        if matched_eos is None:
            match_status = "no_eos_data"
        elif abs(variance) < 0.01:
            match_status = "exact_match"
        elif abs(variance) / float(line["amount"]) < 0.05 if float(line["amount"]) else False:
            match_status = "close_match"
        elif variance > 0:
            match_status = "invoice_over_eos"
        else:
            match_status = "invoice_under_eos"

        cur.execute("""
            UPDATE invoice_lines
            SET matched_eos_cost=%s, variance=%s, match_status=%s
            WHERE id=%s
        """, (matched_eos, variance, match_status, line["id"]))


# ── Invoice API endpoints ─────────────────────────────────────────────────────

@app.post("/invoices/test")
async def test_invoice_parse(
    file: UploadFile = File(...),
    contractor: str = Form(default="Allianz Drilling"),
):
    """Test endpoint — parses invoice and returns result without saving."""
    content = await file.read()
    try:
        with pdfplumber.open(BytesIO(content)) as pdf:
            text = "\n".join(p.extract_text() or "" for p in pdf.pages)
    except Exception as e:
        return {"error": f"PDF read failed: {e}"}
    try:
        inv = parse_invoice_pdf(text, file.filename, contractor)
        return {"parsed": inv, "line_count": len(inv.get("lines",[]))}
    except Exception as e:
        return {"error": f"Parse failed: {e}", "text_preview": text[:500]}


@app.post("/invoices/import")
async def import_invoice(
    file: UploadFile = File(...),
    contractor: str = Form(default="Allianz Drilling"),
):
    filename = file.filename

    # Check if already imported — handle both old single-col and new dual-col table
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM invoice_imports WHERE filename=%s AND contractor=%s",
                            (filename, contractor))
                if cur.fetchone():
                    return {"status": "skipped", "filename": filename}
    except Exception:
        # Table may have old schema — try migration
        with get_conn() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute("ALTER TABLE invoice_imports ADD COLUMN IF NOT EXISTS contractor TEXT DEFAULT 'Allianz Drilling'")
                    cur.execute("SELECT 1 FROM invoice_imports WHERE filename=%s", (filename,))
                    if cur.fetchone():
                        return {"status": "skipped", "filename": filename}
                except Exception:
                    pass
            conn.commit()

    content = await file.read()
    try:
        with pdfplumber.open(BytesIO(content)) as pdf:
            text = "\n".join(p.extract_text() or "" for p in pdf.pages)
    except Exception as e:
        raise HTTPException(400, f"Could not read PDF: {e}")

    try:
        inv = parse_invoice_pdf(text, filename, contractor)
    except Exception as e:
        raise HTTPException(422, f"Could not parse invoice: {e}")

    lines = inv.pop("lines", [])

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO invoices
                    (source_file,contractor,invoice_number,invoice_date,due_date,po_reference,
                     client,abn,subtotal,gst,total_aud,amount_paid,amount_due,status,pdf_data)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    RETURNING id
                """, (filename, contractor,
                      inv.get("invoice_number",""), inv.get("invoice_date",""),
                      inv.get("due_date",""), inv.get("po_reference",""),
                      inv.get("client",""), inv.get("abn",""),
                      inv.get("subtotal",0), inv.get("gst",0), inv.get("total_aud",0),
                      inv.get("amount_paid",0), inv.get("amount_due",0), inv.get("status","Unpaid"),
                      psycopg2.Binary(content)))
                invoice_id = cur.fetchone()["id"]

                if lines:
                    psycopg2.extras.execute_batch(cur, """
                        INSERT INTO invoice_lines
                        (invoice_id,contractor,invoice_number,description,quantity,unit_price,gst_rate,amount,category)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """, [(invoice_id, contractor, inv.get("invoice_number",""),
                           l["description"], l["quantity"], l["unit_price"],
                           l["gst_rate"], l["amount"], l["category"]) for l in lines])

                # Run matching — don't let this crash the import
                try:
                    match_invoice_to_eos(cur, invoice_id, contractor, inv.get("po_reference",""))
                except Exception:
                    pass

                # Record import — use INSERT OR IGNORE equivalent
                try:
                    cur.execute("INSERT INTO invoice_imports (filename,contractor) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                                (filename, contractor))
                except Exception:
                    cur.execute("INSERT INTO invoice_imports (filename) VALUES (%s) ON CONFLICT DO NOTHING", (filename,))
            conn.commit()
    except Exception as e:
        raise HTTPException(500, f"Database error: {str(e)}")

    return {
        "status": "imported",
        "filename": filename,
        "invoice_number": inv.get("invoice_number", filename),
        "total_aud": inv.get("total_aud", 0),
        "line_count": len(lines),
    }


@app.get("/invoices")
def get_invoices(contractor: str = Query(...)):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, source_file, contractor, invoice_number,
                           invoice_date, due_date, po_reference, client, abn,
                           subtotal, gst, total_aud, amount_paid, amount_due,
                           status, notes
                    FROM invoices
                    WHERE contractor=%s
                    ORDER BY invoice_date DESC
                """, (contractor,))
                invoices = [dict(r) for r in cur.fetchall()]

                for inv in invoices:
                    try:
                        cur.execute("""
                            SELECT COUNT(*) AS line_count,
                                   SUM(CASE WHEN match_status='exact_match' THEN 1 ELSE 0 END) AS exact_matches,
                                   SUM(CASE WHEN match_status LIKE '%over%' THEN 1 ELSE 0 END) AS over_count,
                                   SUM(CASE WHEN match_status LIKE '%under%' THEN 1 ELSE 0 END) AS under_count,
                                   SUM(CASE WHEN match_status='no_eos_data' THEN 1 ELSE 0 END) AS unmatched_count
                            FROM invoice_lines WHERE invoice_id=%s
                        """, (inv["id"],))
                        row = cur.fetchone()
                        if row:
                            inv.update(dict(row))
                        else:
                            inv.update({"line_count":0,"exact_matches":0,"over_count":0,"under_count":0,"unmatched_count":0})
                    except Exception:
                        inv.update({"line_count":0,"exact_matches":0,"over_count":0,"under_count":0,"unmatched_count":0})

                return invoices
    except Exception as e:
        raise HTTPException(500, f"Invoices error: {str(e)}")


@app.get("/invoices/{invoice_id}/lines")
def get_invoice_lines(invoice_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM invoice_lines WHERE invoice_id=%s ORDER BY id", (invoice_id,))
            return [dict(r) for r in cur.fetchall()]


@app.get("/invoices/{invoice_id}/pdf")
def get_invoice_pdf(invoice_id: int):
    """Return the stored PDF file for viewing/downloading."""
    from fastapi.responses import Response
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT source_file, pdf_data FROM invoices WHERE id=%s", (invoice_id,))
            row = cur.fetchone()
            if not row or not row["pdf_data"]:
                raise HTTPException(404, "PDF not found for this invoice")
            filename = row["source_file"] or f"invoice_{invoice_id}.pdf"
            return Response(
                content=bytes(row["pdf_data"]),
                media_type="application/pdf",
                headers={"Content-Disposition": f'inline; filename="{filename}"'}
            )


@app.patch("/invoices/{invoice_id}")
def update_invoice(invoice_id: int, payload: dict):
    safe = {"invoice_number","invoice_date","due_date","po_reference","status","notes",
            "subtotal","gst","total_aud","amount_paid","amount_due"}
    u = {k:v for k,v in payload.items() if k in safe}
    if not u: raise HTTPException(400,"No valid fields")
    u["iid"]=invoice_id
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE invoices SET {','.join(f'{k}=%('+k+')s' for k in u if k!='iid')} WHERE id=%(iid)s", u)
        conn.commit()
    return {"status":"updated"}


@app.delete("/invoices/{invoice_id}")
def delete_invoice(invoice_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM invoices WHERE id=%s", (invoice_id,))
        conn.commit()
    return {"status":"deleted"}


@app.get("/reconciliation")
def get_reconciliation(contractor: str = Query(...)):
    """
    Full reconciliation: invoice totals vs EOS activity costs by category.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:

            # Invoice totals by category
            cur.execute("""
                SELECT l.category,
                    SUM(l.amount) AS invoice_total,
                    COUNT(l.id)   AS line_count,
                    COUNT(DISTINCT l.invoice_number) AS invoice_count
                FROM invoice_lines l
                WHERE l.contractor=%s
                GROUP BY l.category
                ORDER BY invoice_total DESC
            """, (contractor,))
            inv_cats = {r["category"]: dict(r) for r in cur.fetchall()}

            # EOS costs by category
            cur.execute("""
                SELECT
                    CASE
                        WHEN code IN ('Drill_Core','Drill_Chip_or_Open_hole') THEN 'drilling_metres'
                        WHEN code LIKE '%%Standby%%' THEN 'standby'
                        WHEN code LIKE '%%Travel%%' THEN 'travel'
                        WHEN code LIKE '%%Safety%%' OR code LIKE '%%Training%%'
                          OR code LIKE '%%Prestart%%' THEN 'safety'
                        WHEN code LIKE 'D_Backhoe%%' OR code LIKE 'D_Water%%' THEN 'equipment'
                        WHEN code LIKE '%%Setup%%' OR code LIKE '%%Surface%%' THEN 'setup'
                        ELSE 'active'
                    END AS category,
                    SUM(line_cost) AS eos_total,
                    COUNT(*) AS activity_count
                FROM activities
                WHERE contractor=%s AND line_cost IS NOT NULL
                GROUP BY 1
            """, (contractor,))
            eos_cats = {r["category"]: dict(r) for r in cur.fetchall()}

            # Invoice header summary
            cur.execute("""
                SELECT invoice_number, invoice_date, due_date, po_reference,
                       total_aud, amount_paid, amount_due, status
                FROM invoices WHERE contractor=%s ORDER BY invoice_date
            """, (contractor,))
            invoices = [dict(r) for r in cur.fetchall()]

            # Grand totals
            cur.execute("SELECT SUM(total_aud) AS t, SUM(amount_paid) AS p, SUM(amount_due) AS d FROM invoices WHERE contractor=%s", (contractor,))
            inv_totals = dict(cur.fetchone())

            cur.execute("SELECT SUM(line_cost) AS t FROM activities WHERE contractor=%s AND line_cost IS NOT NULL", (contractor,))
            eos_grand = float(cur.fetchone()["t"] or 0)

            # Line-level discrepancies
            cur.execute("""
                SELECT l.invoice_number, l.description, l.category,
                       l.quantity, l.unit_price, l.amount,
                       l.matched_eos_cost, l.variance, l.match_status
                FROM invoice_lines l
                WHERE l.contractor=%s
                  AND l.match_status NOT IN ('exact_match','no_eos_data')
                ORDER BY ABS(COALESCE(l.variance,0)) DESC
                LIMIT 50
            """, (contractor,))
            discrepancies = [dict(r) for r in cur.fetchall()]

    # Build comparison rows
    all_cats = sorted(set(list(inv_cats.keys()) + list(eos_cats.keys())))
    comparison = []
    for cat in all_cats:
        inv = float(inv_cats.get(cat, {}).get("invoice_total", 0) or 0)
        eos = float(eos_cats.get(cat, {}).get("eos_total", 0) or 0)
        var = inv - eos
        comparison.append({
            "category":      cat,
            "invoice_total": round(inv, 2),
            "eos_total":     round(eos, 2),
            "variance":      round(var, 2),
            "variance_pct":  round(var/eos*100, 1) if eos else None,
            "status":        "match" if abs(var) < 1 else "over" if var > 0 else "under",
        })

    return {
        "invoices":      invoices,
        "comparison":    comparison,
        "discrepancies": discrepancies,
        "totals": {
            "invoice_total":  round(float(inv_totals.get("t") or 0), 2),
            "invoice_paid":   round(float(inv_totals.get("p") or 0), 2),
            "invoice_due":    round(float(inv_totals.get("d") or 0), 2),
            "eos_total":      round(eos_grand, 2),
            "grand_variance": round(float(inv_totals.get("t") or 0) - eos_grand, 2),
        },
    }


@app.post("/reconciliation/rematch")
def rematch_all(contractor: str = Query(...)):
    """Re-run EOS matching for all invoices of a contractor."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, po_reference FROM invoices WHERE contractor=%s", (contractor,))
            invoices = cur.fetchall()
            for inv in invoices:
                match_invoice_to_eos(cur, inv["id"], contractor, inv["po_reference"])
        conn.commit()
    return {"status": "rematched", "count": len(invoices)}


@app.post("/reprice")
def reprice_activities(contractor: str = Query(...)):
    """Re-run the pricing engine on all existing activities for a contractor."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM activities WHERE contractor=%s", (contractor,))
            rows = [dict(r) for r in cur.fetchall()]

        updated = 0
        with conn.cursor() as cur:
            for row in rows:
                priced = price_activity(cur, dict(row), contractor)
                if priced.get("line_cost") is not None:
                    cur.execute("""
                        UPDATE activities
                        SET rate_year=%s, unit_rate=%s, quantity=%s,
                            line_cost=%s, rate_basis=%s
                        WHERE id=%s
                    """, (priced["rate_year"], priced["unit_rate"],
                          priced["quantity"], priced["line_cost"],
                          priced["rate_basis"], row["id"]))
                    updated += 1
        conn.commit()
    return {"status": "repriced", "total": len(rows), "priced": updated}



# ── Borehole Planning ─────────────────────────────────────────────────────────

@app.get("/boreholes")
def get_boreholes(contractor: str = Query(...)):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT b.*,
                        COALESCE(SUM(a.line_cost),0) AS eos_cost,
                        SUM(a.total_metres) AS eos_metres
                    FROM boreholes b
                    LEFT JOIN activities a ON a.hole_num=b.hole_id AND a.contractor=b.contractor
                    WHERE b.contractor=%s
                    GROUP BY b.id ORDER BY b.drill_order
                """, (contractor,))
                rows = [dict(r) for r in cur.fetchall()]
                return rows
    except Exception as e:
        raise HTTPException(500, f"Boreholes error: {str(e)}")


@app.post("/boreholes/import_budget")
async def import_budget(request: Request):
    """Import boreholes from the Excel budget file."""
    try:
        payload = await request.json()
    except:
        raise HTTPException(400, "Invalid JSON")
    contractor = payload.get("contractor", "Allianz Drilling")
    boreholes = payload.get("boreholes", [])
    if not boreholes:
        raise HTTPException(400, "No boreholes provided")
    with get_conn() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(cur, """
                INSERT INTO boreholes
                (contractor,project,planned_year,site_id,hole_id,drill_order,days_budgeted,
                 bh_type,bit_type,purpose,easting,northing,rl,chip_depth,eoh_depth,total_core,
                 seam_tk,lat,lng,status,budget_total)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'Planned',%s)
                ON CONFLICT (contractor,hole_id) DO UPDATE SET
                    project=EXCLUDED.project, planned_year=EXCLUDED.planned_year,
                    site_id=EXCLUDED.site_id, drill_order=EXCLUDED.drill_order,
                    days_budgeted=EXCLUDED.days_budgeted,
                    bh_type=EXCLUDED.bh_type, bit_type=EXCLUDED.bit_type,
                    purpose=EXCLUDED.purpose, easting=EXCLUDED.easting,
                    northing=EXCLUDED.northing, rl=EXCLUDED.rl,
                    chip_depth=EXCLUDED.chip_depth, eoh_depth=EXCLUDED.eoh_depth,
                    total_core=EXCLUDED.total_core, seam_tk=EXCLUDED.seam_tk,
                    lat=EXCLUDED.lat, lng=EXCLUDED.lng,
                    budget_total=EXCLUDED.budget_total
            """, [(contractor, b.get("project",""), b.get("planned_year",""),
                   b.get("site_id",""), b["hole_id"], b.get("drill_order"),
                   b.get("days") or b.get("days_budgeted"),
                   b.get("type") or b.get("bh_type"), b.get("bit_type"), b.get("purpose"),
                   b.get("easting"), b.get("northing"), b.get("rl"),
                   b.get("chip_depth"), b.get("eoh_depth"), b.get("total_core"),
                   b.get("seam_tk"), b.get("lat"), b.get("lng"),
                   b.get("budget_total")) for b in boreholes])
        conn.commit()
    return {"status": "imported", "count": len(boreholes)}


@app.patch("/boreholes/{hole_id}")
async def update_borehole(hole_id: str, request: Request):
    payload = await request.json()
    contractor = payload.pop("contractor", "Allianz Drilling")
    safe = {"status","notes","days_budgeted","budget_total","actual_total","drill_order","project","planned_year","site_id","bh_type","bit_type","purpose","easting","northing","rl","chip_depth","eoh_depth","total_core","seam_tk","hole_id"}
    u = {k:v for k,v in payload.items() if k in safe}
    if not u: raise HTTPException(400, "No valid fields")
    u["hole_id"] = hole_id
    u["contractor"] = contractor
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE boreholes SET {','.join(f'{k}=%('+k+')s' for k in u if k not in ('hole_id','contractor'))} WHERE hole_id=%(hole_id)s AND contractor=%(contractor)s",
                u
            )
        conn.commit()
    return {"status": "updated"}


@app.delete("/boreholes/{hole_id}")
def delete_borehole(hole_id: str, contractor: str = Query(...)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM boreholes WHERE hole_id=%s AND contractor=%s", (hole_id, contractor))
        conn.commit()
    return {"status": "deleted"}


@app.get("/boreholes/summary")
def get_borehole_summary(contractor: str = Query(...)):
    """Budget vs actual summary for reconciliation."""
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT
                        COUNT(*) AS total_holes,
                        SUM(days_budgeted) AS total_days_budgeted,
                        SUM(budget_total) AS total_budget,
                        COUNT(CASE WHEN status='Complete' THEN 1 END) AS completed,
                        COUNT(CASE WHEN status='In Progress' THEN 1 END) AS in_progress,
                        COUNT(CASE WHEN status='Planned' THEN 1 END) AS planned
                    FROM boreholes WHERE contractor=%s
                """, (contractor,))
                summary = dict(cur.fetchone())
                # Get actual EOS cost total
                cur.execute("""
                    SELECT COALESCE(SUM(a.line_cost),0) AS actual_total
                    FROM activities a
                    JOIN boreholes b ON b.hole_id=a.hole_num AND b.contractor=a.contractor
                    WHERE a.contractor=%s AND a.line_cost IS NOT NULL
                """, (contractor,))
                summary["actual_total"] = float(cur.fetchone()["actual_total"] or 0)
                return summary
    except Exception as e:
        raise HTTPException(500, f"Summary error: {str(e)}")


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
