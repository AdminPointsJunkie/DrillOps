"""MCC personnel swipe-history import and timesheet reconciliation helpers."""

import csv
import re
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta
from io import StringIO


MCC_COMPANY = "MCC Group"
MCC_PERSONNEL_VERIFICATION_START = date(2026, 8, 1)
MCC_MAX_VALID_SWIPE_MINUTES = 15 * 60
SITE_LOG_REQUIRED_HEADERS = {
    "Time In",
    "Time Out",
    "Dur (h:m)",
    "Site",
    "Logpoint",
    "First Name",
    "Last Name",
    "Person ID",
    "Company",
}


def _decode_csv(content):
    if isinstance(content, str):
        return content
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return bytes(content).decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("Site Log CSV must be UTF-8 or Windows-1252 text")


def _normalise_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalise_person_name(value):
    """Return a stable person key for case/punctuation-insensitive matching."""
    raw = _normalise_text(value)
    if "," in raw:
        last, first = raw.split(",", 1)
        raw = f"{first} {last}"
    folded = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", folded.casefold()).strip()


def looks_like_site_log_csv(content):
    try:
        reader = csv.reader(StringIO(_decode_csv(content)))
        headers = {_normalise_text(value) for value in next(reader)}
    except (StopIteration, csv.Error, ValueError):
        return False
    return SITE_LOG_REQUIRED_HEADERS.issubset(headers)


def _parse_site_datetime(value):
    text = _normalise_text(value)
    if not text or text.casefold() in {"not", "not logged out", "n/a", "-"}:
        return None
    for pattern in ("%d-%m-%y %H:%M", "%d/%m/%Y %H:%M", "%d-%m-%Y %H:%M"):
        try:
            return datetime.strptime(text, pattern)
        except ValueError:
            continue
    return None


def _duration_minutes(value):
    text = _normalise_text(value)
    match = re.fullmatch(r"(\d+):(\d{1,2})", text)
    if match:
        hours, minutes = int(match.group(1)), int(match.group(2))
        if minutes >= 60:
            raise ValueError(f"Invalid Site Log duration: {text}")
        return hours * 60 + minutes
    try:
        return max(0, int(round(float(text) * 60)))
    except (TypeError, ValueError):
        raise ValueError(f"Invalid Site Log duration: {text or 'blank'}")


def parse_site_log_csv(content, filename, company=MCC_COMPANY):
    """Parse one Site Log export and retain only the requested company's rows."""
    text = _decode_csv(content)
    reader = csv.DictReader(StringIO(text))
    headers = {_normalise_text(value) for value in (reader.fieldnames or [])}
    missing = SITE_LOG_REQUIRED_HEADERS - headers
    if missing:
        raise ValueError("Not a Site Log CSV; missing: " + ", ".join(sorted(missing)))

    company_key = _normalise_text(company).casefold()
    result = []
    for line_number, source in enumerate(reader, 2):
        source_company = _normalise_text(source.get("Company"))
        if source_company.casefold() != company_key:
            continue
        first_name = _normalise_text(source.get("First Name"))
        last_name = _normalise_text(source.get("Last Name"))
        person_name = _normalise_text(f"{first_name} {last_name}")
        time_in = _parse_site_datetime(source.get("Time In"))
        if not person_name or time_in is None:
            raise ValueError(f"Invalid MCC personnel or Time In at Site Log row {line_number}")
        raw_time_out = _normalise_text(source.get("Time Out"))
        time_out = _parse_site_datetime(raw_time_out)
        duration_minutes = _duration_minutes(source.get("Dur (h:m)"))
        result.append({
            "source_file": str(filename or "Site Log Report.csv"),
            "contractor": MCC_COMPANY,
            "source_company": source_company,
            "person_id": _normalise_text(source.get("Person ID")),
            "person_key": normalise_person_name(person_name),
            "first_name": first_name,
            "last_name": last_name,
            "person_name": person_name,
            "event_date": time_in.date(),
            "time_in": time_in,
            "time_out": time_out,
            "time_out_label": raw_time_out,
            "duration_minutes": duration_minutes,
            "timezone": _normalise_text(source.get("Timezone")),
            "site": _normalise_text(source.get("Site")),
            "logpoint": _normalise_text(source.get("Logpoint")),
            "activity": _normalise_text(source.get("Activity")),
            "open_shift": time_out is None and bool(raw_time_out),
        })

    if not result:
        raise ValueError(f"No {company} personnel rows found in Site Log CSV")
    return result


def _parse_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = _normalise_text(value)
    for pattern in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    return None


def _parse_datetime(value):
    if isinstance(value, datetime):
        return value
    text = _normalise_text(value)
    for pattern in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M"):
        try:
            return datetime.strptime(text[:19], pattern)
        except ValueError:
            continue
    return _parse_site_datetime(text)


def _decimal_hours(value):
    text = _normalise_text(value)
    if not text:
        return 0.0
    if re.fullmatch(r"\d+:\d{1,2}", text):
        return _duration_minutes(text) / 60
    try:
        return float(text)
    except (TypeError, ValueError):
        return 0.0


def _merged_swipe_minutes(rows):
    intervals = []
    fallback = []
    for row in rows:
        minutes = max(0, int(row.get("duration_minutes") or 0))
        if not minutes:
            continue
        start = _parse_datetime(row.get("time_in"))
        if start is None:
            fallback.append(minutes)
            continue
        intervals.append((start, start + timedelta(minutes=minutes)))
    if not intervals:
        return max(fallback, default=0)
    intervals.sort(key=lambda item: item[0])
    merged = [list(intervals[0])]
    for start, end in intervals[1:]:
        if start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return sum(int((end - start).total_seconds() // 60) for start, end in merged) + sum(fallback)


def _daily_status(has_submitted, swipe_minutes, open_shift, variance_hours, tolerance_hours):
    if has_submitted and swipe_minutes <= 0:
        return "no_swipe"
    if not has_submitted and swipe_minutes > 0:
        return "no_timesheet"
    if open_shift:
        return "open_swipe"
    if has_submitted and abs(variance_hours) <= tolerance_hours:
        return "verified"
    return "variance"


def build_mcc_personnel_reconciliation(
    crew_rows,
    swipe_rows,
    tolerance_minutes=30,
    verification_start=MCC_PERSONNEL_VERIFICATION_START,
):
    """Combine submitted weekly crew hours with deduplicated daily swipe coverage."""
    submitted = defaultdict(lambda: {
        "hours": 0.0,
        "name": "",
        "roles": set(),
        "source_files": set(),
        "rows": 0,
    })
    swipes = defaultdict(list)
    identities = defaultdict(lambda: {"name": "", "person_ids": set()})

    for row in crew_rows or []:
        name = _normalise_text(row.get("name"))
        person_key = normalise_person_name(name)
        report_date = _parse_date(row.get("date"))
        if not person_key or report_date is None or report_date < verification_start:
            continue
        key = (person_key, report_date)
        item = submitted[key]
        item["hours"] += _decimal_hours(row.get("hours"))
        item["name"] = name or item["name"]
        item["rows"] += 1
        if row.get("role"):
            item["roles"].add(_normalise_text(row.get("role")))
        if row.get("source_file"):
            item["source_files"].add(_normalise_text(row.get("source_file")))
        identities[person_key]["name"] = name or identities[person_key]["name"]

    for row in swipe_rows or []:
        name = _normalise_text(row.get("person_name") or f"{row.get('first_name', '')} {row.get('last_name', '')}")
        person_key = _normalise_text(row.get("person_key")) or normalise_person_name(name)
        report_date = _parse_date(row.get("event_date"))
        if not person_key or report_date is None or report_date < verification_start:
            continue
        swipes[(person_key, report_date)].append(row)
        identity = identities[person_key]
        identity["name"] = identity["name"] or name
        if row.get("person_id"):
            identity["person_ids"].add(_normalise_text(row.get("person_id")))

    days_by_person = defaultdict(list)
    tolerance_hours = max(0, tolerance_minutes) / 60
    # This register verifies hours that were actually submitted. Swipe-only
    # people and days are evidence without a timesheet claim, so do not show
    # them in the personnel review register.
    for person_key, report_date in sorted(submitted):
        submitted_item = submitted.get((person_key, report_date))
        swipe_items = swipes.get((person_key, report_date), [])
        submitted_hours = round(submitted_item["hours"], 2) if submitted_item else 0.0
        recorded_swipe_minutes = _merged_swipe_minutes(swipe_items)
        swipe_ignored = recorded_swipe_minutes > MCC_MAX_VALID_SWIPE_MINUTES
        swipe_minutes = 0 if swipe_ignored else recorded_swipe_minutes
        recorded_swipe_hours = round(recorded_swipe_minutes / 60, 2)
        swipe_hours = round(swipe_minutes / 60, 2)
        variance_hours = round(submitted_hours - swipe_hours, 2)
        positive_swipes = [row for row in swipe_items if int(row.get("duration_minutes") or 0) > 0]
        timed_swipes = sorted(
            ((row, _parse_datetime(row.get("time_in"))) for row in positive_swipes),
            key=lambda item: item[1] or datetime.max,
        )
        first_time = timed_swipes[0][1] if timed_swipes else None
        derived_ends = [
            start + timedelta(minutes=int(row.get("duration_minutes") or 0))
            for row, start in timed_swipes if start is not None
        ]
        reported_ends = [
            parsed for parsed in (_parse_datetime(row.get("time_out")) for row in positive_swipes)
            if parsed is not None
        ]
        open_shift = any(bool(row.get("open_shift")) for row in positive_swipes)
        last_time = max(reported_ends or derived_ends) if (reported_ends or derived_ends) else None
        status = _daily_status(
            submitted_item is not None,
            swipe_minutes,
            open_shift,
            variance_hours,
            tolerance_hours,
        )
        roles = sorted(submitted_item["roles"]) if submitted_item else []
        source_files = sorted(submitted_item["source_files"]) if submitted_item else []
        swipe_sources = sorted({_normalise_text(row.get("source_file")) for row in swipe_items if row.get("source_file")})
        logpoints = sorted({_normalise_text(row.get("logpoint")) for row in positive_swipes if row.get("logpoint")})
        swipe_details = []
        for row in sorted(swipe_items, key=lambda item: _parse_datetime(item.get("time_in")) or datetime.max):
            start = _parse_datetime(row.get("time_in"))
            reported_end = _parse_datetime(row.get("time_out"))
            minutes = max(0, int(row.get("duration_minutes") or 0))
            derived_end = start + timedelta(minutes=minutes) if start is not None and minutes else None
            is_open = bool(row.get("open_shift"))
            swipe_details.append({
                "time_in": start.strftime("%H:%M") if start else "",
                "time_out": "Not logged out" if is_open else (reported_end or derived_end).strftime("%H:%M") if (reported_end or derived_end) else "",
                "hours": round(minutes / 60, 2),
                "duration_minutes": minutes,
                "logpoint": _normalise_text(row.get("logpoint")),
                "site": _normalise_text(row.get("site")),
                "activity": _normalise_text(row.get("activity")),
                "source_file": _normalise_text(row.get("source_file")),
                "open_shift": is_open,
            })
        days_by_person[person_key].append({
            "date": report_date.strftime("%d/%m/%Y"),
            "date_iso": report_date.isoformat(),
            "submitted_hours": submitted_hours,
            "swipe_hours": swipe_hours,
            "recorded_swipe_hours": recorded_swipe_hours,
            "swipe_ignored": swipe_ignored,
            "variance_hours": variance_hours,
            "status": status,
            "role": ", ".join(roles),
            "time_in": first_time.strftime("%H:%M") if first_time and not swipe_ignored else "",
            "time_out": "" if swipe_ignored else "Not logged out" if open_shift else last_time.strftime("%H:%M") if last_time else "",
            "swipe_events": len(swipe_items),
            "logpoints": logpoints,
            "timesheet_sources": source_files,
            "swipe_sources": swipe_sources,
            "swipe_details": swipe_details,
        })

    status_priority = {
        "variance": 5,
        "no_swipe": 4,
        "no_timesheet": 3,
        "open_swipe": 2,
        "verified": 1,
    }
    people = []
    for person_key, days in days_by_person.items():
        days.sort(key=lambda item: item["date_iso"], reverse=True)
        identity = identities[person_key]
        submitted_hours = round(sum(item["submitted_hours"] for item in days), 2)
        swipe_hours = round(sum(item["swipe_hours"] for item in days), 2)
        variance_hours = round(submitted_hours - swipe_hours, 2)
        status = max((item["status"] for item in days), key=lambda value: status_priority[value])
        roles = sorted({item["role"] for item in days if item["role"]})
        people.append({
            "person_key": person_key,
            "name": identity["name"] or person_key.title(),
            "person_ids": sorted(identity["person_ids"]),
            "role": ", ".join(roles),
            "submitted_hours": submitted_hours,
            "swipe_hours": swipe_hours,
            "variance_hours": variance_hours,
            "days": days,
            "day_count": len(days),
            "review_days": sum(item["status"] != "verified" for item in days),
            "status": status,
        })

    people.sort(key=lambda item: item["name"].casefold())
    totals = {
        "people": len(people),
        "submitted_hours": round(sum(item["submitted_hours"] for item in people), 2),
        "swipe_hours": round(sum(item["swipe_hours"] for item in people), 2),
        "verified_days": sum(day["status"] == "verified" for item in people for day in item["days"]),
        "review_days": sum(day["status"] != "verified" for item in people for day in item["days"]),
    }
    return {
        "totals": totals,
        "people": people,
        "tolerance_minutes": tolerance_minutes,
        "verification_start": verification_start.isoformat(),
    }
