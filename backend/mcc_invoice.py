"""MCC invoice parsing and weekly-timesheet reconciliation helpers."""

import os
import re
from datetime import datetime, timedelta

from mcc_rates import MCC_RATE_TABLE


MCC_INVOICE_ITEMS = [
    ("supervisor", "MCC_SUPERVISOR"),
    ("multi skilled operator", "MCC_MULTI_SKILLED_OPERATOR"),
    ("operator", "MCC_MULTI_SKILLED_OPERATOR"),
    ("13t excavator", "MCC_13T_EXCAVATOR"),
    ("backhoe", "MCC_BACKHOE"),
    ("watercart", "MCC_BODY_WATER_TRUCK"),
    ("water cart", "MCC_BODY_WATER_TRUCK"),
    ("vac truck", "MCC_VAC_TRUCK"),
    ("vacuum truck", "MCC_VAC_TRUCK"),
    ("light vehicles", "MCC_LIGHT_VEHICLE"),
    ("light vehicle", "MCC_LIGHT_VEHICLE"),
]


def mcc_rate_by_code(code):
    for item_code, description, rate, unit, group, _aliases in MCC_RATE_TABLE:
        if item_code == code:
            return {
                "code": item_code,
                "description": description,
                "rate": float(rate),
                "unit": unit,
                "group": group,
            }
    return None


def mcc_invoice_activity_code(description):
    value = re.sub(r"\s+", " ", str(description or "").lower()).strip()
    for needle, code in MCC_INVOICE_ITEMS:
        if needle in value:
            return code
    return ""


def _parse_human_date(value, default_year=None):
    value = re.sub(r"\s+", " ", str(value or "").strip())
    for pattern in ("%d %B %Y", "%d %b %Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(value, pattern).date()
        except ValueError:
            pass
    if default_year:
        for pattern in ("%d %B", "%d %b"):
            try:
                return datetime.strptime(f"{value} {default_year}", f"{pattern} %Y").date()
            except ValueError:
                pass
    return None


def parse_mcc_invoice_service_period(text):
    """Return ISO start/end dates from MCC's REF NO service-period text."""
    value = re.sub(r"\s+", " ", str(text or ""))
    full = re.search(
        r"(\d{1,2}\s+[A-Za-z]+\s+20\d{2})\s+to\s+(\d{1,2}\s+[A-Za-z]+\s+20\d{2})",
        value,
        re.I,
    )
    if full:
        start = _parse_human_date(full.group(1))
        end = _parse_human_date(full.group(2))
        return (start.isoformat(), end.isoformat()) if start and end else ("", "")

    same_month = re.search(
        r"(\d{1,2})\s+to\s+(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})",
        value,
        re.I,
    )
    if same_month:
        month_year = f"{same_month.group(3)} {same_month.group(4)}"
        start = _parse_human_date(f"{same_month.group(1)} {month_year}")
        end = _parse_human_date(f"{same_month.group(2)} {month_year}")
        return (start.isoformat(), end.isoformat()) if start and end else ("", "")

    cross_month = re.search(
        r"(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})\s+to\s+(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})",
        value,
        re.I,
    )
    if cross_month:
        start = _parse_human_date(" ".join(cross_month.group(i) for i in (1, 2, 3)))
        end = _parse_human_date(" ".join(cross_month.group(i) for i in (4, 5, 6)))
        return (start.isoformat(), end.isoformat()) if start and end else ("", "")
    return "", ""


def parse_mcc_invoice_pdf(text, filename, categorise_line=None):
    """Parse MCC's Xero-style tax invoice into auditable line items."""
    raw_lines = [line.strip() for line in str(text or "").splitlines() if line.strip()]

    def find(pattern, default="", flags=re.I):
        match = re.search(pattern, text or "", flags)
        return match.group(1).strip() if match else default

    def money(pattern):
        raw = find(pattern, flags=re.M)
        try:
            return float(raw.replace(",", "")) if raw else 0.0
        except ValueError:
            return 0.0

    invoice_number = (
        find(r"\bINVOICE\s+(ARG[-A-Z0-9]+(?:/\d+)?)")
        or find(r"(ARG[-A-Z]+[-]?\d+(?:/\d+)?)", os.path.splitext(filename)[0])
    )
    invoice_date = find(r"\bDATE\s+(\d{1,2}/\d{1,2}/\d{4})")
    due_date = find(r"\bDUE DATE\s+(\d{1,2}/\d{1,2}/\d{4})")
    po_reference = find(r"\bPO\s+(?:REF NO\s+)?([A-Z]\d{4,})")
    service_start, service_end = parse_mcc_invoice_service_period(text)

    subtotal = money(r"^SUBTOTAL\s+([\d,]+\.\d{2})\s*$")
    gst = money(r"^GST TOTAL\s+([\d,]+\.\d{2})\s*$")
    total_aud = money(r"^TOTAL\s+([\d,]+\.\d{2})\s*$")
    if not total_aud:
        total_aud = money(r"A\$([\d,]+\.\d{2})")

    line_re = re.compile(
        r"^(Labour Services|Hire - [A-Za-z ]+)\s+([\d,]+(?:\.\d+)?)\s+"
        r"([\d,]+(?:\.\d{2})?)\s+GST\s+([\d,]+(?:\.\d{2})?)$",
        re.I,
    )
    lines = []
    for index, raw_line in enumerate(raw_lines):
        match = line_re.match(raw_line)
        if not match:
            continue
        item = match.group(1).strip()
        detail = raw_lines[index + 1] if index + 1 < len(raw_lines) else ""
        if re.search(r"\b(SUBTOTAL|GST|TOTAL|DATE|PO)\b", detail, re.I):
            detail = ""
        description = f"{item} - {detail}" if detail else item
        activity_code = mcc_invoice_activity_code(description)
        rate = mcc_rate_by_code(activity_code)
        category = categorise_line(description) if categorise_line else (
            "labour" if activity_code.startswith("MCC_") and rate and rate["group"] == "labour" else "equipment"
        )
        lines.append({
            "description": description,
            "quantity": float(match.group(2).replace(",", "")),
            "unit_price": float(match.group(3).replace(",", "")),
            "gst_rate": "10%",
            "amount": float(match.group(4).replace(",", "")),
            "category": category,
            "activity_code": activity_code or None,
            "unit": rate["unit"] if rate else "item",
            "chargeable": "Claimed",
            "source_category": "MCC invoice",
        })

    if subtotal == 0 and lines:
        subtotal = round(sum(line["amount"] for line in lines), 2)
    if gst == 0 and subtotal:
        gst = round(subtotal * 0.1, 2)
    if total_aud == 0 and subtotal:
        total_aud = round(subtotal + gst, 2)

    return {
        "invoice_number": invoice_number or os.path.splitext(filename)[0],
        "invoice_date": invoice_date,
        "due_date": due_date,
        "po_reference": po_reference,
        "service_start": service_start,
        "service_end": service_end,
        "client": "Argo Coal Management Pty Ltd",
        "subtotal": subtotal,
        "gst": gst,
        "total_aud": total_aud,
        "amount_paid": 0.0,
        "amount_due": total_aud,
        "status": "Unpaid",
        "lines": lines,
    }


def mcc_smu_total(notes):
    match = re.search(r"\bSMU:\s*.*?\(([-+]?\d+(?:\.\d+)?)\)", str(notes or ""), re.I)
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def mcc_service_dates(service_start, service_end):
    try:
        start = datetime.strptime(service_start, "%Y-%m-%d").date()
        end = datetime.strptime(service_end, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return []
    if end < start or (end - start).days > 31:
        return []
    result = []
    current = start
    while current <= end:
        result.extend([current.isoformat(), current.strftime("%d/%m/%Y")])
        current += timedelta(days=1)
    return result


def reconcile_mcc_invoice_lines(invoice_lines, weekly_rows):
    """Compare invoice lines with the matching week's quantities at contract rates."""
    weekly_by_code = {}
    for row in weekly_rows or []:
        code = str(row.get("code") or "")
        weekly_by_code.setdefault(code, []).append(row)

    reconciled = []
    for source_line in invoice_lines or []:
        line = dict(source_line)
        code = str(line.get("activity_code") or mcc_invoice_activity_code(line.get("description")) or "")
        rate = mcc_rate_by_code(code)
        evidence = weekly_by_code.get(code, [])
        invoice_qty = float(line.get("quantity") or 0)
        invoice_rate = float(line.get("unit_price") or 0)
        invoice_amount = float(line.get("amount") or 0)
        weekly_qty = 0.0

        if rate and rate["unit"] == "day":
            weekly_qty = float(len({str(row.get("date") or "") for row in evidence if row.get("date")}))
        elif rate and rate["group"] == "equipment":
            for row in evidence:
                smu = mcc_smu_total(row.get("notes"))
                weekly_qty += smu if smu is not None else float(row.get("quantity") or 0)
        else:
            weekly_qty = sum(float(row.get("quantity") or 0) for row in evidence)

        weekly_qty = round(weekly_qty, 2)
        contract_rate = float(rate["rate"]) if rate else 0.0
        contract_cost = round(weekly_qty * contract_rate, 2) if rate else 0.0
        qty_variance = round(invoice_qty - weekly_qty, 2)
        rate_variance = round(invoice_rate - contract_rate, 2) if rate else None
        amount_variance = round(invoice_amount - contract_cost, 2)
        issues = []

        if not rate:
            status = "supporting_document_required"
            issues.append("No contract schedule item; supporting invoice or approval is required.")
        elif not evidence:
            status = "no_weekly_evidence"
            issues.append("No matching quantity is recorded in the weekly report.")
        else:
            quantity_tolerance = 0.01 if rate["unit"] == "day" else 0.05
            if abs(qty_variance) > quantity_tolerance:
                issues.append(f"Invoice quantity differs from weekly evidence by {qty_variance:+.2f} {rate['unit']}.")
            if abs(rate_variance or 0) > 0.01:
                issues.append(f"Invoice rate differs from the contract schedule by ${rate_variance:+,.2f}/{rate['unit']}.")
            if abs(rate_variance or 0) > 0.01:
                status = "rate_error"
            elif abs(qty_variance) > quantity_tolerance:
                status = "quantity_error"
            elif abs(amount_variance) <= 1:
                status = "exact_match"
            else:
                status = "amount_error"
                issues.append("Line amount does not equal the supported quantity at the contract rate.")

        line.update({
            "activity_code": code or None,
            "matched_eos_quantity": weekly_qty,
            "matched_eos_rate": contract_rate if rate else None,
            "matched_eos_cost": contract_cost,
            "quantity_variance": qty_variance if rate else None,
            "rate_variance": rate_variance,
            "variance": amount_variance,
            "match_status": status,
            "audit_note": " ".join(issues) if issues else "Quantity and rate agree with the weekly report and contract schedule.",
        })
        reconciled.append(line)
    return reconciled
