"""
DrillOps — FastAPI Backend
Database: Supabase (PostgreSQL)
Includes: Schedule of Rates per year, auto-pricing on PDF import
"""

import re
import os
from io import BytesIO
from typing import Optional

import pdfplumber
import pandas as pd
import psycopg2
import psycopg2.extras
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="DrillOps API", version="2.0")

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


def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


# ── Schema ────────────────────────────────────────────────────────────────────
def init_db():
    with get_conn() as conn:
        with conn.cursor() as cur:

            # Activities — now includes cost columns + contractor
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
            # Add contractor column if upgrading existing DB
            cur.execute("""
                ALTER TABLE activities ADD COLUMN IF NOT EXISTS contractor TEXT DEFAULT 'Allianz Drilling'
            """)
            cur.execute("""
                ALTER TABLE activities ADD COLUMN IF NOT EXISTS po_id INTEGER
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS consumables (
                    id          SERIAL PRIMARY KEY,
                    source_file TEXT,
                    date        TEXT,
                    hole_num    TEXT,
                    site_name   TEXT,
                    consumable  TEXT,
                    type        TEXT,
                    quantity    TEXT,
                    unit        TEXT
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS crew (
                    id          SERIAL PRIMARY KEY,
                    source_file TEXT,
                    date        TEXT,
                    hole_num    TEXT,
                    site_name   TEXT,
                    role        TEXT,
                    name        TEXT,
                    hours       TEXT
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS imported_files (
                    filename TEXT PRIMARY KEY
                )
            """)

            # ── Rates tables ─────────────────────────────────────────────────
            # Drilling rates: depth-banded $/m by bit type & year
            cur.execute("""
                CREATE TABLE IF NOT EXISTS drilling_rates (
                    id          SERIAL PRIMARY KEY,
                    year        TEXT NOT NULL,
                    bit_type    TEXT NOT NULL,
                    depth_from  FLOAT NOT NULL,
                    depth_to    FLOAT NOT NULL,
                    rate        FLOAT NOT NULL
                )
            """)

            # Hourly/daily rates: active, standby, equipment etc
            cur.execute("""
                CREATE TABLE IF NOT EXISTS hourly_rates (
                    id          SERIAL PRIMARY KEY,
                    year        TEXT NOT NULL,
                    code        TEXT NOT NULL,
                    description TEXT,
                    rate        FLOAT NOT NULL,
                    unit        TEXT NOT NULL
                )
            """)

            # ── Contractors ───────────────────────────────────────────────────
            cur.execute("""
                CREATE TABLE IF NOT EXISTS contractors (
                    id          SERIAL PRIMARY KEY,
                    name        TEXT NOT NULL UNIQUE,
                    short_code  TEXT,
                    active      BOOLEAN DEFAULT TRUE,
                    notes       TEXT
                )
            """)

            # ── Purchase Orders ───────────────────────────────────────────────
            cur.execute("""
                CREATE TABLE IF NOT EXISTS purchase_orders (
                    id              SERIAL PRIMARY KEY,
                    po_number       TEXT NOT NULL,
                    contractor_id   INTEGER REFERENCES contractors(id),
                    contractor_name TEXT,
                    description     TEXT,
                    issue_date      TEXT,
                    expiry_date     TEXT,
                    po_value        FLOAT,
                    status          TEXT DEFAULT 'Active',
                    notes           TEXT
                )
            """)

        conn.commit()


init_db()

# ── Seed 2025 rates from the uploaded schedule ────────────────────────────────
def seed_2025_rates():
    """Insert the 2025/2026 schedule of rates if not already present."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM drilling_rates WHERE year='2025'")
            if cur.fetchone()["n"] > 0:
                return  # already seeded

            YEAR = "2025"

            # Drilling rates — $/m by bit type and depth band
            drilling = [
                # HQ/HQ3 Triple Tube wireline 96mm
                (YEAR, "HQ_HQ3",    0,   100, 46.00),
                (YEAR, "HQ_HQ3",  100,   200, 51.00),
                (YEAR, "HQ_HQ3",  200,   300, 59.00),
                (YEAR, "HQ_HQ3",  300,   400, 66.00),
                (YEAR, "HQ_HQ3",  400,   500, 70.00),
                # 4c 101.6mm Core
                (YEAR, "4C",        0,   100, 51.00),
                (YEAR, "4C",      100,   200, 62.00),
                (YEAR, "4C",      200,   300, 76.00),
                (YEAR, "4C",      300,   400, 81.00),
                (YEAR, "4C",      400,   500, 95.00),
                # Chip / PCD or Blade 99-125mm (3.5-5 inch)
                (YEAR, "PCD_S",     0,   200, 51.00),
                (YEAR, "PCD_S",   200,   300, 61.00),
                (YEAR, "PCD_S",   400,   500, 90.00),
                # Chip / PCD or Blade 125-175mm (5-7 inch)
                (YEAR, "PCD_M",     0,   200, 60.00),
                (YEAR, "PCD_M",   200,   300, 73.00),
                (YEAR, "PCD_M",   400,   500, 103.00),
                # Chip / PCD or Blade 175-305mm (7-10 inch)
                (YEAR, "PCD_L",     0,   200, 76.00),
                (YEAR, "PCD_L",   200,   300, 86.00),
                # Hammer 3.5-5 inch
                (YEAR, "HAMMER_S",  0,   100, 196.00),
                (YEAR, "HAMMER_S",100,   200, 239.00),
                (YEAR, "HAMMER_S",200,   300, 278.00),
                (YEAR, "HAMMER_S",300,   400, 324.00),
                (YEAR, "HAMMER_S",400,   500, 367.00),
                (YEAR, "HAMMER_S",500,   600, 422.00),
                # Hammer 5-7 inch
                (YEAR, "HAMMER_M",  0,   100, 227.00),
                (YEAR, "HAMMER_M",100,   200, 273.00),
                (YEAR, "HAMMER_M",200,   300, 327.00),
                (YEAR, "HAMMER_M",300,   400, 374.00),
            ]
            psycopg2.extras.execute_batch(cur, """
                INSERT INTO drilling_rates (year, bit_type, depth_from, depth_to, rate)
                VALUES (%s, %s, %s, %s, %s)
            """, drilling)

            # Hourly / daily rates
            hourly = [
                (YEAR, "H_Active",          "Active drilling rate (per hour)",             745.00,  "hour"),
                (YEAR, "H_Inactive",         "Inactive / standby rate (per hour)",          675.00,  "hour"),
                (YEAR, "H_Standby_NoCrew",   "Standby without crew (per day)",             4470.00,  "day"),
                (YEAR, "H_Min_Shift",        "Minimum shift rate (per shift)",             8940.00,  "shift"),
                (YEAR, "D_Backhoe",          "Backhoe day rate (with operator)",           1850.00,  "day"),
                (YEAR, "D_Backhoe_Standby",  "Backhoe standby rate",                        620.00,  "day"),
                (YEAR, "D_Water_Cart",       "Water cart day rate (20,000L)",              1650.00,  "day"),
                (YEAR, "D_Water_Cart_Standby","Water cart standby rate",                    550.00,  "day"),
                (YEAR, "MOB",                "Mobilisation to site",                      38760.00,  "event"),
                (YEAR, "DEMOB",              "Demobilisation from site",                  38760.00,  "event"),
            ]
            psycopg2.extras.execute_batch(cur, """
                INSERT INTO hourly_rates (year, code, description, rate, unit)
                VALUES (%s, %s, %s, %s, %s)
            """, hourly)

        conn.commit()


seed_2025_rates()


def seed_contractors():
    """Seed the default contractor list if empty."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM contractors")
            if cur.fetchone()["n"] > 0:
                return
            defaults = [
                ("Allianz Drilling",   "ALZ"),
                ("Mitchells Drilling", "MIT"),
                ("MCC Earthworks",     "MCC"),
                ("Weatherfords",       "WFD"),
                ("Epiroc",             "EPI"),
                ("Fortem",             "FOR"),
            ]
            psycopg2.extras.execute_batch(cur, """
                INSERT INTO contractors (name, short_code) VALUES (%s, %s)
                ON CONFLICT (name) DO NOTHING
            """, defaults)
        conn.commit()


seed_contractors()

# ── Pricing engine ────────────────────────────────────────────────────────────

# Map activity codes to rate categories
ACTIVE_CODES = {
    "Drill_Core", "Drill_Chip_or_Open_hole",
    "H_Tripping_Rods", "H_Circulation_Flush", "H_Circulation_Lost",
    "H_Reaming", "H_Change_Drill_Mthd", "H_Surface_Setup",
    "H_Casing_Install", "H_Rig_Cementing", "H_Mud_Mixing",
    "H_Water_Flow_Measure", "H_Repairs", "H_Training",
    "H_Safety_Prestart", "H_Safety_Contractor",
}

STANDBY_CODES = {
    "H_Standby_Sumps", "H_Standby_AAC", "H_Standby_Logger",
    "H_Standby_Grout", "H_Standby_Cement_Set",
}

DAY_RATE_CODES = {
    "D_Backhoe":               ("D_Backhoe",           "day"),
    "D_Backhoe - Day Rate":    ("D_Backhoe",           "day"),
    "D_Backhoe - Standby Rate":("D_Backhoe_Standby",   "day"),
    "D_Water_Cart_Day_Rate":   ("D_Water_Cart",        "day"),
    "D_Water Cart - Standby Rate": ("D_Water_Cart_Standby", "day"),
    "D_Water_Cart":            ("D_Water_Cart",        "day"),
}

# Bit type code → drilling_rates.bit_type lookup key
BIT_TYPE_MAP = {
    "HQ_HQ3": "HQ_HQ3",
    "HQ":     "HQ_HQ3",
    "NQ":     "HQ_HQ3",
    "PCD":    "PCD_S",
}


def time_str_to_hours(t: str) -> float:
    try:
        h, m = t.split(":")
        return int(h) + int(m) / 60
    except:
        return 0.0


def get_drilling_rate(cur, year: str, bit_type_key: str, depth: float) -> Optional[float]:
    """Return $/m rate for the given bit type and depth from the rates table."""
    cur.execute("""
        SELECT rate FROM drilling_rates
        WHERE year = %s AND bit_type = %s
          AND depth_from <= %s AND depth_to > %s
        ORDER BY depth_from
        LIMIT 1
    """, (year, bit_type_key, depth, depth))
    row = cur.fetchone()
    return float(row["rate"]) if row else None


def get_hourly_rate(cur, year: str, code: str) -> Optional[float]:
    cur.execute("SELECT rate FROM hourly_rates WHERE year=%s AND code=%s", (year, code))
    row = cur.fetchone()
    return float(row["rate"]) if row else None


def extract_year_from_date(date_str: str) -> str:
    """Extract 4-digit year from d/m/yyyy or similar."""
    m = re.search(r"(\d{4})", date_str)
    if m:
        return m.group(1)
    # fallback: 2-digit year at end
    m2 = re.search(r"/(\d{2})$", date_str)
    if m2:
        yr = int(m2.group(1))
        return str(2000 + yr)
    return "2025"


def price_activity(cur, row: dict) -> dict:
    """
    Calculate unit_rate, quantity, line_cost, rate_basis for one activity row.
    Returns the row dict with pricing fields added.
    """
    code         = row.get("code", "") or ""
    total_time   = row.get("total_time", "") or ""
    total_metres = row.get("total_metres")
    metres_to    = row.get("metres_to")
    bit_type     = row.get("bit_type", "") or ""
    date_str     = row.get("date", "") or ""
    year         = extract_year_from_date(date_str) if date_str else "2025"
    # map to the closest rate year available
    rate_year = year

    hours    = time_str_to_hours(total_time)
    unit_rate  = None
    quantity   = None
    line_cost  = None
    rate_basis = None

    # ── 1. Drilling metres ────────────────────────────────────────────────
    if code in ("Drill_Core", "Drill_Chip_or_Open_hole") and total_metres and total_metres > 0:
        bit_key = BIT_TYPE_MAP.get(bit_type.upper().replace(" ", "_"), None)
        if not bit_key:
            # try to infer from code
            bit_key = "PCD_S" if "Chip" in code else "HQ_HQ3"
        # use mid-point depth for band lookup
        depth_mid = (metres_to or 0)
        rate = get_drilling_rate(cur, rate_year, bit_key, depth_mid)
        if rate:
            unit_rate  = rate
            quantity   = total_metres
            line_cost  = round(rate * total_metres, 2)
            rate_basis = f"$/m @ {depth_mid:.0f}m depth ({bit_key})"

    # ── 2. Day-rate equipment ─────────────────────────────────────────────
    elif code in DAY_RATE_CODES or any(k in code for k in DAY_RATE_CODES):
        matched = next((v for k, v in DAY_RATE_CODES.items() if k in code or code in k), None)
        if matched:
            rate_code, unit = matched
            rate = get_hourly_rate(cur, rate_year, rate_code)
            if rate:
                unit_rate  = rate
                quantity   = 1
                line_cost  = rate
                rate_basis = f"${rate:,.2f}/{unit}"

    # ── 3. Standby (inactive rate) ────────────────────────────────────────
    elif code in STANDBY_CODES or "Standby" in code:
        rate = get_hourly_rate(cur, rate_year, "H_Inactive")
        if rate and hours > 0:
            unit_rate  = rate
            quantity   = round(hours, 2)
            line_cost  = round(rate * hours, 2)
            rate_basis = f"inactive $/hr × {hours:.2f}h"

    # ── 4. Active rate (everything else operational) ──────────────────────
    elif hours > 0 and (code in ACTIVE_CODES or any(a in code for a in ("H_", "Crew_Travel"))):
        rate = get_hourly_rate(cur, rate_year, "H_Active")
        if rate:
            unit_rate  = rate
            quantity   = round(hours, 2)
            line_cost  = round(rate * hours, 2)
            rate_basis = f"active $/hr × {hours:.2f}h"

    row["rate_year"] = rate_year
    row["unit_rate"] = unit_rate
    row["quantity"]  = quantity
    row["line_cost"] = line_cost
    row["rate_basis"] = rate_basis
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
    meta = {}
    for key, pat in patterns.items():
        m = re.search(pat, text, re.IGNORECASE)
        meta[key] = m.group(1).strip() if m else ""
    return meta


def parse_activities(text, header, filename):
    time_pat = r"\d{1,2}:\d{2}"
    row_re = re.compile(
        r"^(.*?)(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})"
        r"(?:\s+(HQ_HQ3|PCD|NQ|HQ)\s+(\S+))?"
        r"(?:\s+(\d+\.?\d*))?(?:\s+(\d+\.?\d*))?(?:\s+(\d+\.?\d*))?"
        r"(?:\s+([\w_]+))?\s*$",
        re.IGNORECASE,
    )
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line or len(re.findall(time_pat, line)) < 2:
            continue
        m = row_re.match(line)
        if m:
            notes, tf, tt, total, bit_type, diam, mf, mt, mto, code = m.groups()
            rows.append({
                "source_file":  filename,
                "contractor":   "Allianz Drilling",
                "date":         header.get("date", ""),
                "hole_num":     header.get("hole_num", ""),
                "site_name":    header.get("site_name", ""),
                "location":     header.get("location", ""),
                "drill_rig":    header.get("drill_rig", ""),
                "client":       header.get("client", ""),
                "contract":     header.get("contract", ""),
                "shift":        header.get("shift", ""),
                "time_from":    tf,
                "time_to":      tt,
                "total_time":   total,
                "bit_type":     bit_type or "",
                "diameter":     diam or "",
                "metres_from":  float(mf)  if mf  else None,
                "metres_to":    float(mt)  if mt  else None,
                "total_metres": float(mto) if mto else None,
                "code":         code or "",
                "notes":        notes.strip(),
                # pricing — filled in next step
                "rate_year":    None,
                "unit_rate":    None,
                "quantity":     None,
                "line_cost":    None,
                "rate_basis":   None,
                "po_id":        None,
            })
    return rows


def parse_consumables(text, header, filename):
    rows = []
    m = re.search(r"CONSUMABLES\s*\n(.*?)(?:ALLIANZ REPRESENTATIVE|$)", text, re.DOTALL | re.IGNORECASE)
    if not m:
        return rows
    con_re = re.compile(
        r"^(.+?)\s+(drum|bucket|bags?|tins?|slurry|Kgs?|Ltrs?|Mtrs?|cube)\s+(\d+)\s+(\S+)\s*$",
        re.IGNORECASE | re.MULTILINE,
    )
    for cm in con_re.finditer(m.group(1)):
        rows.append({
            "source_file": filename, "date": header.get("date", ""),
            "hole_num": header.get("hole_num", ""), "site_name": header.get("site_name", ""),
            "consumable": cm.group(1).strip(), "type": cm.group(2).strip(),
            "quantity": cm.group(3).strip(), "unit": cm.group(4).strip(),
        })
    return rows


def parse_crew(text, header, filename):
    rows = []
    for role in ["Rig Manager", "Driller", "Trainee Driller", "Offsider", "Operator"]:
        pat = re.compile(rf"{role}\s+([\w\s\.]+?)\s+(\d+)\s", re.IGNORECASE)
        m = pat.search(text)
        if m:
            rows.append({
                "source_file": filename, "date": header.get("date", ""),
                "hole_num": header.get("hole_num", ""), "site_name": header.get("site_name", ""),
                "role": role, "name": m.group(1).strip(), "hours": m.group(2),
            })
    return rows

# ── API Routes ────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "ok", "app": "DrillOps API v2"}


@app.post("/import")
async def import_pdf(file: UploadFile = File(...)):
    filename = file.filename
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM imported_files WHERE filename=%s", (filename,))
            if cur.fetchone():
                return {"status": "skipped", "filename": filename, "rows": 0}

    content = await file.read()
    try:
        with pdfplumber.open(BytesIO(content)) as pdf:
            text = "\n".join(p.extract_text() or "" for p in pdf.pages)
    except Exception as e:
        raise HTTPException(400, f"Could not read PDF: {e}")

    header = parse_header(text)
    acts   = parse_activities(text, header, filename)
    cons   = parse_consumables(text, header, filename)
    crew   = parse_crew(text, header, filename)

    # Price each activity row
    with get_conn() as conn:
        with conn.cursor() as cur:
            acts = [price_activity(cur, row) for row in acts]

            if acts:
                psycopg2.extras.execute_batch(cur, """
                    INSERT INTO activities
                    (source_file,contractor,date,hole_num,site_name,location,drill_rig,client,contract,shift,
                     time_from,time_to,total_time,bit_type,diameter,metres_from,metres_to,total_metres,
                     code,notes,rate_year,unit_rate,quantity,line_cost,rate_basis,po_id)
                    VALUES
                    (%(source_file)s,%(contractor)s,%(date)s,%(hole_num)s,%(site_name)s,%(location)s,%(drill_rig)s,
                     %(client)s,%(contract)s,%(shift)s,%(time_from)s,%(time_to)s,%(total_time)s,
                     %(bit_type)s,%(diameter)s,%(metres_from)s,%(metres_to)s,%(total_metres)s,
                     %(code)s,%(notes)s,%(rate_year)s,%(unit_rate)s,%(quantity)s,%(line_cost)s,%(rate_basis)s,%(po_id)s)
                """, acts)
            if cons:
                psycopg2.extras.execute_batch(cur, """
                    INSERT INTO consumables (source_file,date,hole_num,site_name,consumable,type,quantity,unit)
                    VALUES (%(source_file)s,%(date)s,%(hole_num)s,%(site_name)s,%(consumable)s,%(type)s,%(quantity)s,%(unit)s)
                """, cons)
            if crew:
                psycopg2.extras.execute_batch(cur, """
                    INSERT INTO crew (source_file,date,hole_num,site_name,role,name,hours)
                    VALUES (%(source_file)s,%(date)s,%(hole_num)s,%(site_name)s,%(role)s,%(name)s,%(hours)s)
                """, crew)
            cur.execute("INSERT INTO imported_files VALUES (%s) ON CONFLICT DO NOTHING", (filename,))
        conn.commit()

    total_cost = sum(r["line_cost"] for r in acts if r["line_cost"])
    return {"status": "imported", "filename": filename, "rows": len(acts), "total_cost": round(total_cost, 2)}


@app.get("/activities")
def get_activities(
    dates:  Optional[str] = Query(None),
    holes:  Optional[str] = Query(None),
    sites:  Optional[str] = Query(None),
    codes:  Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    conditions = ["1=1"]
    params: dict = {}
    if dates:
        conditions.append("date = ANY(%(dates)s)");  params["dates"] = dates.split(",")
    if holes:
        conditions.append("hole_num = ANY(%(holes)s)"); params["holes"] = holes.split(",")
    if sites:
        conditions.append("site_name = ANY(%(sites)s)"); params["sites"] = sites.split(",")
    if codes:
        conditions.append("code = ANY(%(codes)s)"); params["codes"] = codes.split(",")
    if search:
        conditions.append("(notes ILIKE %(search)s OR code ILIKE %(search)s)")
        params["search"] = f"%{search}%"
    query = f"SELECT * FROM activities WHERE {' AND '.join(conditions)} ORDER BY date, time_from"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            return [dict(r) for r in cur.fetchall()]


@app.patch("/activities/{row_id}")
def update_activity(row_id: int, payload: dict):
    safe_cols = {
        "date","hole_num","site_name","location","drill_rig","client","contract","shift",
        "time_from","time_to","total_time","bit_type","diameter",
        "metres_from","metres_to","total_metres","code","notes",
        "rate_year","unit_rate","quantity","line_cost","rate_basis",
        "contractor","po_id",
    }
    updates = {k: v for k, v in payload.items() if k in safe_cols}
    if not updates:
        raise HTTPException(400, "No valid fields to update")
    set_clause = ", ".join(f"{k}=%({k})s" for k in updates)
    updates["row_id"] = row_id
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE activities SET {set_clause} WHERE id=%(row_id)s", updates)
        conn.commit()
    return {"status": "updated"}


@app.get("/consumables")
def get_consumables(dates: Optional[str] = Query(None)):
    q = "SELECT * FROM consumables WHERE 1=1"
    p = {}
    if dates:
        q += " AND date = ANY(%(dates)s)"; p["dates"] = dates.split(",")
    q += " ORDER BY date"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q, p); return [dict(r) for r in cur.fetchall()]


@app.get("/crew")
def get_crew(dates: Optional[str] = Query(None)):
    q = "SELECT * FROM crew WHERE 1=1"
    p = {}
    if dates:
        q += " AND date = ANY(%(dates)s)"; p["dates"] = dates.split(",")
    q += " ORDER BY date"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q, p); return [dict(r) for r in cur.fetchall()]


@app.get("/filters")
def get_filters():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT date     FROM activities ORDER BY date")
            dates = [r["date"] for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT hole_num  FROM activities ORDER BY hole_num")
            holes = [r["hole_num"] for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT site_name FROM activities ORDER BY site_name")
            sites = [r["site_name"] for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT code FROM activities WHERE code!='' ORDER BY code")
            codes = [r["code"] for r in cur.fetchall()]
            cur.execute("SELECT COUNT(*) AS n FROM activities")
            total = cur.fetchone()["n"]
    return {"dates": dates, "holes": holes, "sites": sites, "codes": codes, "total_rows": total}


# ── Rates endpoints ───────────────────────────────────────────────────────────

@app.get("/rates/years")
def get_rate_years():
    """Return all years that have rates configured."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT year FROM drilling_rates ORDER BY year")
            drilling_years = [r["year"] for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT year FROM hourly_rates ORDER BY year")
            hourly_years = [r["year"] for r in cur.fetchall()]
    years = sorted(set(drilling_years + hourly_years))
    return {"years": years}


@app.get("/rates/drilling")
def get_drilling_rates(year: Optional[str] = Query(None)):
    q = "SELECT * FROM drilling_rates WHERE 1=1"
    p = {}
    if year:
        q += " AND year=%(year)s"; p["year"] = year
    q += " ORDER BY year, bit_type, depth_from"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q, p); return [dict(r) for r in cur.fetchall()]


@app.get("/rates/hourly")
def get_hourly_rates(year: Optional[str] = Query(None)):
    q = "SELECT * FROM hourly_rates WHERE 1=1"
    p = {}
    if year:
        q += " AND year=%(year)s"; p["year"] = year
    q += " ORDER BY year, code"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q, p); return [dict(r) for r in cur.fetchall()]


@app.patch("/rates/drilling/{rate_id}")
def update_drilling_rate(rate_id: int, payload: dict):
    safe = {"year","bit_type","depth_from","depth_to","rate"}
    updates = {k: v for k, v in payload.items() if k in safe}
    if not updates:
        raise HTTPException(400, "No valid fields")
    set_clause = ", ".join(f"{k}=%({k})s" for k in updates)
    updates["rate_id"] = rate_id
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE drilling_rates SET {set_clause} WHERE id=%(rate_id)s", updates)
        conn.commit()
    return {"status": "updated"}


@app.patch("/rates/hourly/{rate_id}")
def update_hourly_rate(rate_id: int, payload: dict):
    safe = {"year","code","description","rate","unit"}
    updates = {k: v for k, v in payload.items() if k in safe}
    if not updates:
        raise HTTPException(400, "No valid fields")
    set_clause = ", ".join(f"{k}=%({k})s" for k in updates)
    updates["rate_id"] = rate_id
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE hourly_rates SET {set_clause} WHERE id=%(rate_id)s", updates)
        conn.commit()
    return {"status": "updated"}


@app.post("/rates/drilling")
def add_drilling_rate(payload: dict):
    required = {"year","bit_type","depth_from","depth_to","rate"}
    if not required.issubset(payload.keys()):
        raise HTTPException(400, f"Required fields: {required}")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO drilling_rates (year,bit_type,depth_from,depth_to,rate)
                VALUES (%(year)s,%(bit_type)s,%(depth_from)s,%(depth_to)s,%(rate)s)
                RETURNING id
            """, payload)
            new_id = cur.fetchone()["id"]
        conn.commit()
    return {"status": "created", "id": new_id}


@app.post("/rates/hourly")
def add_hourly_rate(payload: dict):
    required = {"year","code","rate","unit"}
    if not required.issubset(payload.keys()):
        raise HTTPException(400, f"Required fields: {required}")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO hourly_rates (year,code,description,rate,unit)
                VALUES (%(year)s,%(code)s,%(description)s,%(rate)s,%(unit)s)
                RETURNING id
            """, {**{"description": ""}, **payload})
            new_id = cur.fetchone()["id"]
        conn.commit()
    return {"status": "created", "id": new_id}


@app.delete("/rates/drilling/{rate_id}")
def delete_drilling_rate(rate_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM drilling_rates WHERE id=%s", (rate_id,))
        conn.commit()
    return {"status": "deleted"}


@app.delete("/rates/hourly/{rate_id}")
def delete_hourly_rate(rate_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM hourly_rates WHERE id=%s", (rate_id,))
        conn.commit()
    return {"status": "deleted"}


# ── Costing summary ───────────────────────────────────────────────────────────

@app.get("/costing")
def get_costing(
    holes:  Optional[str] = Query(None),
    dates:  Optional[str] = Query(None),
):
    """Return cost summary grouped by hole and date."""
    conditions = ["line_cost IS NOT NULL"]
    params: dict = {}
    if holes:
        conditions.append("hole_num = ANY(%(holes)s)"); params["holes"] = holes.split(",")
    if dates:
        conditions.append("date = ANY(%(dates)s)"); params["dates"] = dates.split(",")

    where = " AND ".join(conditions)
    with get_conn() as conn:
        with conn.cursor() as cur:
            # By hole
            cur.execute(f"""
                SELECT hole_num,
                       SUM(line_cost) AS total_cost,
                       SUM(CASE WHEN code IN ('Drill_Core','Drill_Chip_or_Open_hole') THEN line_cost ELSE 0 END) AS drilling_cost,
                       SUM(CASE WHEN code NOT IN ('Drill_Core','Drill_Chip_or_Open_hole') THEN line_cost ELSE 0 END) AS non_drilling_cost,
                       SUM(total_metres) AS total_metres,
                       COUNT(*) AS activity_count
                FROM activities WHERE {where}
                GROUP BY hole_num ORDER BY hole_num
            """, params)
            by_hole = [dict(r) for r in cur.fetchall()]

            # By date
            cur.execute(f"""
                SELECT date, hole_num,
                       SUM(line_cost) AS total_cost,
                       SUM(total_metres) AS total_metres
                FROM activities WHERE {where}
                GROUP BY date, hole_num ORDER BY date
            """, params)
            by_date = [dict(r) for r in cur.fetchall()]

            # Grand total
            cur.execute(f"SELECT SUM(line_cost) AS grand_total FROM activities WHERE {where}", params)
            grand = cur.fetchone()

    return {
        "by_hole": by_hole,
        "by_date": by_date,
        "grand_total": float(grand["grand_total"] or 0),
    }


# ── Analytics ─────────────────────────────────────────────────────────────────

@app.get("/analytics")
def get_analytics(hole: Optional[str] = Query(None)):
    query = "SELECT * FROM activities"
    params = {}
    if hole and hole != "all":
        query += " WHERE hole_num = %(hole)s"; params["hole"] = hole

    with get_conn() as conn:
        df = pd.read_sql(query, conn, params=params)

    if df.empty:
        return {"kpis": {}, "daily_categories": [], "drill_runs": [], "anomalies": [], "heatmap": []}

    def time_to_hours(t):
        try:
            parts = str(t).split(":")
            return int(parts[0]) + int(parts[1]) / 60
        except:
            return 0.0

    df["hours"] = df["total_time"].apply(time_to_hours)

    def categorise(code):
        if not code: return "Other"
        c = str(code)
        if any(p in c for p in ["Drill_Core", "Drill_Chip"]): return "Productive Drilling"
        if "Repair" in c: return "Repairs"
        if any(p in c for p in ["Standby","Grout","Cement_Set","AAC","Logger","Sumps"]): return "Standby / Delays"
        if "Circulation" in c: return "Circulation"
        if "Travel" in c: return "Travel"
        if any(p in c for p in ["Safety","Training","Prestart"]): return "Safety & Admin"
        if "Tripping" in c: return "Tripping Rods"
        return "Other"

    df["category"] = df["code"].apply(categorise)
    total_h  = df["hours"].sum()
    drill_h  = df[df["category"] == "Productive Drilling"]["hours"].sum()
    repair_h = df[df["category"] == "Repairs"]["hours"].sum()
    delay_h  = df[df["category"] == "Standby / Delays"]["hours"].sum()
    total_m  = df["total_metres"].dropna().sum()
    total_cost = float(df["line_cost"].dropna().sum())
    efficiency = round(drill_h / total_h * 100, 1) if total_h > 0 else 0

    daily     = df.groupby(["date", "category"])["hours"].sum().reset_index()
    daily_out = daily.to_dict(orient="records")

    runs = df[df["total_metres"].notna() & (df["total_metres"] > 0)].copy()
    runs = runs.sort_values(["date", "time_from"])
    runs["cumulative"] = runs.groupby("hole_num")["total_metres"].cumsum()
    drill_runs = runs[["date","hole_num","time_from","total_metres","cumulative","notes"]].to_dict(orient="records")

    anomalies = []
    for date, day in df.groupby("date"):
        dh = day[day["category"] == "Productive Drilling"]["hours"].sum()
        rh = day[day["category"] == "Repairs"]["hours"].sum()
        sh = day[day["category"] == "Standby / Delays"]["hours"].sum()
        hole = day["hole_num"].iloc[0] if len(day) else ""
        if dh == 0:
            anomalies.append({"date": date, "hole": hole, "type": "No Drilling", "severity": "critical", "detail": "Zero productive drilling hours"})
        if rh >= 2:
            anomalies.append({"date": date, "hole": hole, "type": "High Repairs", "severity": "warning", "detail": f"{rh:.1f}h in repairs/maintenance"})
        if sh >= 3:
            anomalies.append({"date": date, "hole": hole, "type": "High Standby", "severity": "caution", "detail": f"{sh:.1f}h on standby/delays"})

    short = df[df["total_metres"].notna() & (df["total_metres"] < 1.0) & (df["total_metres"] > 0)]
    for _, r in short.iterrows():
        anomalies.append({"date": r["date"], "hole": r["hole_num"], "type": "Short Run", "severity": "info", "detail": f"{r['total_metres']}m — {r['notes']}"})

    circ = df[df["code"].str.contains("Circulation_Lost", na=False)]
    for _, r in circ.iterrows():
        anomalies.append({"date": r["date"], "hole": r["hole_num"], "type": "Lost Circulation", "severity": "critical", "detail": r["notes"] or "Lost returns"})

    npt_cats = ["Repairs", "Standby / Delays", "Circulation"]
    npt = df[df["category"].isin(npt_cats)].groupby(["date", "category"])["hours"].sum().reset_index()

    return {
        "kpis": {
            "total_hours":  round(total_h, 1),
            "drill_hours":  round(drill_h, 1),
            "repair_hours": round(repair_h, 1),
            "delay_hours":  round(delay_h, 1),
            "total_metres": round(total_m, 1),
            "efficiency":   efficiency,
            "total_cost":   round(total_cost, 2),
        },
        "daily_categories": daily_out,
        "drill_runs":       drill_runs,
        "anomalies":        anomalies,
        "heatmap":          npt.to_dict(orient="records"),
    }



# ── Contractors ───────────────────────────────────────────────────────────────

@app.get("/contractors")
def get_contractors():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM contractors ORDER BY name")
            return [dict(r) for r in cur.fetchall()]

@app.post("/contractors")
def add_contractor(payload: dict):
    required = {"name"}
    if not required.issubset(payload.keys()):
        raise HTTPException(400, "name is required")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO contractors (name, short_code, active, notes)
                VALUES (%(name)s, %(short_code)s, %(active)s, %(notes)s)
                RETURNING id
            """, {
                "name": payload["name"],
                "short_code": payload.get("short_code", ""),
                "active": payload.get("active", True),
                "notes": payload.get("notes", ""),
            })
            new_id = cur.fetchone()["id"]
        conn.commit()
    return {"status": "created", "id": new_id}

@app.patch("/contractors/{cid}")
def update_contractor(cid: int, payload: dict):
    safe = {"name", "short_code", "active", "notes"}
    updates = {k: v for k, v in payload.items() if k in safe}
    if not updates:
        raise HTTPException(400, "No valid fields")
    set_clause = ", ".join(f"{k}=%({k})s" for k in updates)
    updates["cid"] = cid
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE contractors SET {set_clause} WHERE id=%(cid)s", updates)
        conn.commit()
    return {"status": "updated"}

@app.delete("/contractors/{cid}")
def delete_contractor(cid: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM contractors WHERE id=%s", (cid,))
        conn.commit()
    return {"status": "deleted"}


# ── Purchase Orders ───────────────────────────────────────────────────────────

@app.get("/purchase_orders")
def get_purchase_orders(contractor: Optional[str] = Query(None)):
    q = """
        SELECT p.*,
               COALESCE(SUM(a.line_cost), 0) AS spent_to_date,
               p.po_value - COALESCE(SUM(a.line_cost), 0) AS remaining
        FROM purchase_orders p
        LEFT JOIN activities a ON a.po_id = p.id
        WHERE 1=1
    """
    params = {}
    if contractor:
        q += " AND p.contractor_name = %(contractor)s"
        params["contractor"] = contractor
    q += " GROUP BY p.id ORDER BY p.issue_date DESC"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q, params)
            return [dict(r) for r in cur.fetchall()]

@app.post("/purchase_orders")
def add_purchase_order(payload: dict):
    required = {"po_number"}
    if not required.issubset(payload.keys()):
        raise HTTPException(400, "po_number is required")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO purchase_orders
                (po_number, contractor_name, description, issue_date, expiry_date, po_value, status, notes)
                VALUES (%(po_number)s,%(contractor_name)s,%(description)s,%(issue_date)s,
                        %(expiry_date)s,%(po_value)s,%(status)s,%(notes)s)
                RETURNING id
            """, {
                "po_number":       payload.get("po_number"),
                "contractor_name": payload.get("contractor_name", ""),
                "description":     payload.get("description", ""),
                "issue_date":      payload.get("issue_date", ""),
                "expiry_date":     payload.get("expiry_date", ""),
                "po_value":        payload.get("po_value", 0),
                "status":          payload.get("status", "Active"),
                "notes":           payload.get("notes", ""),
            })
            new_id = cur.fetchone()["id"]
        conn.commit()
    return {"status": "created", "id": new_id}

@app.patch("/purchase_orders/{po_id}")
def update_purchase_order(po_id: int, payload: dict):
    safe = {"po_number","contractor_name","description","issue_date","expiry_date","po_value","status","notes"}
    updates = {k: v for k, v in payload.items() if k in safe}
    if not updates:
        raise HTTPException(400, "No valid fields")
    set_clause = ", ".join(f"{k}=%({k})s" for k in updates)
    updates["po_id"] = po_id
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE purchase_orders SET {set_clause} WHERE id=%(po_id)s", updates)
        conn.commit()
    return {"status": "updated"}

@app.delete("/purchase_orders/{po_id}")
def delete_purchase_order(po_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM purchase_orders WHERE id=%s", (po_id,))
        conn.commit()
    return {"status": "deleted"}


@app.delete("/reset")
def reset_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            for tbl in ("activities", "consumables", "crew", "imported_files"):
                cur.execute(f"DELETE FROM {tbl}")
        conn.commit()
    return {"status": "cleared"}
