"""Parser for Weatherford / Precision Energy GDB logging daily PDFs."""

import re
from datetime import datetime, timedelta


WEATHERFORD_QUOTE_REFERENCE = "202510022"
WEATHERFORD_CALLOUT_DAY = 2650.0
WEATHERFORD_ADDITIONAL_HOUR = 200.0
WEATHERFORD_EXCESS_KM = 2.45
WEATHERFORD_MEALS_DAY = 125.0
WEATHERFORD_TELEVIEWER_DAY = 150.0
WEATHERFORD_PROCESSING_HOLE = 250.0
WEATHERFORD_INDEMNITY_RATE = 0.04


def is_weatherford_gdb(text: str, filename: str = "") -> bool:
    haystack = f"{filename}\n{text[:5000]}".upper()
    return (
        ("WEATHERFORD" in haystack or "PRECISION ENERGY SERVICES" in haystack)
        and "LOGGING OPERATIONS SUMMARY" in haystack
    )


def _clean(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _number(value):
    match = re.search(r"-?\d+(?:\.\d+)?", _clean(value).replace(",", ""))
    return float(match.group(0)) if match else None


def _label(value) -> str:
    return _clean(value).lower().replace(" ", "")


def _table_with_label(tables, label: str):
    wanted = _label(label)
    for table in tables or []:
        for row in table or []:
            if any(wanted in _label(cell) for cell in row or []):
                return table
    return None


def _header_table_values(tables, label: str):
    table = _table_with_label(tables, label)
    if not table or len(table) < 2:
        return {}
    headers = table[0]
    values = table[1]
    return {
        _clean(header).rstrip(":"): _clean(values[index]) if index < len(values) else ""
        for index, header in enumerate(headers)
        if _clean(header)
    }


def _value_for(values: dict, label: str) -> str:
    wanted = _label(label)
    for key, value in values.items():
        if wanted == _label(key) or wanted in _label(key):
            return value
    return ""


def _line_value(text: str, label: str) -> str:
    match = re.search(rf"{re.escape(label)}\s*:\s*([^\n]*)", text, re.IGNORECASE)
    return _clean(match.group(1)) if match else ""


def _value_after_line_label(text: str, label: str) -> str:
    match = re.search(rf"{re.escape(label)}\s*:\s*\n\s*([^\n]+)", text, re.IGNORECASE)
    return _clean(match.group(1)) if match else ""


def _end_time(start: str, duration: str) -> str:
    try:
        start_time = datetime.strptime(start, "%H:%M")
        hours, minutes = (int(part) for part in duration.split(":"))
        return (start_time + timedelta(hours=hours, minutes=minutes)).strftime("%H:%M")
    except (TypeError, ValueError):
        return ""


def _duration_hours(duration: str):
    try:
        hours, minutes = (int(part) for part in duration.split(":"))
        return round(hours + minutes / 60.0, 2)
    except (TypeError, ValueError):
        return None


def _quote_charge_row(header: dict, filename: str, contractor: str, code: str,
                      description: str, quantity: float, unit_rate: float,
                      rate_basis: str) -> dict:
    row = _base_row(filename, contractor, header)
    row.update({
        "code": code,
        "notes": f"Expected charge - {description} | Quote {WEATHERFORD_QUOTE_REFERENCE}",
        "rate_year": "2026",
        "unit_rate": round(unit_rate, 4),
        "quantity": round(quantity, 2),
        "line_cost": round(quantity * unit_rate, 2),
        "rate_basis": f"Weatherford quote {WEATHERFORD_QUOTE_REFERENCE}: {rate_basis}",
    })
    return row


def _expected_quote_charges(header: dict, operation_rows: list[dict], filename: str,
                            contractor: str) -> tuple[list[dict], list[str]]:
    charges = []
    warnings = []
    rentals = WEATHERFORD_CALLOUT_DAY
    charges.append(_quote_charge_row(
        header, filename, contractor, "WFD_Callout_Day", "logging unit callout",
        1, WEATHERFORD_CALLOUT_DAY, "$2,650 per unit/day (10 hours base to base)",
    ))

    worked_hours = _duration_hours(header.get("total_time", ""))
    if worked_hours is None:
        warnings.append("Total day length is missing; additional hours could not be estimated.")
    elif worked_hours > 10:
        additional_hours = round(worked_hours - 10, 2)
        charges.append(_quote_charge_row(
            header, filename, contractor, "WFD_Additional_Hours", "hours beyond the 10-hour callout",
            additional_hours, WEATHERFORD_ADDITIONAL_HOUR, "$200 per additional hour",
        ))

    chargeable_km = header.get("distance_over_100_km")
    total_km = header.get("distance_km")
    if chargeable_km is None and total_km is not None:
        chargeable_km = max(total_km - 100.0, 0.0)
    if chargeable_km is None:
        warnings.append("Base-to-base kilometres are blank; any mileage charge is excluded.")
    elif chargeable_km > 0:
        charges.append(_quote_charge_row(
            header, filename, contractor, "WFD_Excess_Kilometres", "kilometres beyond the 100 km/day allowance",
            chargeable_km, WEATHERFORD_EXCESS_KM, "$2.45 per kilometre over 100 km/day",
        ))

    meal_values = header.get("meals", [])
    if any("wft supplied" in str(value).lower() for value in meal_values):
        charges.append(_quote_charge_row(
            header, filename, contractor, "WFD_Meals_Subsistence", "Weatherford-supplied meals and subsistence",
            1, WEATHERFORD_MEALS_DAY, "$125 daily charge",
        ))

    used_sondes = {str(value).upper() for value in header.get("used_sondes", [])}
    televiewers = []
    if any(sonde.startswith("OTV") for sonde in used_sondes):
        televiewers.append(("WFD_OTV_Rental", "optical televiewer rental"))
    if any(sonde.startswith(("ATV", "ALT")) for sonde in used_sondes):
        televiewers.append(("WFD_ATV_Rental", "acoustic televiewer rental"))
    for code, description in televiewers:
        rentals += WEATHERFORD_TELEVIEWER_DAY
        charges.append(_quote_charge_row(
            header, filename, contractor, code, description,
            1, WEATHERFORD_TELEVIEWER_DAY, "$150 per tool/day",
        ))

    if any(row.get("code") == "P200" for row in operation_rows):
        charges.append(_quote_charge_row(
            header, filename, contractor, "WFD_Data_Processing", "additional WellCAD data processing",
            1, WEATHERFORD_PROCESSING_HOLE, "$250 per logged hole",
        ))

    charges.append(_quote_charge_row(
        header, filename, contractor, "WFD_Indemnity_Waiver", "downhole indemnity waiver",
        rentals, WEATHERFORD_INDEMNITY_RATE, "4% of logging unit and televiewer rentals",
    ))

    if "wft supplied" in str(header.get("accommodation", "")).lower():
        warnings.append("Weatherford supplied accommodation; accommodation cost + 15% is excluded until the base cost is known.")
    return charges, warnings


def _base_row(filename: str, contractor: str, header: dict) -> dict:
    return {
        "source_file": filename,
        "contractor": contractor,
        "date": header.get("date", ""),
        "hole_num": header.get("hole_num", ""),
        "site_name": header.get("site_name", ""),
        "location": header.get("location", ""),
        "drill_rig": header.get("drill_rig", ""),
        "client": header.get("client", ""),
        "contract": header.get("contract", ""),
        "shift": "",
        "time_from": "",
        "time_to": "",
        "total_time": "",
        "bit_type": "",
        "diameter": "",
        "metres_from": None,
        "metres_to": None,
        # These are logging intervals, not newly drilled metres.
        "total_metres": None,
        "code": "",
        "notes": "",
        "rate_year": None,
        "unit_rate": None,
        "quantity": None,
        "line_cost": None,
        "rate_basis": None,
        "po_id": None,
    }


def parse_weatherford_gdb(text: str, tables, filename: str, contractor: str = "Weatherfords"):
    """Return ``(header, activities, crew)`` for a Weatherford GDB report."""
    if not is_weatherford_gdb(text, filename):
        raise ValueError("Not a Weatherford GDB logging report")

    report_values = _header_table_values(tables, "Date:")
    shift_values = _header_table_values(tables, "Shift Start")
    depth_values = _header_table_values(tables, "Driller Depth")
    meal_values = _header_table_values(tables, "Breakfast")

    client_line = _line_value(text, "CLIENT")
    client = re.split(r"\s+Site Number\s*:?", client_line, flags=re.IGNORECASE)[0].strip()
    location_line = _line_value(text, "Site")
    location = re.split(r"\s+Well Number\s*:?", location_line, flags=re.IGNORECASE)[0].strip()
    site_number = _value_after_line_label(text, "Site Number")
    well_number = _value_after_line_label(text, "Well Number")
    eticket_match = re.search(r"Eticket Reference:\s*([A-Z0-9-]+)", text, re.IGNORECASE)
    eticket = eticket_match.group(1) if eticket_match else ""

    header = {
        "client": client,
        "contract": "",
        "date": report_values.get("Date", ""),
        "hole_num": well_number or site_number,
        "site_name": site_number or location,
        "location": location,
        "drill_rig": report_values.get("Unit", ""),
        "engineer": report_values.get("Engineer", ""),
        "shift_start": shift_values.get("Shift Start (hh:mm)", "") or shift_values.get("Shift Start", ""),
        "shift_length": shift_values.get("Shift Length (hh:mm)", "") or shift_values.get("Shift Length", ""),
        "total_time": _value_for(shift_values, "Total Time"),
        "travel_time": _value_for(shift_values, "Travel Time"),
        "distance_km": _number(_value_for(shift_values, "Distance (km)")),
        "distance_over_100_km": _number(_value_for(shift_values, "Distance >100 km")),
        "meals": [_value_for(meal_values, meal) for meal in ("Breakfast", "Lunch", "Dinner")],
        "accommodation": _value_for(meal_values, "Accom"),
        "eticket": eticket,
        "driller_depth": _number(depth_values.get("Driller Depth")),
        "logger_td": _number(depth_values.get("Logger TD")),
    }

    operations_table = _table_with_label(tables, "Operation")
    if not operations_table:
        raise ValueError("Weatherford logging operations table was not found")

    activities = []
    used_sondes = []
    for raw_row in operations_table[2:]:
        row = list(raw_row or []) + [""] * 9
        operation = _clean(row[0])
        if not operation or operation.lower() == "end job":
            continue
        operation_match = re.match(r"^([A-Z]\d{3})\s*(.*)$", operation)
        if not operation_match:
            continue

        code, description = operation_match.groups()
        serial = _clean(row[1])
        if serial:
            used_sondes.append(serial)
        report_date = _clean(row[2]) or header["date"]
        start = _clean(row[3])
        duration = _clean(row[7])
        comments = _clean(row[8])
        notes = [description or operation]
        if serial:
            notes.append(f"Sonde {serial}")
        if comments:
            notes.append(comments)
        if eticket:
            notes.append(f"E-ticket {eticket}")

        activity = _base_row(filename, contractor, header)
        activity.update({
            "date": report_date,
            "time_from": start,
            "time_to": _end_time(start, duration),
            "total_time": duration,
            "metres_from": _number(row[4]),
            "metres_to": _number(row[5]),
            "code": code,
            "notes": " | ".join(notes),
            "rate_year": "2026",
            "unit_rate": 0.0,
            "quantity": _duration_hours(duration),
            "line_cost": 0.0,
            "rate_basis": "Weatherford operational detail; priced through quote charge rows",
        })
        activities.append(activity)

    crew = []
    if header["engineer"]:
        crew.append({
            "source_file": filename,
            "contractor": contractor,
            "date": header["date"],
            "hole_num": header["hole_num"],
            "site_name": header["site_name"],
            "role": "Logging Engineer",
            "name": header["engineer"],
            "hours": _duration_hours(header["shift_length"]),
        })

    if not activities:
        raise ValueError("Weatherford report contained no importable operation rows")
    header["used_sondes"] = used_sondes
    charge_rows, pricing_warnings = _expected_quote_charges(header, activities, filename, contractor)
    header["pricing_warnings"] = pricing_warnings
    header["expected_cost_ex_gst"] = round(sum(row["line_cost"] for row in charge_rows), 2)
    return header, activities + charge_rows, crew
