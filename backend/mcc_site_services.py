"""Parser for MCC Argo Site Services daily-report PDFs."""

import re
from datetime import datetime


REPORT_TITLE = "ARGO SITE SERVICES DAILY REPORT"


def is_mcc_site_services_report(text: str, filename: str = "") -> bool:
    haystack = f"{filename}\n{text}".upper()
    return REPORT_TITLE in haystack or "SITESERVICESREPORT" in haystack.replace(" ", "")


def _text(value) -> str:
    return str(value or "").strip()


def _report_date(text: str, filename: str) -> str:
    match = re.search(r"(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)", filename or "")
    if match:
        try:
            return datetime.strptime("".join(match.groups()), "%Y%m%d").strftime("%d/%m/%Y")
        except ValueError:
            pass

    match = re.search(r"\bDS\s+(\d{1,2})/(\d{1,2})/(20\d{2})\b", text or "", re.I)
    if not match:
        return ""
    first, second, year = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
    day, month = (second, first) if second > 12 and first <= 12 else (first, second)
    try:
        return datetime(year, month, day).strftime("%d/%m/%Y")
    except ValueError:
        return match.group(0).split(None, 1)[-1]


def extract_site_ids(value: str) -> list[str]:
    """Return distinct, normalised site IDs in source order."""
    text = _text(value).upper().replace("–", "-").replace("—", "-")
    found = []
    matches = []
    patterns = [
        (r"\bIB[-\s]?(\d{2})[-\s]?(\d{1,3})\b", "IB"),
        (r"\bGR[-\s]?(\d{1,2})\b", "GR"),
        (r"\b(?:SIS)?MG[-\s]?(\d{1,2})[-\s]?(\d{1,2}[A-Z]?)\b", "MG"),
    ]
    for pattern, kind in patterns:
        for match in re.finditer(pattern, text, re.I):
            if kind == "IB":
                site = f"IB-{match.group(1).zfill(2)}-{match.group(2).zfill(3)}"
            elif kind == "GR":
                site = f"GR{int(match.group(1))}"
            else:
                suffix = match.group(2)
                digits = re.match(r"\d+", suffix).group(0)
                letter = suffix[len(digits):]
                site = f"MG{int(match.group(1)):02d}-{int(digits):02d}{letter}"
            matches.append((match.start(), site))
    for _, site in sorted(matches):
        if site not in found:
            found.append(site)
    return found


def work_groups_for_sites(site_ids: list[str], description: str = "") -> list[str]:
    groups = []
    for site in site_ids:
        if site.startswith("IB-"):
            group = "Exploration"
        elif site.startswith("GR"):
            group = "Gas Riser"
        elif site.startswith("MG"):
            group = "SIS"
        else:
            continue
        if group not in groups:
            groups.append(group)
    if not groups:
        text = _text(description).lower()
        for needle, group in (("exploration", "Exploration"), ("gas riser", "Gas Riser"), ("sis", "SIS")):
            if needle in text and group not in groups:
                groups.append(group)
    order = {"Exploration": 0, "Gas Riser": 1, "SIS": 2}
    return sorted(groups, key=lambda item: order.get(item, 99))


def _decimal_hours_to_time(value) -> str:
    try:
        hours = float(value)
    except (TypeError, ValueError):
        return ""
    minutes = int(round(hours * 60))
    return f"{minutes // 60}:{minutes % 60:02d}"


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _report_notes(tables: list) -> list[str]:
    notes = []
    section_starts = {"safety", "manning", "equipment id", "tradesperson/labourer"}
    for table in tables or []:
        for row_index, raw in enumerate(table or []):
            row = list(raw or [])
            note_columns = [
                index for index, value in enumerate(row)
                if _text(value).lower().replace(" ", "") in {"notes/delays", "notes&delays"}
            ]
            for note_column in note_columns:
                for following in (table or [])[row_index + 1:]:
                    following = list(following or [])
                    first = _text(following[0] if following else "").lower()
                    if first in section_starts:
                        break
                    value = _text(following[note_column] if note_column < len(following) else "")
                    if value and value not in notes:
                        notes.append(value)
    return notes


def _base_activity(filename: str, contractor: str, report_date: str, work: str) -> dict:
    sites = extract_site_ids(work)
    groups = work_groups_for_sites(sites, work)
    site_value = ", ".join(sites)
    group_value = ", ".join(groups)
    return {
        "source_file": filename,
        "contractor": contractor,
        "date": report_date,
        "hole_num": sites[0] if sites else "",
        "site_name": site_value,
        "program": group_value,
        "project": "",
        "location": site_value,
        "drill_rig": "",
        "client": "Argo NR",
        "contract": "",
        "shift": "Day",
        "time_from": "",
        "time_to": "",
        "total_time": "",
        "bit_type": "",
        "diameter": "",
        "metres_from": None,
        "metres_to": None,
        "total_metres": None,
        "code": "",
        "notes": work,
        "rate_year": report_date[-4:] if len(report_date) >= 4 else "",
        "unit_rate": None,
        "quantity": None,
        "line_cost": None,
        "rate_basis": "MCC Site Services PDF - unpriced",
        "po_id": None,
    }


def parse_mcc_site_services(text: str, tables: list, filename: str, contractor: str = "MCC Group"):
    """Parse equipment, labour and crew rows from extracted pdfplumber tables."""
    report_date = _report_date(text, filename)
    activities, crew, seen_crew = [], [], set()
    report_notes = _report_notes(tables)

    def add_crew(role, name, hours="", site=""):
        name = _text(name)
        if not name:
            return
        key = (_text(role).lower(), name.lower(), _text(hours), _text(site))
        if key in seen_crew:
            return
        seen_crew.add(key)
        crew.append({
            "source_file": filename,
            "contractor": contractor,
            "date": report_date,
            "hole_num": site.split(",", 1)[0].strip() if site else "",
            "site_name": site,
            "role": _text(role),
            "name": name,
            "hours": _text(hours),
        })

    for table in tables or []:
        mode = ""
        labour_has_hours = False
        for raw in table or []:
            row = list(raw or []) + [None] * 8
            first = _text(row[0])
            if first.lower() == "manning":
                mode = "manning"
                continue
            if first.lower() == "equipment id":
                mode = "equipment"
                continue
            if first.lower() == "tradesperson/labourer":
                mode = "labour"
                labour_has_hours = _text(row[3]).lower() == "hrs"
                continue

            if mode == "manning":
                if first and first.lower() not in {"actual", "comments"}:
                    names = _text(row[3])
                    for name in re.split(r"\s*/\s*", names):
                        add_crew(first, name)
                continue

            if mode == "equipment":
                equipment_id = first
                description = _text(row[1])
                hours = _number(row[5])
                operator = _text(row[6])
                work = _text(row[7])
                if not equipment_id or description.upper() == "#N/A" or not work or not hours or hours <= 0:
                    continue
                activity = _base_activity(filename, contractor, report_date, work)
                activity.update({
                    "drill_rig": equipment_id,
                    "total_time": _decimal_hours_to_time(hours),
                    "quantity": hours,
                    "notes": " | ".join(filter(None, [
                        work,
                        f"Equipment: {equipment_id} - {description}",
                        f"Operator: {operator}" if operator else "",
                        f"SMU: {_text(row[3])} to {_text(row[4])}" if _text(row[3]) or _text(row[4]) else "",
                    ])),
                    "_mcc_activity_type": "equipment",
                    "_mcc_rate_text": f"{equipment_id} {description}",
                })
                activities.append(activity)
                if operator:
                    operator_activity = _base_activity(filename, contractor, report_date, work)
                    operator_activity.update({
                        "total_time": _decimal_hours_to_time(hours),
                        "quantity": hours,
                        "notes": " | ".join(filter(None, [
                            work,
                            f"Operator: {operator}",
                            f"Linked equipment: {equipment_id} - {description}",
                        ])),
                        "_mcc_activity_type": "labour",
                        "_mcc_rate_text": "Multi Skilled Operator",
                    })
                    activities.append(operator_activity)
                add_crew("Operator", operator, hours, activity["site_name"])
                continue

            if mode == "labour":
                name = first
                hours_cell = row[3] if labour_has_hours else ""
                work = _text(row[4] if labour_has_hours else row[3])
                if not name or not work:
                    continue
                hours = _number(hours_cell)
                activity = _base_activity(filename, contractor, report_date, work)
                activity.update({
                    "total_time": _decimal_hours_to_time(hours),
                    "quantity": hours,
                    "notes": f"{work} | Tradesperson/Labourer: {name}",
                    "_mcc_activity_type": "labour",
                    "_mcc_rate_text": "Labourer",
                })
                activities.append(activity)
                add_crew("Tradesperson/Labourer", name, hours_cell, activity["site_name"])

    if not activities:
        raise ValueError("No active MCC Site Services rows found in report")
    if report_notes:
        activities[0]["notes"] = " | ".join([
            activities[0]["notes"],
            *[f"Report note: {note}" for note in report_notes],
        ])
    header = {
        "date": report_date,
        "hole_num": activities[0]["hole_num"],
        "site_name": activities[0]["site_name"],
        "contractor": contractor,
    }
    return header, activities, [], crew, text
