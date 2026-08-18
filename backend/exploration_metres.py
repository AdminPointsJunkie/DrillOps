"""2026 exploration drilling metre calculations for period reports."""

from datetime import date as calendar_date
from datetime import datetime


SITE_DEFINITIONS = {
    "CD": {"name": "Carborough Downs", "project": "Carborough Downs"},
    "IB": {"name": "Ironbark", "project": "Ironbark"},
}

DEPTH_BANDS = (
    ("0-100", 0.0, 100.0),
    ("100-200", 100.0, 200.0),
    ("200-300", 200.0, 300.0),
    ("300+", 300.0, None),
)

DRILLING_CODES = {"Drill_Core", "Drill_Chip_or_Open_hole"}


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _activity_date(value):
    raw = str(value or "").strip()
    for date_format in ("%Y-%m-%d", "%d/%m/%Y", "%d %B %Y", "%d %b %Y"):
        try:
            return datetime.strptime(raw[:20], date_format).date()
        except (TypeError, ValueError):
            continue
    return None


def _activity_site(row):
    hole = str(row.get("hole_num") or "").strip().upper()
    for site_code in SITE_DEFINITIONS:
        if hole.startswith(site_code):
            return site_code
    return None


def _drilling_interval(row):
    """Return a positive interval whose length equals the reported metres.

    Most report rows contain a consistent from/to interval. For malformed OCR
    rows, anchor the reported metres at the greatest recorded depth so the
    reported production remains in the total and can still be depth-banded.
    """
    total = _number(row.get("total_metres"))
    if total is None or total <= 0:
        return None

    depth_from = _number(row.get("metres_from"))
    depth_to = _number(row.get("metres_to"))
    known_depths = [max(depth, 0.0) for depth in (depth_from, depth_to) if depth is not None]
    if not known_depths:
        return None

    start = min(known_depths)
    end = max(known_depths)
    span = end - start
    tolerance = max(0.05, total * 0.005)
    if span <= 0 or abs(span - total) > tolerance:
        end = max(known_depths)
        start = max(0.0, end - total)

    if end <= start:
        return None
    return start, end, total


def _dedupe_key(row, site_code, report_date):
    def rounded(value):
        number = _number(value)
        return round(number, 2) if number is not None else None

    return (
        site_code,
        str(row.get("hole_num") or "").strip().upper(),
        report_date.isoformat(),
        str(row.get("code") or "").strip(),
        rounded(row.get("metres_from")),
        rounded(row.get("metres_to")),
        rounded(row.get("total_metres")),
    )


def _split_depth_bands(start, end, total):
    span = end - start
    if span <= 0:
        return {}
    allocations = {}
    for label, band_start, band_end in DEPTH_BANDS:
        overlap_start = max(start, band_start)
        overlap_end = end if band_end is None else min(end, band_end)
        overlap = max(overlap_end - overlap_start, 0.0)
        allocations[label] = total * overlap / span
    return allocations


def _site_plan_summary(boreholes, activity_rows, site_code, year):
    definition = SITE_DEFINITIONS[site_code]
    site_boreholes = [
        row for row in boreholes
        if str(row.get("contractor") or "").strip() == "Company"
        and str(row.get("planned_year") or "").strip() == str(year)
        and str(row.get("project") or "").strip().lower() == definition["project"].lower()
    ]

    groups = {}
    for row in site_boreholes:
        group_key = str(row.get("site_id") or row.get("hole_id") or "").strip().upper()
        if not group_key:
            continue
        group = groups.setdefault(group_key, {"rows": [], "hole_ids": set()})
        group["rows"].append(row)
        hole_id = str(row.get("hole_id") or "").strip().upper()
        if hole_id:
            group["hole_ids"].add(hole_id)

    activity_depths = {}
    for row in activity_rows:
        interval = _drilling_interval(row)
        if not interval:
            continue
        hole_id = str(row.get("hole_num") or "").strip().upper()
        site_id = str(row.get("site_name") or "").strip().upper()
        end = interval[1]
        for key in {hole_id, site_id} - {""}:
            activity_depths[key] = max(activity_depths.get(key, 0.0), end)

    remaining_metres = 0.0
    open_holes = 0
    planned_holes = 0
    in_progress_holes = 0
    for group_key, group in groups.items():
        statuses = {
            str(row.get("status") or "Planned").strip().lower()
            for row in group["rows"]
        }
        if any(status.startswith("complete") for status in statuses):
            continue
        if statuses and statuses.issubset({"cancelled", "canceled", "abandoned"}):
            continue

        eoh_depth = max(
            (_number(row.get("eoh_depth")) or 0.0 for row in group["rows"]),
            default=0.0,
        )
        drilled_depth = max(
            [activity_depths.get(group_key, 0.0)]
            + [activity_depths.get(hole_id, 0.0) for hole_id in group["hole_ids"]]
        )
        remaining_metres += max(eoh_depth - drilled_depth, 0.0)
        open_holes += 1
        if "in progress" in statuses:
            in_progress_holes += 1
        else:
            planned_holes += 1

    return {
        "remaining_metres": round(remaining_metres, 2),
        "open_holes": open_holes,
        "planned_holes": planned_holes,
        "in_progress_holes": in_progress_holes,
    }


def summarize_exploration_metres(activity_rows, boreholes, year):
    """Build the annual CD/IB actual, remaining, and depth-band summary."""
    year = int(year)
    summaries = {
        code: {
            "site_code": code,
            "site_name": definition["name"],
            "actual_metres": 0.0,
            "depth_bands": {label: 0.0 for label, _, _ in DEPTH_BANDS},
            "report_rows": 0,
            "deduplicated_rows": 0,
            "unallocated_depth_metres": 0.0,
        }
        for code, definition in SITE_DEFINITIONS.items()
    }

    seen = set()
    current_year_rows = []
    for row in activity_rows:
        if str(row.get("code") or "").strip() not in DRILLING_CODES:
            continue
        report_date = _activity_date(row.get("date"))
        site_code = _activity_site(row)
        if not report_date or report_date.year != year or not site_code:
            continue
        current_year_rows.append(row)
        summary = summaries[site_code]
        summary["report_rows"] += 1
        key = _dedupe_key(row, site_code, report_date)
        if key in seen:
            summary["deduplicated_rows"] += 1
            continue
        seen.add(key)

        total = _number(row.get("total_metres")) or 0.0
        if total <= 0:
            continue
        summary["actual_metres"] += total
        interval = _drilling_interval(row)
        if not interval:
            summary["unallocated_depth_metres"] += total
            continue
        for label, metres in _split_depth_bands(*interval).items():
            summary["depth_bands"][label] += metres

    result_rows = []
    for site_code, summary in summaries.items():
        plan = _site_plan_summary(boreholes, current_year_rows, site_code, year)
        actual = summary["actual_metres"]
        bands = []
        for label, _, _ in DEPTH_BANDS:
            metres = summary["depth_bands"][label]
            bands.append({
                "label": label,
                "metres": round(metres, 2),
                "proportion": round((metres / actual * 100.0) if actual else 0.0, 1),
            })
        result_rows.append({
            **{key: value for key, value in summary.items() if key != "depth_bands"},
            **plan,
            "actual_metres": round(actual, 2),
            "depth_bands": bands,
            "unallocated_depth_metres": round(summary["unallocated_depth_metres"], 2),
        })

    return {
        "year": year,
        "as_of": calendar_date.today().isoformat(),
        "sites": result_rows,
        "methodology": {
            "actual": "Sum of 2026 Drill_Core and Drill_Chip_or_Open_hole report metres after exact interval de-duplication.",
            "remaining": "Open Borehole Planning EOH metres less reported depth on mapped in-progress holes; completed and cancelled holes are excluded.",
            "depth_bands": "Reported metres are proportionally split where an interval crosses a 100 m depth boundary.",
        },
    }
