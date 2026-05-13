"""
DrillOps — FastAPI Backend v3
Database: Supabase (PostgreSQL)
Multi-contractor: every query is filtered by contractor
"""

import re
import os
import base64
import json
from io import BytesIO
from typing import Optional

import pdfplumber
import pandas as pd
import psycopg2
import psycopg2.extras
import httpx
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
                    unit        TEXT,
                    unit_price  FLOAT,
                    line_cost   FLOAT
                )
            """)
            for col, typedef in [
                ("contractor", "TEXT DEFAULT 'Allianz Drilling'"),
                ("unit_price", "FLOAT"),
                ("line_cost", "FLOAT"),
            ]:
                try:
                    cur.execute(f"ALTER TABLE consumables ADD COLUMN IF NOT EXISTS {col} {typedef}")
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
                CREATE TABLE IF NOT EXISTS source_files (
                    id          SERIAL PRIMARY KEY,
                    filename    TEXT NOT NULL,
                    contractor  TEXT,
                    file_type   TEXT,
                    pdf_data    BYTEA,
                    uploaded_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(filename, contractor)
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS consumable_rates (
                    id          SERIAL PRIMARY KEY,
                    contractor  TEXT NOT NULL DEFAULT 'Allianz Drilling',
                    year        TEXT NOT NULL DEFAULT '2025',
                    product     TEXT NOT NULL,
                    description TEXT,
                    unit_price  FLOAT DEFAULT 0,
                    unit        TEXT DEFAULT 'each'
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

            cur.execute("""
                CREATE TABLE IF NOT EXISTS projects (
                    id         SERIAL PRIMARY KEY,
                    contractor TEXT NOT NULL DEFAULT 'Allianz Drilling',
                    name       TEXT NOT NULL,
                    year       TEXT,
                    status     TEXT DEFAULT 'Active',
                    notes      TEXT,
                    UNIQUE(contractor, name)
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
                    pdf_data        BYTEA,
                    billing_month   TEXT
                )
            """)
            for col, typedef in [("pdf_data", "BYTEA"), ("billing_month", "TEXT")]:
                try:
                    cur.execute(f"ALTER TABLE invoices ADD COLUMN IF NOT EXISTS {col} {typedef}")
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


# ── Seed 2025 rates (Allianz Drilling ONLY — other contractors start blank) ───
def seed_2025_rates():
    """Only seeds rates for Allianz Drilling. All other contractors start with
    empty rate schedules which must be configured manually."""
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
                # Active rates (charged at active $/hr)
                (CON, YEAR, "H_Active",              "Active drilling rate (per hour)",                       745.00, "hour"),
                (CON, YEAR, "H_Change_Drill_Mthd",   "Changing drilling method (e.g. air to mud)",            745.00, "hour"),
                (CON, YEAR, "H_Tripping_Rods",       "Tripping drilling rods in and out of borehole",        745.00, "hour"),
                (CON, YEAR, "H_Circulation_Flush",    "Flushing borehole and attaining circulation",          745.00, "hour"),
                (CON, YEAR, "H_Circulation_Lost",     "Lost circulation time",                                745.00, "hour"),
                (CON, YEAR, "H_Reaming",              "Reaming time",                                         745.00, "hour"),
                (CON, YEAR, "H_Casing_Install",       "Installing casing",                                    745.00, "hour"),
                (CON, YEAR, "H_Rig_Cementing",        "Cementing boreholes using a drilling rig",             745.00, "hour"),
                # Inactive rates (charged at inactive $/hr)
                (CON, YEAR, "H_Inactive",             "Inactive / standby rate (per hour)",                   675.00, "hour"),
                (CON, YEAR, "H_Crew_Travel_On",       "Crew travel on company lease gate to drill location",  675.00, "hour"),
                (CON, YEAR, "H_Crew_Travel_Off",      "Crew travel off site",                                 675.00, "hour"),
                (CON, YEAR, "H_Rig_Move",             "Time spent moving between drill sites",                675.00, "hour"),
                (CON, YEAR, "H_Setup_Packup_Site",    "Moving between drill sites within a hub",              675.00, "hour"),
                (CON, YEAR, "H_Safety_Contractor",    "Contractor safety work",                               675.00, "hour"),
                (CON, YEAR, "H_Safety_Prestart",      "Pre-start safety (toolbox/shift-start talks)",         675.00, "hour"),
                (CON, YEAR, "H_Con_Collect_Plan",     "Collecting consumables from local stockpile",          675.00, "hour"),
                (CON, YEAR, "H_Standby_Sumps",        "Standby waiting on sumps",                             675.00, "hour"),
                (CON, YEAR, "H_Standby_AAC",          "Standby due to company instruction to stop work",      675.00, "hour"),
                (CON, YEAR, "H_Standby_Logger",       "Standby waiting for geophysical logger",               675.00, "hour"),
                (CON, YEAR, "H_Standby_Grout",        "Standby whilst grouting unit operating",               675.00, "hour"),
                (CON, YEAR, "H_Standby_Cement_Set",   "Standby waiting for cement to set",                    675.00, "hour"),
                (CON, YEAR, "H_Mud_Mixing",           "Mixing drilling fluids while plant not operating",     675.00, "hour"),
                (CON, YEAR, "H_Surface_Setup",        "Surface setup / moving between areas on hub",          675.00, "hour"),
                (CON, YEAR, "H_Training",             "Training, site inductions and authorisations",         675.00, "hour"),
                (CON, YEAR, "H_Water_Flow_Measure",   "Water flow measurement",                               675.00, "hour"),
                # Not chargeable
                (CON, YEAR, "H_Repairs",              "Repairs (not chargeable)",                              0.00, "hour"),
                (CON, YEAR, "Crew_Travel",            "Crew travel (not chargeable)",                          0.00, "hour"),
                # Day rates
                (CON, YEAR, "D_Backhoe",              "Backhoe in use on site",                              1850.00, "day"),
                (CON, YEAR, "D_Backhoe_Standby",      "Backhoe standby",                                     620.00, "day"),
                (CON, YEAR, "D_Water_Cart",           "Water cart in use on site (20,000L)",                 1650.00, "day"),
                (CON, YEAR, "D_Water_Cart_Standby",   "Water cart standby",                                   550.00, "day"),
                # Other rates
                (CON, YEAR, "H_Standby_NoCrew",       "Standby without crew (per day)",                     4470.00, "day"),
                (CON, YEAR, "H_Min_Shift",            "Minimum shift rate (per shift)",                     8940.00, "shift"),
                (CON, YEAR, "MOB",                    "Mobilisation to site",                              38760.00, "event"),
                (CON, YEAR, "DEMOB",                  "Demobilisation from site",                          38760.00, "event"),
            ]
            psycopg2.extras.execute_batch(cur, """
                INSERT INTO hourly_rates (contractor,year,code,description,rate,unit)
                VALUES (%s,%s,%s,%s,%s,%s)
            """, hourly)

            # Consumable rates
            consumables = [
                (CON, YEAR, "AMC CR650",                  "AMC CR650 drilling fluid",              127.10, "each"),
                (CON, YEAR, "MUDLOGIC SWELL HIB",         "Mudlogic Swell HIB",                    224.80, "each"),
                (CON, YEAR, "AMC HARD SET",               "AMC Hard Set cement additive",           66.55, "each"),
                (CON, YEAR, "AMC TORQ FREE XTRA 20LTR",  "AMC Torq Free Xtra 20L cube",          156.40, "each"),
                (CON, YEAR, "GP CEMENT",                  "General purpose cement",                 11.47, "bag"),
                (CON, YEAR, "PART A FOAM",                "Part A foam",                            18.86, "each"),
                (CON, YEAR, "PART B FOAM",                "Part B foam",                            18.86, "each"),
                (CON, YEAR, "AMC SUPERLUBE",              "AMC Superlube drilling lubricant",      150.26, "each"),
                (CON, YEAR, "AMC SUPERFOAM",              "AMC Superfoam",                         127.36, "each"),
                (CON, YEAR, "AMC BEN",                    "AMC Bentonite",                           0.00, "each"),
                (CON, YEAR, "AMC GEL",                    "AMC Gel",                                 0.00, "each"),
                (CON, YEAR, "PVC CASING 100MM CLASS 9",   "PVC Casing 100mm Class 9 (18m)",         0.00, "metre"),
            ]
            cur.execute("SELECT COUNT(*) AS n FROM consumable_rates WHERE year=%s AND contractor=%s", (YEAR, CON))
            if cur.fetchone()["n"] == 0:
                psycopg2.extras.execute_batch(cur, """
                    INSERT INTO consumable_rates (contractor,year,product,description,unit_price,unit)
                    VALUES (%s,%s,%s,%s,%s,%s)
                """, consumables)
        conn.commit()


seed_2025_rates()


# ── Pricing engine ────────────────────────────────────────────────────────────
# Codes charged at Active rate ($/hr)
ACTIVE_CODES = {
    "Drill_Core","Drill_Chip_or_Open_hole",
    "H_Tripping_Rods","H_Circulation_Flush","H_Circulation_Lost",
    "H_Reaming","H_Change_Drill_Mthd",
    "H_Casing_Install","H_Rig_Cementing",
}
# Codes charged at Inactive rate ($/hr)
INACTIVE_CODES = {
    "H_Crew_Travel_On","H_Crew_Travel_Off","H_Rig_Move","H_Setup_Packup_Site",
    "H_Safety_Contractor","H_Safety_Prestart","H_Con_Collect_Plan",
    "H_Standby_Sumps","H_Standby_AAC","H_Standby_Logger","H_Standby_Grout",
    "H_Standby_Cement_Set","H_Standby_Cement_set",
    "H_Mud_Mixing","H_Surface_Setup","H_Training","H_Water_Flow_Measure",
}
# Not chargeable
NOT_CHARGEABLE = {"H_Repairs","Crew_Travel"}
STANDBY_CODES = {
    "H_Standby_Sumps","H_Standby_AAC","H_Standby_Logger",
    "H_Standby_Grout","H_Standby_Cement_Set","H_Standby_Cement_set",
}
DAY_RATE_CODES = {
    "D_Backhoe":                  ("D_Backhoe",            "day"),
    "D_Backhoe_Day_Rate":         ("D_Backhoe",            "day"),
    "D_Backhoe - Day Rate":       ("D_Backhoe",            "day"),
    "D_Backhoe - Standby Rate":   ("D_Backhoe_Standby",    "day"),
    "D_Backhoe_Standby":          ("D_Backhoe_Standby",    "day"),
    "D_WaterCart_Day_Rate":       ("D_Water_Cart",         "day"),
    "D_Water_Cart_Day_Rate":      ("D_Water_Cart",         "day"),
    "D_Water_Cart":               ("D_Water_Cart",         "day"),
    "D_Water Cart - Standby Rate":("D_Water_Cart_Standby", "day"),
    "D_Water_Cart_Standby":       ("D_Water_Cart_Standby", "day"),
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
        # Try exact year first, then fall back to nearest available
        for try_year in [year, str(int(year)-1), str(int(year)+1), "2025"]:
            cur.execute("""
                SELECT rate FROM drilling_rates
                WHERE contractor=%s AND year=%s AND bit_type=%s
                  AND depth_from<=%s AND depth_to>%s
                ORDER BY depth_from LIMIT 1
            """, (contractor, try_year, bit_key, depth, depth))
            r = cur.fetchone()
            if r: return float(r["rate"])
        return None

    def get_hr(code_key):
        # Try exact year first, then fall back to nearest available
        for try_year in [year, str(int(year)-1), str(int(year)+1), "2025"]:
            cur.execute("SELECT rate FROM hourly_rates WHERE contractor=%s AND year=%s AND code=%s",
                        (contractor, try_year, code_key))
            r = cur.fetchone()
            if r: return float(r["rate"])
        return None

    if code in ("Drill_Core","Drill_Chip_or_Open_hole") and total_metres and total_metres > 0:
        bk = BIT_TYPE_MAP.get(bit_type.upper().replace(" ","_"), "PCD_S" if "Chip" in code else "HQ_HQ3")
        r = get_dr(bk, metres_to or 0)
        if r:
            unit_rate  = r
            quantity   = total_metres
            line_cost  = round(r * total_metres, 2)
            rate_basis = f"$/m @ {(metres_to or 0):.0f}m ({bk})"
    elif any(k in code for k in DAY_RATE_CODES) or any(code in k for k in DAY_RATE_CODES):
        matched = next((v for k,v in DAY_RATE_CODES.items() if k in code or code in k), None)
        if matched:
            r = get_hr(matched[0])
            if r:
                unit_rate  = r; quantity = 1; line_cost = r
                rate_basis = f"${r:,.2f}/{matched[1]}"
    elif code in NOT_CHARGEABLE:
        unit_rate = 0; quantity = round(hours, 2) if hours > 0 else 1
        line_cost = 0; rate_basis = "not chargeable"
    elif code in STANDBY_CODES or "Standby" in code:
        r = get_hr(code) or get_hr("H_Inactive")
        if r:
            qty = round(hours, 2) if hours > 0 else 1
            unit_rate  = r; quantity = qty
            line_cost  = round(r * qty, 2)
            rate_basis = f"inactive ${r:,.2f}/hr x {qty}h"
    elif code in INACTIVE_CODES:
        r = get_hr(code) or get_hr("H_Inactive")
        if r:
            qty = round(hours, 2) if hours > 0 else 1
            unit_rate  = r; quantity = qty
            line_cost  = round(r * qty, 2)
            rate_basis = f"inactive ${r:,.2f}/hr x {qty}h"
    elif hours > 0 and (code in ACTIVE_CODES or "H_" in code):
        r = get_hr(code) or get_hr("H_Active")
        if r:
            unit_rate  = r; quantity = round(hours,2)
            line_cost  = round(r * hours, 2); rate_basis = f"active ${r:,.2f}/hr x {hours:.2f}h"

    # Fallback: any activity with hours but no match above
    if line_cost is None and hours > 0 and code:
        # Check if we have a specific rate for this code
        r = get_hr(code)
        if r and r > 0:
            unit_rate = r; quantity = round(hours, 2)
            line_cost = round(r * hours, 2); rate_basis = f"${r:,.2f}/hr x {hours:.2f}h (code match)"
        else:
            r = get_hr("H_Active")
            if r:
                unit_rate = r; quantity = round(hours, 2)
                line_cost = round(r * hours, 2); rate_basis = f"fallback active ${r:,.2f}/hr x {hours:.2f}h"

    # Fallback 2: code present but no hours and no match above
    if line_cost is None and code and not hours:
        r = get_hr(code)
        if r and r > 0:
            unit_rate = r; quantity = 1
            line_cost = r; rate_basis = f"${r:,.2f} (1 unit, code match)"
        elif "PVC" in code or "Casing" in code or "Cement" in code:
            rate_basis = "consumable - no rate"
        elif "D_" in code:
            rate_basis = "day rate code - check schedule of rates"

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


def detect_pdf_format(text):
    """Detect whether this is standard EOS, ADR001-decimal, or ADR001-standard format."""
    if "EXPLORATION DAILY SUPERVISORS REPORT" in text:
        # ADR001 template — but check if durations are decimal (March) or H:MM (May+)
        # Look for a CODE column or H:MM style third time field
        lines = text.splitlines()
        for line in lines:
            line = line.strip()
            # If line has 3 H:MM times and a code at end → standard format with ADR001 header
            if re.search(r'\d{1,2}:\d{2}\s+\d{1,2}:\d{2}\s+\d{1,2}:\d{2}\s+\S', line):
                return "standard"
            # If line has decimal duration (0.25, 1.50) → ADR001 decimal format
            if re.search(r'\d{1,2}:\d{2}\s+\d{1,2}:\d{2}\s+\d+\.\d+\s+\d', line):
                return "adr001"
        # If CODE appears in the column header → standard
        if re.search(r'TOTAL\s+METRES\s+CODE', text):
            return "standard"
        return "adr001"  # fallback for old format
    return "standard"


def parse_activities_adr001(text, header, filename, contractor):
    """Parse ADR001 format: decimal durations, full bit type names."""
    # ADR001 header may have hole_num at different position
    m = re.search(r"HOLE #:\s*(\S+)", text, re.IGNORECASE)
    if m and not header.get("hole_num"):
        header["hole_num"] = m.group(1)

    m = re.search(r"DRILL RIG #:\s*(\S+)", text, re.IGNORECASE)
    if m and not header.get("drill_rig"):
        header["drill_rig"] = m.group(1)

    # ADR001 row pattern: notes time_from time_to decimal_duration [bit_type diameter] metres_from metres_to metres_drilled
    # e.g. "flush hole 8:15 8:30 0.25 0 0 0"
    # e.g. "HQ - 211.40m to 214.40m... 16:30 17:00 0.50 HQ / HQ3 (Triple Tube / Wireline) 96 mm 211.4 214.4 3"
    row_re = re.compile(
        r"^(.+?)\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s+(\d+\.?\d*)"
        r"\s+(?:([A-Z][A-Z\s/()]*?(?:Wireline|Tube))\s+(\d+\s*mm)\s+)?"
        r"(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s*$",
        re.IGNORECASE
    )

    # Simpler pattern for most lines: notes time_from time_to decimal 0 0 0
    simple_re = re.compile(
        r"^(.+?)\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s*$"
    )

    # Pattern for lines with no times: "Backhoe on standby 0:00 0 0 0"
    no_time_re = re.compile(
        r"^(.+?)\s+0:00\s+0\s+0\s+0\s*$"
    )

    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        # Skip header lines, total lines, crew section
        if line.startswith("NOTES") or line.startswith("TOTAL DURATION"):
            continue
        if line.startswith("PEOPLE ON") or line.startswith("Position") or line.startswith("Supervisor") or line.startswith("Driller") or line.startswith("Trainee") or line.startswith("Offsider") or line.startswith("Operator"):
            continue
        if line.startswith("CONSUMABLES") or line.startswith("Consumable"):
            continue
        if line.startswith("CLIENT:") or line.startswith("SHIFT:") or line.startswith("ALLIANZ") or line.startswith("Delay Hours"):
            continue
        if line.startswith("Non Drilling") or "REPRESENTATIVE" in line:
            continue
        if line == "0:00 0 0 0":
            continue

        # Try no-time pattern first (Backhoe on standby, Water cart, etc)
        nm = no_time_re.match(line)
        if nm:
            desc = nm.group(1).strip()
            if not desc or desc in ("0", ""):
                continue
            # Determine code from description
            code = ""
            dl = desc.lower()
            if "backhoe" in dl and "standby" in dl:
                code = "D_Backhoe_Standby"
            elif "backhoe" in dl:
                code = "D_Backhoe"
            elif "water cart" in dl and "standby" in dl:
                code = "D_Water_Cart_Standby"
            elif "water cart" in dl:
                code = "D_Water_Cart"

            if code:
                rows.append({
                    "source_file": filename, "contractor": contractor,
                    "date": header.get("date",""), "hole_num": header.get("hole_num",""),
                    "site_name": header.get("site_name",""), "location": header.get("location",""),
                    "drill_rig": header.get("drill_rig",""), "client": header.get("client",""),
                    "contract": header.get("contract",""), "shift": header.get("shift",""),
                    "time_from": "", "time_to": "", "total_time": "",
                    "bit_type": "", "diameter": "",
                    "metres_from": None, "metres_to": None, "total_metres": None,
                    "code": code, "notes": desc,
                    "rate_year": None, "unit_rate": None, "quantity": None,
                    "line_cost": None, "rate_basis": None, "po_id": None,
                })
            continue

        # Try the full HQ drilling line pattern
        rm = row_re.match(line)
        if rm:
            notes, tf, tt, dur, bt, diam, mf, mt, mto = rm.groups()
            # Convert decimal duration to H:MM
            dur_f = float(dur) if dur else 0
            h = int(dur_f)
            m_val = int((dur_f - h) * 60)
            total_time = f"{h}:{m_val:02d}"

            bit_type = ""
            if bt:
                btl = bt.strip().upper()
                if "HQ" in btl:
                    bit_type = "HQ_HQ3"
                elif "PCD" in btl:
                    bit_type = "PCD"
                elif "NQ" in btl:
                    bit_type = "NQ"

            rows.append({
                "source_file": filename, "contractor": contractor,
                "date": header.get("date",""), "hole_num": header.get("hole_num",""),
                "site_name": header.get("site_name",""), "location": header.get("location",""),
                "drill_rig": header.get("drill_rig",""), "client": header.get("client",""),
                "contract": header.get("contract",""), "shift": header.get("shift",""),
                "time_from": tf, "time_to": tt, "total_time": total_time,
                "bit_type": bit_type, "diameter": (diam or "").strip(),
                "metres_from": float(mf) if mf and float(mf) > 0 else None,
                "metres_to": float(mt) if mt and float(mt) > 0 else None,
                "total_metres": float(mto) if mto and float(mto) > 0 else None,
                "code": "", "notes": notes.strip(),
                "rate_year": None, "unit_rate": None, "quantity": None,
                "line_cost": None, "rate_basis": None, "po_id": None,
            })
            continue

        # Try simple pattern (most common: notes time_from time_to decimal mf mt md)
        sm = simple_re.match(line)
        if sm:
            notes, tf, tt, dur, mf, mt, mto = sm.groups()
            dur_f = float(dur) if dur else 0
            if dur_f == 0 and tf == "0" and tt == "0":
                continue
            h = int(dur_f)
            m_val = int((dur_f - h) * 60)
            total_time = f"{h}:{m_val:02d}"

            rows.append({
                "source_file": filename, "contractor": contractor,
                "date": header.get("date",""), "hole_num": header.get("hole_num",""),
                "site_name": header.get("site_name",""), "location": header.get("location",""),
                "drill_rig": header.get("drill_rig",""), "client": header.get("client",""),
                "contract": header.get("contract",""), "shift": header.get("shift",""),
                "time_from": tf, "time_to": tt, "total_time": total_time,
                "bit_type": "", "diameter": "",
                "metres_from": float(mf) if mf and float(mf) > 0 else None,
                "metres_to": float(mt) if mt and float(mt) > 0 else None,
                "total_metres": float(mto) if mto and float(mto) > 0 else None,
                "code": "", "notes": notes.strip(),
                "rate_year": None, "unit_rate": None, "quantity": None,
                "line_cost": None, "rate_basis": None, "po_id": None,
            })

    return rows


def parse_activities(text, header, filename, contractor):
    time_pat = r"\d{1,2}:\d{2}"

    # Pre-process text: join split lines where a code wraps (e.g. "Drill_Chip_or_Open_hol\n...e")
    lines_raw = text.splitlines()
    lines_joined = []
    i = 0
    while i < len(lines_raw):
        line = lines_raw[i].strip()
        # Check if this line is a partial code that continues on the next line
        # e.g. "Drill_Chip_or_Open_hol" followed by "e" or "drill to 243.55m 8:45..."
        if (line.endswith("_hol") or line.endswith("_Open_hol") or
            line.endswith("_Da") or line.endswith("_Day_Ra") or
            line.endswith("_Standby")):
            if i+1 < len(lines_raw):
                next_line = lines_raw[i+1].strip()
                # If next line starts with the rest of the code or has time data
                if re.match(r'^[a-z_]', next_line) and len(next_line) < 5:
                    # Just the end of a code like "e" or "te"
                    lines_joined.append(line + next_line)
                    i += 2
                    continue
                elif re.search(time_pat, next_line):
                    # Next line has the actual data — prepend the code
                    code_part = line.split()[-1] if line.split() else ""
                    lines_joined.append(next_line + " " + code_part)
                    i += 2
                    continue
        # Check if this line IS a dangling code fragment
        if re.match(r'^[a-z]\w*$', line) and len(line) < 5 and lines_joined:
            # Append to previous line
            lines_joined[-1] = lines_joined[-1] + line
            i += 1
            continue
        lines_joined.append(line)
        i += 1

    # Primary pattern: lines with 3 time fields (time_from, time_to, total_time)
    # Now handles PCD with diameter like: PCD 4" or PCD 5-7/8" or HQ_HQ3
    row_re = re.compile(
        r"^(.*?)(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})"
        r'(?:\s+(HQ_HQ3|HQ|PCD|NQ|PQ)\s+([^\s]+))?'
        r"(?:\s+(\d+\.?\d*))?(?:\s+(\d+\.?\d*))?(?:\s+(\d+\.?\d*))?"
        r"(?:\s+([\w_]+))?\s*$", re.IGNORECASE)

    # Secondary pattern: lines with just a code and maybe numbers (day rates, consumables as activities)
    code_only_re = re.compile(
        r"^(.*?)\s+(D_\w+|H_\w+|PVC[\w\s]+|Cement[\w\s]*)\s*"
        r"(?:(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*))?"
        r"\s*$", re.IGNORECASE)

    # Tertiary: lines with a code at the end and optional quantities but no times
    any_code_re = re.compile(
        r"^(.*?)\s+([\w_][\w_\-]+(?:\s*[\w_\-]+)*)\s*$"
    )

    rows = []
    known_codes = {
        "D_WaterCart_Day_Rate", "D_Water_Cart", "D_Water_Cart_Day_Rate",
        "D_Water_Cart_Standby", "D_Backhoe", "D_Backhoe_Day_Rate",
        "D_Backhoe_Standby", "H_Standby_Cement_Set", "H_Standby_Cement_set",
        "H_Standby_Sumps", "H_Standby_AAC", "H_Standby_Logger",
        "H_Standby_Grout", "H_Water_Flow_Measure",
        "Drill_Core", "Drill_Chip_or_Open_hole",
        "H_Tripping_Rods", "H_Circulation_Flush", "H_Circulation_Lost",
        "H_Reaming", "H_Change_Drill_Mthd", "H_Surface_Setup",
        "H_Casing_Install", "H_Rig_Cementing", "H_Mud_Mixing",
        "H_Repairs", "H_Training", "H_Safety_Prestart",
        "H_Safety_Contractor", "Crew_Travel", "MOB", "DEMOB",
        "H_Con_Collect_Plan", "H_Crew_Travel_On", "H_Crew_Travel_Off",
    }

    for line in lines_joined:
        line = line.strip()
        if not line:
            continue

        # Try primary pattern (with times)
        time_count = len(re.findall(time_pat, line))
        if time_count >= 2:
            m = row_re.match(line)
            if m:
                notes, tf, tt, total, bt, diam, mf, mt, mto, code = m.groups()
                rows.append({
                    "source_file": filename, "contractor": contractor,
                    "date": header.get("date",""), "hole_num": header.get("hole_num",""),
                    "site_name": header.get("site_name",""), "location": header.get("location",""),
                    "drill_rig": header.get("drill_rig",""), "client": header.get("client",""),
                    "contract": header.get("contract",""), "shift": header.get("shift",""),
                    "time_from": tf, "time_to": tt, "total_time": total,
                    "bit_type": bt or "", "diameter": diam or "",
                    "metres_from": float(mf) if mf else None,
                    "metres_to": float(mt) if mt else None,
                    "total_metres": float(mto) if mto else None,
                    "code": code or "", "notes": notes.strip(),
                    "rate_year": None, "unit_rate": None, "quantity": None,
                    "line_cost": None, "rate_basis": None, "po_id": None,
                })
                continue

        # Try secondary: line contains a known code or day-rate pattern
        # Check if any known code appears in the line
        found_code = None
        for kc in known_codes:
            if kc in line or kc.replace("_", " ") in line:
                found_code = kc
                break

        # Also catch lines like "D_Backhoe - Day Rate" or "PVC Casing 100mm Class 9"
        if not found_code:
            if re.search(r"D_\w+|PVC\s+Casing|Water.?Cart|Backhoe", line, re.IGNORECASE):
                # Extract the code-like part
                cm = re.search(r"(D_\w+[\w\s\-]*|PVC\s+Casing[\w\s]*|H_\w+)", line)
                if cm:
                    found_code = cm.group(1).strip()

        if found_code:
            # Extract any numbers from the line
            nums = re.findall(r"(\d+\.?\d*)", line)
            # Try to find times
            times = re.findall(r"(\d{1,2}:\d{2})", line)
            tf = times[0] if len(times) > 0 else ""
            tt = times[1] if len(times) > 1 else ""
            total = times[2] if len(times) > 2 else ""

            # Get metres if present (numbers that aren't part of times)
            non_time_nums = [n for n in nums if ":" not in n and float(n) < 9000]
            mf = float(non_time_nums[0]) if len(non_time_nums) > 0 and float(non_time_nums[0]) > 0 else None
            mt = float(non_time_nums[1]) if len(non_time_nums) > 1 else None
            mto = float(non_time_nums[2]) if len(non_time_nums) > 2 else None

            # Clean up notes - remove the code from the line
            notes = line.replace(found_code, "").strip()
            notes = re.sub(r"\d{1,2}:\d{2}", "", notes).strip()
            notes = re.sub(r"\s+", " ", notes).strip()

            rows.append({
                "source_file": filename, "contractor": contractor,
                "date": header.get("date",""), "hole_num": header.get("hole_num",""),
                "site_name": header.get("site_name",""), "location": header.get("location",""),
                "drill_rig": header.get("drill_rig",""), "client": header.get("client",""),
                "contract": header.get("contract",""), "shift": header.get("shift",""),
                "time_from": tf, "time_to": tt, "total_time": total,
                "bit_type": "", "diameter": "",
                "metres_from": mf, "metres_to": mt, "total_metres": mto,
                "code": found_code, "notes": notes,
                "rate_year": None, "unit_rate": None, "quantity": None,
                "line_cost": None, "rate_basis": None, "po_id": None,
            })

    return rows


def parse_consumables(text, header, filename, contractor):
    rows = []
    m = re.search(r"CONSUMABLES\s*\n(.*?)(?:ALLIANZ REPRESENTATIVE|CONTRACTOR REPRESENTATIVE|$)", text, re.DOTALL|re.IGNORECASE)
    if not m: return rows
    block = m.group(1)
    # Match any consumable line - just grab the product name, set qty=1
    # Patterns: "AMC CR650 drum 1 Ltrs" or "AMC CR650 1" or "Fuel (Diesel) Ltrs"
    for line in block.splitlines():
        line = line.strip()
        if not line or line.lower().startswith('consumable') or line.lower().startswith('type') or line.lower().startswith('quantity'):
            continue
        # Skip lines that are just numbers or units
        if re.match(r'^[\d\s]+$', line) or re.match(r'^(Ltrs?|Kgs?|Mtrs?|drum|bucket|bags?)$', line, re.IGNORECASE):
            continue
        # Extract product name - strip trailing numbers, units, and quantity+unit combos
        product = re.sub(r'\s+(drum|bucket|bags?|tins?|slurry|Kgs?|Ltrs?|Mtrs?|cube|each)\s+\d+\s+\S+\s*$', '', line, flags=re.IGNORECASE).strip()
        product = re.sub(r'\s+(drum|bucket|bags?|tins?|slurry|Kgs?|Ltrs?|Mtrs?|cube|each)\s+\d+\s*$', '', product, flags=re.IGNORECASE).strip()
        product = re.sub(r'\s+(drum|bucket|bags?|tins?|slurry|Kgs?|Ltrs?|Mtrs?|cube|each)\s*$', '', product, flags=re.IGNORECASE).strip()
        product = re.sub(r'\s+\d+\s+(drum|bucket|bags?|tins?|slurry|Kgs?|Ltrs?|Mtrs?|cube|each)\s*$', '', product, flags=re.IGNORECASE).strip()
        product = re.sub(r'\s+\d+\s*$', '', product).strip()
        if not product or len(product) < 3:
            continue
        # Determine unit from original line
        unit_m = re.search(r'(drum|bucket|bags?|tins?|slurry|Kgs?|Ltrs?|Mtrs?|cube|each)', line, re.IGNORECASE)
        unit = unit_m.group(1) if unit_m else 'each'
        rows.append({
            "source_file": filename, "contractor": contractor,
            "date": header.get("date",""), "hole_num": header.get("hole_num",""),
            "site_name": header.get("site_name",""),
            "consumable": product, "type": product, "quantity": "1", "unit": unit,
            "unit_price": None, "line_cost": None,
        })
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
    fmt = detect_pdf_format(text)
    if fmt == "adr001":
        acts = parse_activities_adr001(text, header, filename, contractor)
    else:
        acts = parse_activities(text, header, filename, contractor)
    cons   = parse_consumables(text, header, filename, contractor)
    crew   = parse_crew(text, header, filename, contractor)

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Load all rates into memory for fast pricing (same as reprice)
            cur.execute("SELECT * FROM drilling_rates WHERE contractor=%s", (contractor,))
            all_dr = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT * FROM hourly_rates WHERE contractor=%s", (contractor,))
            all_hr = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT * FROM consumable_rates WHERE contractor=%s", (contractor,))
            all_cr = [dict(r) for r in cur.fetchall()]

        hr_lookup = {}
        for r in all_hr:
            hr_lookup[(r["year"], r["code"])] = float(r["rate"])
        dr_lookup = {}
        for r in all_dr:
            key = (r["year"], r["bit_type"])
            if key not in dr_lookup: dr_lookup[key] = []
            dr_lookup[key].append((float(r["depth_from"]), float(r["depth_to"]), float(r["rate"])))
        cr_lookup = {}
        for r in all_cr:
            cr_lookup[r["product"].strip().upper()] = float(r["unit_price"])
            cr_lookup[r["product"].strip().upper().replace(" ","")] = float(r["unit_price"])

        def _get_hr(code, year):
            for ty in [year, str(int(year)-1) if year.isdigit() else year, str(int(year)+1) if year.isdigit() else year, "2025"]:
                r = hr_lookup.get((ty, code))
                if r is not None: return r
            return None

        def _get_dr(bit_key, depth, year):
            for ty in [year, str(int(year)-1) if year.isdigit() else year, str(int(year)+1) if year.isdigit() else year, "2025"]:
                for frm, to, rate in dr_lookup.get((ty, bit_key), []):
                    if frm <= depth < to: return rate
            return None

        def _price_row(row):
            code = row.get("code","") or ""
            total_time = row.get("total_time","") or ""
            hours = 0
            mt = re.match(r"(\d+):(\d+)", str(total_time))
            if mt: hours = int(mt.group(1)) + int(mt.group(2))/60.0
            else:
                try: hours = float(total_time)
                except: pass

            bit_type = row.get("bit_type","") or ""
            metres = 0
            try: metres = float(row.get("total_metres",0) or 0)
            except: pass
            depth = None
            mf, mto = row.get("metres_from"), row.get("metres_to")
            if mf is not None and mto is not None:
                try: depth = (float(mf) + float(mto)) / 2
                except: pass

            date_str = row.get("date","") or ""
            year = "2026"
            for p in date_str.replace("-","/").split("/"):
                if len(p)==4 and p.isdigit(): year = p; break

            lc = None; ur = None; qty = None; rb = None

            # Drilling metres
            if metres > 0 and bit_type and depth is not None:
                bk = bit_type.replace(" ","_").upper()
                # Map common bit types to rate card keys
                bit_map = {"HQ_HQ3":"HQ_HQ3","HQ":"HQ_HQ3","NQ":"HQ_HQ3","PCD":"PCD_S","PQ":"HQ_HQ3"}
                bk = bit_map.get(bk, "PCD_S" if "Chip" in code or "PCD" in bk else "HQ_HQ3")
                r = _get_dr(bk, depth, year)
                if r:
                    ur = r; qty = round(metres,2); lc = round(r*metres,2); rb = f"${r:.2f}/m x {metres:.2f}m"

            # Day rates
            if lc is None:
                for dk, (dk_code, dk_unit) in DAY_RATE_CODES.items():
                    if dk in code or code in dk:
                        r = _get_hr(dk_code, year)
                        if r: ur = r; qty = 1; lc = r; rb = f"${r:,.2f}/{dk_unit}"
                        break

            # Not chargeable
            if lc is None and code in NOT_CHARGEABLE:
                ur = 0; qty = round(hours,2) if hours > 0 else 1; lc = 0; rb = "not chargeable"

            # Standby/inactive
            if lc is None and (code in STANDBY_CODES or "Standby" in code or code in INACTIVE_CODES):
                r = _get_hr(code, year) or _get_hr("H_Inactive", year)
                if r:
                    q = round(hours,2) if hours > 0 else 1
                    ur = r; qty = q; lc = round(r*q,2); rb = f"inactive ${r:,.2f}/hr x {q}"

            # Active
            if lc is None and hours > 0 and (code in ACTIVE_CODES or code.startswith("H_")):
                r = _get_hr(code, year) or _get_hr("H_Active", year)
                if r:
                    ur = r; qty = round(hours,2); lc = round(r*hours,2); rb = f"active ${r:,.2f}/hr x {hours:.2f}h"

            # Fallback
            if lc is None and hours > 0 and code:
                r = _get_hr("H_Active", year)
                if r:
                    ur = r; qty = round(hours,2); lc = round(r*hours,2); rb = f"fallback ${r:,.2f}/hr x {hours:.2f}h"

            row["rate_year"] = year; row["unit_rate"] = ur; row["quantity"] = qty
            row["line_cost"] = lc; row["rate_basis"] = rb
            return row

        # Price all activities in memory
        acts = [_price_row(row) for row in acts]

        # Price consumables
        for c in cons:
            product = (c.get("consumable") or c.get("type") or "").strip().upper()
            price = cr_lookup.get(product) or cr_lookup.get(product.replace(" ",""))
            if price is None:
                for rk, rv in cr_lookup.items():
                    if rk in product or product in rk:
                        price = rv; break
            if price is not None and price > 0:
                qty = 1
                try: qty = float(c.get("quantity") or 1)
                except: pass
                c["unit_price"] = price
                c["line_cost"] = round(price * qty, 2)
            else:
                c["unit_price"] = None
                c["line_cost"] = None

        with conn.cursor() as cur:
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
                    INSERT INTO consumables (source_file,contractor,date,hole_num,site_name,consumable,type,quantity,unit,unit_price,line_cost)
                    VALUES (%(source_file)s,%(contractor)s,%(date)s,%(hole_num)s,%(site_name)s,%(consumable)s,%(type)s,%(quantity)s,%(unit)s,%(unit_price)s,%(line_cost)s)
                """, cons)
            if crew:
                psycopg2.extras.execute_batch(cur, """
                    INSERT INTO crew (source_file,contractor,date,hole_num,site_name,role,name,hours)
                    VALUES (%(source_file)s,%(contractor)s,%(date)s,%(hole_num)s,%(site_name)s,%(role)s,%(name)s,%(hours)s)
                """, crew)
            cur.execute("INSERT INTO imported_files (filename,contractor) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                        (filename, contractor))
            cur.execute("""
                INSERT INTO source_files (filename, contractor, file_type, pdf_data)
                VALUES (%s, %s, 'eos', %s) ON CONFLICT (filename, contractor) DO NOTHING
            """, (filename, contractor, psycopg2.Binary(content)))
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
    if dates and dates.strip():
        dl = [d.strip() for d in dates.split(",") if d.strip()]
        if dl: conds.append("date=ANY(%(dates)s)"); params["dates"] = dl
    if holes and holes.strip():
        hl = [h.strip() for h in holes.split(",") if h.strip()]
        if hl: conds.append("hole_num=ANY(%(holes)s)"); params["holes"] = hl
    if sites and sites.strip():
        sl = [s.strip() for s in sites.split(",") if s.strip()]
        if sl: conds.append("site_name=ANY(%(sites)s)"); params["sites"] = sl
    if codes and codes.strip():
        cl = [c.strip() for c in codes.split(",") if c.strip()]
        if cl: conds.append("code=ANY(%(codes)s)"); params["codes"] = cl
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
    if dates and dates.strip():
        dl = [d.strip() for d in dates.split(",") if d.strip()]
        if dl:
            q += " AND date=ANY(%(dates)s)"; p["dates"] = dl
    q += " ORDER BY date"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(q,p); return [dict(r) for r in cur.fetchall()]


@app.patch("/consumables/{row_id}")
async def update_consumable(row_id: int, request: Request):
    payload = await request.json()
    safe = {"date","hole_num","site_name","consumable","type","quantity","unit","unit_price","line_cost"}
    updates = {k:v for k,v in payload.items() if k in safe}
    if not updates: raise HTTPException(400, "No valid fields")
    # Auto-recalculate line_cost if unit_price or quantity changed
    if "unit_price" in updates or "quantity" in updates:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM consumables WHERE id=%s", (row_id,))
                row = dict(cur.fetchone()) if cur.rowcount else {}
        qty = updates.get("quantity", row.get("quantity", 1))
        up = updates.get("unit_price", row.get("unit_price", 0))
        try:
            updates["line_cost"] = round(float(up or 0) * float(qty or 1), 2)
        except (ValueError, TypeError):
            pass
    set_clause = ",".join(f"{k}=%({k})s" for k in updates)
    updates["row_id"] = row_id
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE consumables SET {set_clause} WHERE id=%(row_id)s", updates)
        conn.commit()
    return {"status": "updated"}


@app.get("/crew")
def get_crew(contractor: str = Query(...), dates: Optional[str] = Query(None)):
    q = "SELECT * FROM crew WHERE contractor=%(contractor)s"
    p = {"contractor": contractor}
    if dates and dates.strip():
        dl = [d.strip() for d in dates.split(",") if d.strip()]
        if dl:
            q += " AND date=ANY(%(dates)s)"; p["dates"] = dl
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


# ── Consumable Rates ──────────────────────────────────────────────────────────

@app.get("/rates/consumables")
def get_consumable_rates(contractor: str = Query(...), year: Optional[str]=Query(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            if year:
                cur.execute("SELECT * FROM consumable_rates WHERE contractor=%s AND year=%s ORDER BY product", (contractor, year))
            else:
                cur.execute("SELECT * FROM consumable_rates WHERE contractor=%s ORDER BY year,product", (contractor,))
            return [dict(r) for r in cur.fetchall()]


@app.put("/rates/consumables/{rid}")
def update_consumable_rate(rid: int, payload: dict):
    safe = {"product","description","unit_price","unit","year"}
    u = {k:v for k,v in payload.items() if k in safe}
    if not u: raise HTTPException(400,"No valid fields")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE consumable_rates SET {','.join(f'{k}=%({k})s' for k in u)} WHERE id=%(id)s", {**u,"id":rid})
        conn.commit()
    return {"status":"updated"}


@app.post("/rates/consumables")
def add_consumable_rate(payload: dict):
    req = {"contractor","year","product","unit_price"}
    if not req.issubset(payload): raise HTTPException(400, f"Required: {req}")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""INSERT INTO consumable_rates (contractor,year,product,description,unit_price,unit)
                VALUES (%(contractor)s,%(year)s,%(product)s,%(description)s,%(unit_price)s,%(unit)s) RETURNING id""",
                {**{"description":"","unit":"each"},**payload})
            nid = cur.fetchone()["id"]
        conn.commit()
    return {"status":"created","id":nid}


@app.delete("/rates/consumables/{rid}")
def del_consumable_rate(rid: int):
    with get_conn() as conn:
        with conn.cursor() as cur: cur.execute("DELETE FROM consumable_rates WHERE id=%s",(rid,))
        conn.commit()
    return {"status":"deleted"}


@app.get("/purchase_orders")
def get_pos(contractor: Optional[str] = Query(None)):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                if contractor:
                    cur.execute("""
                        SELECT id, po_number, contractor, description,
                               issue_date, expiry_date, po_value, status, notes
                        FROM purchase_orders
                        WHERE contractor=%s
                        ORDER BY issue_date DESC
                    """, (contractor,))
                else:
                    cur.execute("""
                        SELECT id, po_number, contractor, description,
                               issue_date, expiry_date, po_value, status, notes
                        FROM purchase_orders
                        ORDER BY issue_date DESC
                    """)
                pos = [dict(r) for r in cur.fetchall()]

                # Add spent from invoices matched to this PO
                for po in pos:
                    cur.execute("""
                        SELECT COALESCE(SUM(total_aud),0) AS spent
                        FROM invoices
                        WHERE po_reference LIKE %s
                    """, (f"%{po['po_number']}%",))
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



@app.patch("/invoices/{invoice_id}")
async def update_invoice(invoice_id: int, request: Request):
    payload = await request.json()
    safe = {"billing_month","status","notes","amount_paid","amount_due","po_reference"}
    u = {k:v for k,v in payload.items() if k in safe}
    if not u: raise HTTPException(400, "No valid fields")
    with get_conn() as conn:
        with conn.cursor() as cur:
            set_clause = ", ".join(f"{k}=%s" for k in u)
            vals = list(u.values()) + [invoice_id]
            cur.execute(f"UPDATE invoices SET {set_clause} WHERE id=%s", vals)
        conn.commit()
    return {"status": "updated"}


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


@app.post("/reconciliation/ai-audit")
async def ai_audit_reconciliation(request: Request):
    """Use Gemini AI to intelligently audit invoices against EOS field data."""
    payload = await request.json()
    contractor = payload.get("contractor", "Allianz Drilling")
    month = payload.get("month", "")

    if not GEMINI_API_KEY:
        raise HTTPException(500, "GEMINI_API_KEY not configured on server. Add it in Render environment variables.")

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Get invoices
            if month:
                cur.execute("""SELECT invoice_number, invoice_date, billing_month, total_aud,
                       amount_paid, amount_due, status, po_reference
                    FROM invoices WHERE contractor=%s
                    AND (billing_month=%s OR invoice_date LIKE %s)
                    ORDER BY invoice_date""", (contractor, month, f"%{month}%"))
            else:
                cur.execute("""SELECT invoice_number, invoice_date, billing_month, total_aud,
                       amount_paid, amount_due, status, po_reference
                    FROM invoices WHERE contractor=%s ORDER BY invoice_date""", (contractor,))
            invoices = [dict(r) for r in cur.fetchall()]

            inv_lines = []
            for inv in invoices:
                cur.execute("""SELECT il.* FROM invoice_lines il
                    JOIN invoices i ON i.id=il.invoice_id
                    WHERE i.invoice_number=%s AND i.contractor=%s""",
                    (inv["invoice_number"], contractor))
                inv_lines.extend([dict(r) for r in cur.fetchall()])

            # EOS summary
            cur.execute("""SELECT date, hole_num, site_name, code, notes, total_time,
                       total_metres, bit_type, unit_rate, quantity, line_cost, rate_basis
                FROM activities WHERE contractor=%s AND line_cost IS NOT NULL
                ORDER BY date""", (contractor,))
            activities = [dict(r) for r in cur.fetchall()]

            cur.execute("SELECT code, description, rate, unit FROM hourly_rates WHERE contractor=%s", (contractor,))
            rates = [dict(r) for r in cur.fetchall()]

            cur.execute("""SELECT consumable, SUM(COALESCE(NULLIF(quantity,'')::FLOAT,1)) AS total_qty,
                       MAX(unit_price) AS unit_price, SUM(line_cost) AS total_cost
                FROM consumables WHERE contractor=%s AND line_cost > 0
                GROUP BY consumable""", (contractor,))
            consumables = [dict(r) for r in cur.fetchall()]

    inv_total = sum(float(i.get("total_aud") or 0) for i in invoices)
    eos_total = sum(float(a.get("line_cost") or 0) for a in activities)
    cons_total = sum(float(c.get("total_cost") or 0) for c in consumables)

    eos_by_code = {}
    for a in activities:
        code = a.get("code") or "unknown"
        eos_by_code[code] = eos_by_code.get(code, 0) + float(a.get("line_cost") or 0)

    eos_by_date = {}
    for a in activities:
        d = a.get("date") or "unknown"
        eos_by_date[d] = eos_by_date.get(d, 0) + float(a.get("line_cost") or 0)

    prompt = f"""You are a mining industry financial auditor specialising in drilling contractor invoices for Australian coal exploration. Analyse this data and identify discrepancies, overcharges, and anomalies.

CONTRACTOR: {contractor}
PERIOD: {month or 'All dates'}

INVOICES ({len(invoices)} invoices, total ${inv_total:,.2f}):
{json.dumps(invoices, indent=2, default=str)[:3000]}

INVOICE LINE ITEMS ({len(inv_lines)} lines):
{json.dumps(inv_lines[:50], indent=2, default=str)[:3000]}

EOS FIELD DATA SUMMARY:
Total EOS calculated cost: ${eos_total:,.2f}
Total consumables cost: ${cons_total:,.2f}
Grand variance (Invoice - EOS - Consumables): ${inv_total - eos_total - cons_total:,.2f}

Cost by activity code:
{json.dumps(eos_by_code, indent=2, default=str)[:2000]}

Daily totals (EOS):
{json.dumps(dict(list(eos_by_date.items())[:30]), indent=2, default=str)[:1500]}

SCHEDULE OF RATES:
{json.dumps(rates[:30], indent=2, default=str)[:1500]}

CONSUMABLES:
{json.dumps(consumables, indent=2, default=str)[:1000]}

Provide your audit as JSON with this exact structure:
{{
  "summary": "2-3 sentence executive summary",
  "grand_variance": {{"invoiced": 0, "eos_calculated": 0, "consumables": 0, "difference": 0, "percentage": 0}},
  "findings": [
    {{
      "severity": "critical or warning or info",
      "category": "overcharge or undercharge or rate_mismatch or missing_data or duplicate or suspicious",
      "title": "short title",
      "detail": "detailed explanation",
      "amount": 0,
      "recommendation": "action to take"
    }}
  ],
  "rate_check": [
    {{
      "code": "H_Active",
      "schedule_rate": 745,
      "invoiced_rate": 0,
      "status": "match or mismatch or not_found",
      "note": "explanation"
    }}
  ],
  "recommendations": ["list of action items"]
}}

Return ONLY valid JSON. No markdown fences. No text outside the JSON object."""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"
    gemini_payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 8192}
    }

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(url, json=gemini_payload)
    except Exception as e:
        raise HTTPException(502, f"Gemini request failed: {str(e)}")

    if resp.status_code != 200:
        raise HTTPException(502, f"Gemini API error: {resp.status_code} - {resp.text[:200]}")

    result = resp.json()
    try:
        text = result["candidates"][0]["content"]["parts"][0]["text"]
        text = text.strip()
        if text.startswith("```"): text = text.split("\n", 1)[1]
        if text.endswith("```"): text = text[:-3]
        text = text.strip()
        if text.lower().startswith("json"): text = text[4:].strip()
        audit = json.loads(text)
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raw = result.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        return {"status": "partial", "raw_response": raw[:3000], "error": str(e)}

    return {"status": "ok", "audit": audit}


@app.post("/reprice")
def reprice_activities(contractor: str = Query(...)):
    """Fast rationalisation: fix dates, holes, sites, locations, then batch reprice."""

    SITE_TO_HOLE = {
        "CD-26-001":"CD1817C","CD-26-002":"CD1818C","CD-26-004":"CD1819C",
        "CD-26-005":"CD1820C","CD-26-006":"CD1821C","CD-26-007":"CD1822C",
        "CD-26-008":"CD1823C","CD-26-009":"CD1824C","CD-26-010":"CD1825C",
        "CD-26-011":"CD1826C","CD-26-012":"CD1827C","CD-26-013":"CD1828C",
        "CD-26-014":"CD1829C","CD-26-016":"CD1830C","CD-26-017":"CD1831C",
        "CD-26-018":"CD1832C","CD-26-019":"CD1833C","CD-26-020":"CD1834C",
        "CD-26-021":"CD1833C","CD-26-022":"CD1834C","CD-26-023":"CD1835C",
    }
    REVERSE_HOLE = {}
    for k, v in SITE_TO_HOLE.items():
        REVERSE_HOLE[v] = k

    months_map = {"january":"01","february":"02","march":"03","april":"04",
                  "may":"05","june":"06","july":"07","august":"08",
                  "september":"09","october":"10","november":"11","december":"12"}

    def normalise_date(d):
        if not d: return d
        d = d.strip()
        if re.match(r"^\d{2}/\d{2}/\d{4}$", d): return d
        m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", d)
        if m: return f"{int(m.group(1)):02d}/{int(m.group(2)):02d}/{m.group(3)}"
        m = re.match(r"^(\d{1,2})-(\w+)-(\d{4})$", d)
        if m:
            mon = months_map.get(m.group(2).lower(), "01")
            return f"{int(m.group(1)):02d}/{mon}/{m.group(3)}"
        return d

    stats = {"total":0,"dates_fixed":0,"holes_fixed":0,"sites_fixed":0,"priced":0}
    skipped_codes = {}

    with get_conn() as conn:
        with conn.cursor() as cur:
            # ── Load ALL data in 4 queries total ──────────────────────
            cur.execute("SELECT * FROM activities WHERE contractor=%s", (contractor,))
            rows = [dict(r) for r in cur.fetchall()]
            stats["total"] = len(rows)

            cur.execute("SELECT * FROM drilling_rates WHERE contractor=%s", (contractor,))
            all_dr = [dict(r) for r in cur.fetchall()]

            cur.execute("SELECT * FROM hourly_rates WHERE contractor=%s", (contractor,))
            all_hr = [dict(r) for r in cur.fetchall()]

            dr_years = sorted(set(r["year"] for r in all_dr))
            hr_years = sorted(set(r["year"] for r in all_hr))

        # ── Build rate lookup dicts in memory ─────────────────────────
        # hourly: {(year, code): rate}
        hr_lookup = {}
        for r in all_hr:
            hr_lookup[(r["year"], r["code"])] = float(r["rate"])

        # drilling: {(year, bit_type, depth): rate}  — depth is the matching band
        dr_lookup = {}
        for r in all_dr:
            key = (r["year"], r["bit_type"])
            if key not in dr_lookup: dr_lookup[key] = []
            dr_lookup[key].append((float(r["depth_from"]), float(r["depth_to"]), float(r["rate"])))

        def get_hr_mem(code, year):
            for try_year in [year, str(int(year)-1) if year.isdigit() else year, str(int(year)+1) if year.isdigit() else year, "2025"]:
                r = hr_lookup.get((try_year, code))
                if r is not None: return r
            return None

        def get_dr_mem(bit_key, depth, year):
            for try_year in [year, str(int(year)-1) if year.isdigit() else year, str(int(year)+1) if year.isdigit() else year, "2025"]:
                bands = dr_lookup.get((try_year, bit_key), [])
                for frm, to, rate in bands:
                    if frm <= depth < to:
                        return rate
            return None

        def extract_year(date_str):
            if not date_str: return "2026"
            parts = date_str.replace("-","/").split("/")
            for p in parts:
                if len(p) == 4 and p.isdigit(): return p
            return "2026"

        def parse_hours(t):
            if not t: return 0
            t = str(t).strip()
            m = re.match(r"(\d+):(\d+)", t)
            if m: return int(m.group(1)) + int(m.group(2))/60.0
            try: return float(t)
            except: return 0

        # ── Process all rows in memory ────────────────────────────────
        batch_updates = []
        for row in rows:
            updates = {}
            rid = row["id"]

            # 1. Date
            old_date = row.get("date","") or ""
            new_date = normalise_date(old_date)
            if new_date != old_date:
                updates["date"] = new_date
                row["date"] = new_date
                stats["dates_fixed"] += 1

            # 2. Hole ID from site
            hole = row.get("hole_num","") or ""
            site = row.get("site_name","") or ""
            if (not hole or hole == "0") and site in SITE_TO_HOLE:
                updates["hole_num"] = SITE_TO_HOLE[site]; row["hole_num"] = SITE_TO_HOLE[site]; stats["holes_fixed"] += 1
            elif hole in SITE_TO_HOLE:
                updates["hole_num"] = SITE_TO_HOLE[hole]; row["hole_num"] = SITE_TO_HOLE[hole]; stats["holes_fixed"] += 1
            elif site in SITE_TO_HOLE and hole != SITE_TO_HOLE[site]:
                updates["hole_num"] = SITE_TO_HOLE[site]; row["hole_num"] = SITE_TO_HOLE[site]; stats["holes_fixed"] += 1

            # 3. Site from hole
            if not site and row.get("hole_num","") in REVERSE_HOLE:
                updates["site_name"] = REVERSE_HOLE[row["hole_num"]]; stats["sites_fixed"] += 1

            # 4. Location
            loc = (row.get("location","") or "").lower()
            if loc in ("cdm sth","cdm south","cdm","carborough downs mine"):
                updates["location"] = "Carborough Downs"

            # 5. Reprice (in memory — no DB queries)
            year = extract_year(row.get("date",""))
            code = row.get("code","") or ""
            hours = parse_hours(row.get("total_time",""))
            bit_type = row.get("bit_type","") or ""
            depth = None
            mf = row.get("metres_from")
            mt = row.get("metres_to")
            if mf is not None and mt is not None:
                try: depth = (float(mf) + float(mt)) / 2
                except: pass
            metres = 0
            try: metres = float(row.get("total_metres",0) or 0)
            except: pass

            line_cost = None; unit_rate = None; quantity = None; rate_basis = None

            # Drilling metres
            if metres > 0 and bit_type:
                bk = bit_type.replace(" ","_").upper()
                bit_map = {"HQ_HQ3":"HQ_HQ3","HQ":"HQ_HQ3","NQ":"HQ_HQ3","PCD":"PCD_S","PQ":"HQ_HQ3"}
                bk = bit_map.get(bk, "PCD_S" if "Chip" in code or "PCD" in bk else "HQ_HQ3")
                if depth is not None:
                    r = get_dr_mem(bk, depth, year)
                    if r:
                        unit_rate = r; quantity = round(metres,2)
                        line_cost = round(r * metres, 2); rate_basis = f"${r:.2f}/m x {metres:.2f}m"

            # Day rates
            if line_cost is None:
                for dk, (dk_code, dk_unit) in DAY_RATE_CODES.items():
                    if dk in code or code in dk:
                        r = get_hr_mem(dk_code, year)
                        if r:
                            unit_rate = r; quantity = 1; line_cost = r; rate_basis = f"${r:,.2f}/{dk_unit}"
                        break

            # Not chargeable
            if line_cost is None and code in NOT_CHARGEABLE:
                unit_rate = 0; quantity = round(hours,2) if hours > 0 else 1
                line_cost = 0; rate_basis = "not chargeable"

            # Standby / inactive
            if line_cost is None and (code in STANDBY_CODES or "Standby" in code or code in INACTIVE_CODES):
                r = get_hr_mem(code, year) or get_hr_mem("H_Inactive", year)
                if r:
                    qty = round(hours,2) if hours > 0 else 1
                    unit_rate = r; quantity = qty; line_cost = round(r * qty, 2)
                    rate_basis = f"inactive ${r:,.2f}/hr x {qty}"

            # Active codes
            if line_cost is None and hours > 0 and (code in ACTIVE_CODES or code.startswith("H_")):
                r = get_hr_mem(code, year) or get_hr_mem("H_Active", year)
                if r:
                    unit_rate = r; quantity = round(hours,2)
                    line_cost = round(r * hours, 2); rate_basis = f"active ${r:,.2f}/hr x {hours:.2f}h"

            # Fallback: hours but no match
            if line_cost is None and hours > 0 and code:
                r = get_hr_mem("H_Active", year)
                if r:
                    unit_rate = r; quantity = round(hours,2)
                    line_cost = round(r * hours, 2); rate_basis = f"fallback ${r:,.2f}/hr x {hours:.2f}h"

            if line_cost is not None:
                updates["rate_year"] = year
                updates["unit_rate"] = unit_rate
                updates["quantity"] = quantity
                updates["line_cost"] = line_cost
                updates["rate_basis"] = rate_basis
                stats["priced"] += 1
            else:
                skipped_codes[code or "empty"] = skipped_codes.get(code or "empty", 0) + 1

            if updates:
                batch_updates.append((updates, rid))

        # ── Batch update activities in one transaction ────────────────
        with conn.cursor() as cur:
            for updates, rid in batch_updates:
                set_clause = ", ".join(f"{k}=%s" for k in updates)
                vals = list(updates.values()) + [rid]
                cur.execute(f"UPDATE activities SET {set_clause} WHERE id=%s", vals)

            # ── Reprice consumables ───────────────────────────────────────
            try:
                cur.execute("SELECT * FROM consumables WHERE contractor=%s", (contractor,))
                cons_rows = [dict(r) for r in cur.fetchall()]

                cur.execute("SELECT * FROM consumable_rates WHERE contractor=%s", (contractor,))
                all_cr = [dict(r) for r in cur.fetchall()]

                # Build consumable rate lookup: {normalised_product: unit_price}
                cr_lookup = {}
                for r in all_cr:
                    key = r["product"].strip().upper()
                    cr_lookup[key] = float(r["unit_price"] or 0)
                    cr_lookup[key.replace(" ", "")] = float(r["unit_price"] or 0)

                cons_priced = 0
                for crow in cons_rows:
                    product = (crow.get("consumable") or crow.get("type") or "").strip()
                    product_upper = product.upper()
                    product_nospace = product_upper.replace(" ", "")

                    price = cr_lookup.get(product_upper)
                    if price is None:
                        price = cr_lookup.get(product_nospace)
                    if price is None:
                        for rk, rv in cr_lookup.items():
                            if rk in product_upper or product_upper in rk:
                                price = rv
                                break

                    if price is not None and price > 0:
                        qty = 1
                        try:
                            qty = float(crow.get("quantity") or 1)
                        except (ValueError, TypeError):
                            qty = 1
                        lc = round(price * qty, 2)
                        cur.execute("UPDATE consumables SET unit_price=%s, line_cost=%s WHERE id=%s",
                                    (price, lc, crow["id"]))
                        cons_priced += 1

                stats["consumables_priced"] = cons_priced
                stats["consumables_total"] = len(cons_rows)
            except Exception as e:
                stats["consumables_error"] = str(e)
                stats["consumables_priced"] = 0
                stats["consumables_total"] = 0

        conn.commit()

    return {
        "status": "rationalised",
        "total": stats["total"],
        "dates_fixed": stats["dates_fixed"],
        "holes_fixed": stats["holes_fixed"],
        "sites_fixed": stats["sites_fixed"],
        "priced": stats["priced"],
        "consumables_priced": stats.get("consumables_priced", 0),
        "consumables_total": stats.get("consumables_total", 0),
        "drilling_rate_years": dr_years,
        "hourly_rate_years": hr_years,
        "skipped_codes": skipped_codes,
    }



# ── Borehole Planning ─────────────────────────────────────────────────────────

@app.get("/boreholes")
def get_boreholes(contractor: Optional[str] = Query(None)):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                if contractor:
                    cur.execute("""
                        SELECT b.*,
                            COALESCE(SUM(a.line_cost),0) AS eos_cost,
                            SUM(a.total_metres) AS eos_metres
                        FROM boreholes b
                        LEFT JOIN activities a ON a.hole_num=b.hole_id
                        WHERE b.contractor=%s
                        GROUP BY b.id ORDER BY b.drill_order
                    """, (contractor,))
                else:
                    cur.execute("""
                        SELECT b.*,
                            COALESCE(SUM(a.line_cost),0) AS eos_cost,
                            SUM(a.total_metres) AS eos_metres
                        FROM boreholes b
                        LEFT JOIN activities a ON a.hole_num=b.hole_id
                        GROUP BY b.id ORDER BY b.drill_order
                    """)
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
def delete_borehole(hole_id: str, contractor: Optional[str] = Query(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            if contractor:
                cur.execute("DELETE FROM boreholes WHERE hole_id=%s AND contractor=%s", (hole_id, contractor))
            else:
                cur.execute("DELETE FROM boreholes WHERE hole_id=%s", (hole_id,))
        conn.commit()
    return {"status": "deleted"}


@app.get("/boreholes/summary")
def get_borehole_summary(contractor: Optional[str] = Query(None)):
    """Budget vs actual summary for reconciliation."""
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                where = "WHERE contractor=%s" if contractor else ""
                params = (contractor,) if contractor else ()
                cur.execute(f"""
                    SELECT
                        COUNT(*) AS total_holes,
                        SUM(days_budgeted) AS total_days_budgeted,
                        SUM(budget_total) AS total_budget,
                        COUNT(CASE WHEN status='Complete' THEN 1 END) AS completed,
                        COUNT(CASE WHEN status='In Progress' THEN 1 END) AS in_progress,
                        COUNT(CASE WHEN status='Planned' THEN 1 END) AS planned
                    FROM boreholes {where}
                """, params)
                summary = dict(cur.fetchone())
                cur.execute(f"""
                    SELECT COALESCE(SUM(a.line_cost),0) AS actual_total
                    FROM activities a
                    JOIN boreholes b ON b.hole_id=a.hole_num
                    {("WHERE a.contractor=%s" if contractor else "")}
                """, params)
                summary["actual_total"] = float(cur.fetchone()["actual_total"] or 0)
                return summary
    except Exception as e:
        raise HTTPException(500, f"Summary error: {str(e)}")


# ── Projects ──────────────────────────────────────────────────────────────────

@app.get("/projects")
def get_projects(contractor: str = Query(...)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM projects WHERE contractor=%s ORDER BY name", (contractor,))
            return [dict(r) for r in cur.fetchall()]


@app.post("/projects")
async def add_project(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON")
    name = payload.get("name", "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    contractor = payload.get("contractor", "Allianz Drilling")
    year = payload.get("year", "")
    notes = payload.get("notes", "")
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO projects (contractor, name, year, notes)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (contractor, name) DO UPDATE SET year=EXCLUDED.year, notes=EXCLUDED.notes
                    RETURNING id
                """, (contractor, name, year, notes))
                pid = cur.fetchone()["id"]
            conn.commit()
        return {"status": "created", "id": pid, "name": name}
    except Exception as e:
        raise HTTPException(500, f"Failed: {str(e)}")


@app.delete("/projects/{project_id}")
def delete_project(project_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM projects WHERE id=%s", (project_id,))
        conn.commit()
    return {"status": "deleted"}


# ── Gemini Vision OCR for handwritten drill logs ──────────────────────────────

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

GEMINI_PROMPT = """You are reading a scanned handwritten drilling End-of-Shift report (DEPCO Drill Log format).

Extract ALL data from this image into a JSON object with these exact fields:

{
  "log_number": "the No. at top right e.g. 099839",
  "client": "client name from Client field",
  "location": "Location/Area field",
  "hole_num": "Hole # field e.g. CR57",
  "date": "Date field in d/m/yyyy format",
  "day": "Day of week",
  "shift": "Day or Night",
  "start_time": "Start Time e.g. 0600",
  "finish_time": "Finish Time e.g. 1730",
  "travel_hours": "Travel Hours if filled",
  "driller": "Driller name",
  "offsider1": "Offsider 1 name",
  "offsider2": "Offsider 2 name",
  "rig_no": "Rig No.",
  "drill_rig": "Rod Trailer No. next to Rig No.",
  "activities": [
    {
      "comments": "handwritten description of the activity",
      "time_from": "HH:MM format e.g. 05:30",
      "time_to": "HH:MM format e.g. 06:00",
      "total_time": "duration in H:MM or fraction e.g. 0:30 or 0.5",
      "metres_from": null or number,
      "metres_to": null or number,
      "total_metres": null or number
    }
  ]
}

IMPORTANT RULES:
- Read the DRILLING section table carefully - each row has: COMMENTS, TIME FROM, TIME TO, TOTAL TIME, METERS FROM, METERS TO, TOTAL METERS
- Times are in 24hr format (e.g. 0530 means 05:30, 1415 means 14:15)
- Total Time is usually in fractions like 2, 1/2, 3/4 etc. Convert: 1/2=0:30, 1/4=0:15, 3/4=0:45
- The handwriting may be difficult - do your best to read it
- If a field is empty or unreadable, use null
- Return ONLY valid JSON, no markdown, no explanation
"""


async def ocr_with_gemini(pdf_bytes: bytes) -> dict:
    """Send a PDF page image to Gemini Vision and extract structured data."""
    if not GEMINI_API_KEY:
        raise HTTPException(500, "GEMINI_API_KEY not configured on server")

    # Convert PDF to image using pdfplumber
    from PIL import Image
    import io

    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        if not pdf.pages:
            raise HTTPException(400, "PDF has no pages")
        page = pdf.pages[0]
        # Render page to image
        img = page.to_image(resolution=300)
        img_buffer = io.BytesIO()
        img.original.save(img_buffer, format='PNG')
        img_bytes = img_buffer.getvalue()

    b64_image = base64.b64encode(img_bytes).decode('utf-8')

    # Call Gemini API
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"

    payload = {
        "contents": [{
            "parts": [
                {"text": GEMINI_PROMPT},
                {
                    "inline_data": {
                        "mime_type": "image/png",
                        "data": b64_image
                    }
                }
            ]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 4096
        }
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=payload)

    if resp.status_code != 200:
        raise HTTPException(502, f"Gemini API error: {resp.status_code} - {resp.text[:200]}")

    result = resp.json()
    try:
        text = result["candidates"][0]["content"]["parts"][0]["text"]
        # Clean up - remove markdown fences if present
        text = text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
        if text.startswith("json"):
            text = text[4:].strip()
        return json.loads(text)
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise HTTPException(422, f"Could not parse Gemini response: {str(e)}")


@app.post("/import/ocr")
async def import_ocr_pdf(
    file: UploadFile = File(...),
    contractor: str = Form(default="DEPCO Drilling"),
):
    """Import a handwritten drill log PDF using Gemini Vision OCR."""
    filename = file.filename
    content = await file.read()

    # Check if already imported
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM imported_files WHERE filename=%s AND contractor=%s",
                        (filename, contractor))
            if cur.fetchone():
                return {"status": "skipped", "filename": filename}

    # OCR with Gemini
    try:
        data = await ocr_with_gemini(content)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(422, f"OCR failed: {str(e)}")

    # Convert to activity rows
    activities = data.get("activities", [])
    hole_num = data.get("hole_num", "")
    date_str = data.get("date", "")
    location = data.get("location", "")
    driller = data.get("driller", "")
    shift = data.get("shift", "Day")
    site_name = location

    rows = []
    for act in activities:
        time_from = act.get("time_from", "")
        time_to = act.get("time_to", "")
        total_time = act.get("total_time", "")

        # Normalise total_time to H:MM
        if total_time and isinstance(total_time, (int, float)):
            h = int(total_time)
            m = int((total_time - h) * 60)
            total_time = f"{h}:{m:02d}"

        metres_from = act.get("metres_from")
        metres_to = act.get("metres_to")
        total_metres = act.get("total_metres")
        comments = act.get("comments", "")

        rows.append({
            "source_file": filename, "contractor": contractor,
            "date": date_str, "hole_num": hole_num,
            "site_name": site_name, "location": location,
            "drill_rig": data.get("rig_no", ""), "client": data.get("client", ""),
            "contract": "", "shift": shift,
            "time_from": time_from, "time_to": time_to,
            "total_time": total_time,
            "bit_type": "", "diameter": "",
            "metres_from": float(metres_from) if metres_from else None,
            "metres_to": float(metres_to) if metres_to else None,
            "total_metres": float(total_metres) if total_metres else None,
            "code": "", "notes": comments,
            "rate_year": None, "unit_rate": None, "quantity": None,
            "line_cost": None, "rate_basis": None, "po_id": None,
        })

    # Save to database
    with get_conn() as conn:
        with conn.cursor() as cur:
            if rows:
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
                """, rows)
            cur.execute("INSERT INTO imported_files (filename,contractor) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                        (filename, contractor))
            cur.execute("""
                INSERT INTO source_files (filename, contractor, file_type, pdf_data)
                VALUES (%s, %s, 'ocr', %s) ON CONFLICT (filename, contractor) DO NOTHING
            """, (filename, contractor, psycopg2.Binary(content)))
        conn.commit()

    return {
        "status": "imported",
        "filename": filename,
        "ocr_data": data,
        "rows": len(rows),
        "hole_num": hole_num,
        "date": date_str,
        "contractor": contractor,
    }


@app.post("/import/ocr/preview")
async def preview_ocr_pdf(
    file: UploadFile = File(...),
):
    """Preview OCR results without saving — for testing."""
    content = await file.read()
    data = await ocr_with_gemini(content)
    return {"ocr_data": data, "activity_count": len(data.get("activities", []))}


@app.get("/source_files/{filename}")
def get_source_file(filename: str, contractor: Optional[str] = Query(None)):
    """Return a stored source PDF for viewing."""
    from fastapi.responses import Response
    with get_conn() as conn:
        with conn.cursor() as cur:
            if contractor:
                cur.execute("SELECT pdf_data FROM source_files WHERE filename=%s AND contractor=%s", (filename, contractor))
            else:
                cur.execute("SELECT pdf_data FROM source_files WHERE filename=%s LIMIT 1", (filename,))
            row = cur.fetchone()
            if not row or not row["pdf_data"]:
                raise HTTPException(404, "Source file not found")
            return Response(
                content=bytes(row["pdf_data"]),
                media_type="application/pdf",
                headers={"Content-Disposition": f'inline; filename="{filename}"'}
            )


# ── DXF Overlay for Borehole Map ──────────────────────────────────────────────

@app.post("/dxf/upload")
async def upload_dxf(
    file: UploadFile = File(...),
    epsg: str = Form(default="20355"),
):
    """Parse a DXF file and return GeoJSON for Leaflet overlay.
    Converts from the specified EPSG (default MGA Zone 55) to WGS84."""
    import ezdxf
    from pyproj import Transformer

    content = await file.read()

    try:
        doc = ezdxf.read(BytesIO(content))
    except Exception as e:
        raise HTTPException(400, f"Cannot read DXF: {str(e)}")

    transformer = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)

    def to_wgs84(x, y):
        try:
            lng, lat = transformer.transform(float(x), float(y))
            if -90 <= lat <= 90 and -180 <= lng <= 180:
                return [lng, lat]
        except:
            pass
        return None

    features = []
    msp = doc.modelspace()

    for entity in msp:
        etype = entity.dxftype()
        layer = entity.dxf.layer if hasattr(entity.dxf, 'layer') else ''
        color = entity.dxf.color if hasattr(entity.dxf, 'color') else 7

        try:
            if etype == 'LINE':
                start = to_wgs84(entity.dxf.start.x, entity.dxf.start.y)
                end = to_wgs84(entity.dxf.end.x, entity.dxf.end.y)
                if start and end:
                    features.append({
                        "type": "Feature",
                        "properties": {"layer": layer, "type": "line", "color": color},
                        "geometry": {"type": "LineString", "coordinates": [start, end]}
                    })

            elif etype == 'LWPOLYLINE':
                coords = []
                for pt in entity.get_points(format='xy'):
                    c = to_wgs84(pt[0], pt[1])
                    if c: coords.append(c)
                if len(coords) >= 2:
                    if entity.closed:
                        coords.append(coords[0])
                        features.append({
                            "type": "Feature",
                            "properties": {"layer": layer, "type": "polygon", "color": color},
                            "geometry": {"type": "Polygon", "coordinates": [coords]}
                        })
                    else:
                        features.append({
                            "type": "Feature",
                            "properties": {"layer": layer, "type": "polyline", "color": color},
                            "geometry": {"type": "LineString", "coordinates": coords}
                        })

            elif etype == 'POLYLINE':
                coords = []
                for v in entity.vertices:
                    c = to_wgs84(v.dxf.location.x, v.dxf.location.y)
                    if c: coords.append(c)
                if len(coords) >= 2:
                    features.append({
                        "type": "Feature",
                        "properties": {"layer": layer, "type": "polyline", "color": color},
                        "geometry": {"type": "LineString", "coordinates": coords}
                    })

            elif etype == 'CIRCLE':
                centre = to_wgs84(entity.dxf.center.x, entity.dxf.center.y)
                if centre:
                    features.append({
                        "type": "Feature",
                        "properties": {"layer": layer, "type": "circle",
                                      "radius": entity.dxf.radius, "color": color},
                        "geometry": {"type": "Point", "coordinates": centre}
                    })

            elif etype == 'POINT':
                pt = to_wgs84(entity.dxf.location.x, entity.dxf.location.y)
                if pt:
                    features.append({
                        "type": "Feature",
                        "properties": {"layer": layer, "type": "point", "color": color},
                        "geometry": {"type": "Point", "coordinates": pt}
                    })

            elif etype in ('TEXT', 'MTEXT'):
                pt = to_wgs84(entity.dxf.insert.x, entity.dxf.insert.y)
                text = entity.dxf.text if etype == 'TEXT' else entity.text
                if pt and text:
                    features.append({
                        "type": "Feature",
                        "properties": {"layer": layer, "type": "text",
                                      "text": text, "color": color},
                        "geometry": {"type": "Point", "coordinates": pt}
                    })

            elif etype == 'ARC':
                centre = to_wgs84(entity.dxf.center.x, entity.dxf.center.y)
                if centre:
                    features.append({
                        "type": "Feature",
                        "properties": {"layer": layer, "type": "arc",
                                      "radius": entity.dxf.radius, "color": color},
                        "geometry": {"type": "Point", "coordinates": centre}
                    })

        except Exception:
            continue

    # Extract unique layers
    layers = sorted(set(f["properties"]["layer"] for f in features))

    geojson = {"type": "FeatureCollection", "features": features}

    return {
        "status": "ok",
        "filename": file.filename,
        "entity_count": len(features),
        "layers": layers,
        "epsg": epsg,
        "geojson": geojson,
    }


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
