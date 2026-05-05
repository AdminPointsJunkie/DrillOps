"""
Allianz Drilling — FastAPI Backend
Handles PDF import, SQLite persistence, and REST API for the frontend.
"""

import re
import os
import sqlite3
from io import BytesIO
from typing import Optional

import pdfplumber
import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(title="Allianz Drilling API", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten to your GitHub Pages URL in production
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = os.environ.get("DB_PATH", "drilling_reports.db")

# ── Database ──────────────────────────────────────────────────────────────────

def get_conn():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS activities (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                source_file  TEXT,
                date         TEXT,
                hole_num     TEXT,
                site_name    TEXT,
                location     TEXT,
                drill_rig    TEXT,
                client       TEXT,
                contract     TEXT,
                shift        TEXT,
                time_from    TEXT,
                time_to      TEXT,
                total_time   TEXT,
                bit_type     TEXT,
                diameter     TEXT,
                metres_from  REAL,
                metres_to    REAL,
                total_metres REAL,
                code         TEXT,
                notes        TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS consumables (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS crew (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                source_file TEXT,
                date        TEXT,
                hole_num    TEXT,
                site_name   TEXT,
                role        TEXT,
                name        TEXT,
                hours       TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS imported_files (
                filename TEXT PRIMARY KEY
            )
        """)
        conn.commit()


init_db()

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
        r"(?:\s+([\w_]+))?\s*$", re.IGNORECASE
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
                "source_file": filename, "date": header.get("date", ""),
                "hole_num": header.get("hole_num", ""), "site_name": header.get("site_name", ""),
                "location": header.get("location", ""), "drill_rig": header.get("drill_rig", ""),
                "client": header.get("client", ""), "contract": header.get("contract", ""),
                "shift": header.get("shift", ""), "time_from": tf, "time_to": tt,
                "total_time": total, "bit_type": bit_type or "", "diameter": diam or "",
                "metres_from": float(mf) if mf else None, "metres_to": float(mt) if mt else None,
                "total_metres": float(mto) if mto else None, "code": code or "",
                "notes": notes.strip(),
            })
    return rows


def parse_consumables(text, header, filename):
    rows = []
    m = re.search(r"CONSUMABLES\s*\n(.*?)(?:ALLIANZ REPRESENTATIVE|$)", text, re.DOTALL | re.IGNORECASE)
    if not m:
        return rows
    con_re = re.compile(
        r"^(.+?)\s+(drum|bucket|bags?|tins?|slurry|Kgs?|Ltrs?|Mtrs?|cube)\s+(\d+)\s+(\S+)\s*$",
        re.IGNORECASE | re.MULTILINE
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
    return {"status": "ok", "app": "Allianz Drilling API"}


@app.post("/import")
async def import_pdf(file: UploadFile = File(...)):
    filename = file.filename
    with get_conn() as conn:
        existing = conn.execute("SELECT 1 FROM imported_files WHERE filename=?", (filename,)).fetchone()
    if existing:
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

    with get_conn() as conn:
        if acts:
            conn.executemany("""
                INSERT INTO activities
                (source_file,date,hole_num,site_name,location,drill_rig,client,contract,shift,
                 time_from,time_to,total_time,bit_type,diameter,metres_from,metres_to,total_metres,code,notes)
                VALUES
                (:source_file,:date,:hole_num,:site_name,:location,:drill_rig,:client,:contract,:shift,
                 :time_from,:time_to,:total_time,:bit_type,:diameter,:metres_from,:metres_to,:total_metres,:code,:notes)
            """, acts)
        if cons:
            conn.executemany("""
                INSERT INTO consumables (source_file,date,hole_num,site_name,consumable,type,quantity,unit)
                VALUES (:source_file,:date,:hole_num,:site_name,:consumable,:type,:quantity,:unit)
            """, cons)
        if crew:
            conn.executemany("""
                INSERT INTO crew (source_file,date,hole_num,site_name,role,name,hours)
                VALUES (:source_file,:date,:hole_num,:site_name,:role,:name,:hours)
            """, crew)
        conn.execute("INSERT OR IGNORE INTO imported_files VALUES (?)", (filename,))
        conn.commit()

    return {"status": "imported", "filename": filename, "rows": len(acts)}


@app.get("/activities")
def get_activities(
    dates:  Optional[str] = Query(None),
    holes:  Optional[str] = Query(None),
    sites:  Optional[str] = Query(None),
    codes:  Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    query = "SELECT * FROM activities WHERE 1=1"
    params = []
    if dates:
        d_list = dates.split(",")
        query += f" AND date IN ({','.join('?'*len(d_list))})"
        params.extend(d_list)
    if holes:
        h_list = holes.split(",")
        query += f" AND hole_num IN ({','.join('?'*len(h_list))})"
        params.extend(h_list)
    if sites:
        s_list = sites.split(",")
        query += f" AND site_name IN ({','.join('?'*len(s_list))})"
        params.extend(s_list)
    if codes:
        c_list = codes.split(",")
        query += f" AND code IN ({','.join('?'*len(c_list))})"
        params.extend(c_list)
    if search:
        query += " AND (notes LIKE ? OR code LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])
    query += " ORDER BY date, time_from"
    with get_conn() as conn:
        rows = [dict(r) for r in conn.execute(query, params).fetchall()]
    return rows


@app.patch("/activities/{row_id}")
def update_activity(row_id: int, payload: dict):
    safe_cols = {
        "date","hole_num","site_name","location","drill_rig","client","contract","shift",
        "time_from","time_to","total_time","bit_type","diameter",
        "metres_from","metres_to","total_metres","code","notes"
    }
    updates = {k: v for k, v in payload.items() if k in safe_cols}
    if not updates:
        raise HTTPException(400, "No valid fields to update")
    set_clause = ", ".join(f"{k}=?" for k in updates)
    with get_conn() as conn:
        conn.execute(f"UPDATE activities SET {set_clause} WHERE id=?", [*updates.values(), row_id])
        conn.commit()
    return {"status": "updated"}


@app.get("/consumables")
def get_consumables(dates: Optional[str] = Query(None)):
    query = "SELECT * FROM consumables WHERE 1=1"
    params = []
    if dates:
        d_list = dates.split(",")
        query += f" AND date IN ({','.join('?'*len(d_list))})"
        params.extend(d_list)
    query += " ORDER BY date"
    with get_conn() as conn:
        rows = [dict(r) for r in conn.execute(query, params).fetchall()]
    return rows


@app.get("/crew")
def get_crew(dates: Optional[str] = Query(None)):
    query = "SELECT * FROM crew WHERE 1=1"
    params = []
    if dates:
        d_list = dates.split(",")
        query += f" AND date IN ({','.join('?'*len(d_list))})"
        params.extend(d_list)
    query += " ORDER BY date"
    with get_conn() as conn:
        rows = [dict(r) for r in conn.execute(query, params).fetchall()]
    return rows


@app.get("/filters")
def get_filters():
    with get_conn() as conn:
        dates = [r[0] for r in conn.execute("SELECT DISTINCT date FROM activities ORDER BY date").fetchall()]
        holes = [r[0] for r in conn.execute("SELECT DISTINCT hole_num FROM activities ORDER BY hole_num").fetchall()]
        sites = [r[0] for r in conn.execute("SELECT DISTINCT site_name FROM activities ORDER BY site_name").fetchall()]
        codes = [r[0] for r in conn.execute("SELECT DISTINCT code FROM activities WHERE code!='' ORDER BY code").fetchall()]
        total = conn.execute("SELECT COUNT(*) FROM activities").fetchone()[0]
    return {"dates": dates, "holes": holes, "sites": sites, "codes": codes, "total_rows": total}


@app.get("/analytics")
def get_analytics(hole: Optional[str] = Query(None)):
    query = "SELECT * FROM activities"
    params = []
    if hole and hole != "all":
        query += " WHERE hole_num=?"
        params.append(hole)
    with get_conn() as conn:
        df = pd.read_sql_query(query, conn, params=params)

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
    efficiency = round(drill_h / total_h * 100, 1) if total_h > 0 else 0

    # Daily category breakdown
    daily = df.groupby(["date", "category"])["hours"].sum().reset_index()
    daily_out = daily.to_dict(orient="records")

    # Drill runs
    runs = df[df["total_metres"].notna() & (df["total_metres"] > 0)].copy()
    runs = runs.sort_values(["date", "time_from"])
    runs["cumulative"] = runs.groupby("hole_num")["total_metres"].cumsum()
    drill_runs = runs[["date","hole_num","time_from","total_metres","cumulative","notes"]].to_dict(orient="records")

    # Anomalies
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

    # Heatmap data
    npt_cats = ["Repairs", "Standby / Delays", "Circulation"]
    npt = df[df["category"].isin(npt_cats)].groupby(["date", "category"])["hours"].sum().reset_index()
    heatmap = npt.to_dict(orient="records")

    return {
        "kpis": {
            "total_hours": round(total_h, 1),
            "drill_hours": round(drill_h, 1),
            "repair_hours": round(repair_h, 1),
            "delay_hours": round(delay_h, 1),
            "total_metres": round(total_m, 1),
            "efficiency": efficiency,
        },
        "daily_categories": daily_out,
        "drill_runs": drill_runs,
        "anomalies": anomalies,
        "heatmap": heatmap,
    }


@app.delete("/reset")
def reset_db():
    with get_conn() as conn:
        for tbl in ("activities", "consumables", "crew", "imported_files"):
            conn.execute(f"DELETE FROM {tbl}")
        conn.commit()
    return {"status": "cleared"}
