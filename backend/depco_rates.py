"""DEPCO 26038 contract catalogue and conservative, unit-aware activity pricing."""

import json
import math
import re
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime
from pathlib import Path

CATALOG = json.loads((Path(__file__).parent / 'data' / 'depco_26038_rates.json').read_text(encoding='utf-8'))
BY_CODE = {r['cost_code']: r for r in CATALOG['rates']}
SCOPES = {'A': 'Exploration', 'B': 'SIS', 'C': 'Gas Riser'}


def norm(value):
    return re.sub(r'[^a-z0-9]+', '', str(value or '').lower())


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else None
    except (TypeError, ValueError):
        return None


def hours(value):
    if ':' not in str(value):
        return number(value)
    parts = str(value).split(':')
    if len(parts) != 2:
        return None
    h, m = map(number, parts)
    return h + m / 60 if h is not None and m is not None and m < 60 else None


def money(value):
    return float(Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


def catalogue(scope):
    if scope not in SCOPES:
        raise ValueError('Choose Exploration (A), SIS (B), or Service Casing (C)')
    return [dict(r) for r in CATALOG['rates'] if r['scope'] == scope]


def contract_rates(cur, contractor, project, program=''):
    """Resolve DEPCO by project AND program, refusing ambiguous project names."""
    if contractor != 'DEPCO Drilling' or not project:
        return None
    cur.execute("""
        SELECT cc.*, p.program FROM cost_contracts cc
        JOIN projects p ON p.id=cc.project_id
        WHERE cc.contractor=%s AND LOWER(p.name)=LOWER(%s) AND cc.status='Active'
          AND (%s='' OR LOWER(p.program)=LOWER(%s))
    """, (contractor, project, program or '', program or ''))
    contracts = [dict(r) for r in cur.fetchall()]
    if len(contracts) != 1:
        return []
    cur.execute('SELECT * FROM cost_contract_rates WHERE contract_id=%s ORDER BY sort_order, id', (contracts[0]['id'],))
    lines = [{**dict(r), '_start_date':contracts[0].get('start_date'), '_end_date':contracts[0].get('end_date')} for r in cur.fetchall()]
    return lines


LEGACY = {
    'H_Active': 'Active Rig Rate', 'H_Inactive': 'Standby Rate',
    'H_Casing_Install': 'Casing Install', 'H_Casing_Retrieval': 'Casing Retrieval',
    'H_Tripping_Rods': 'Tripping Rods', 'H_Rig_Cementing': 'Rig Cementing',
    'H_Setup_Packup_Site': 'Setup Packup Site', 'H_Mob_Demob': 'Mob Demob site to site',
    'H_Standby_AAC': 'Standby AAC', 'H_Standby_Logging': 'Standby Logging',
    'H_Standby_Logger': 'Standby Logger', 'H_Standby_Wet_Weather': 'Standby Wet Weat',
    'H_Safety_Prestart': 'Safety Prestart', 'H_Repairs': 'Repairs',
    'H_Maintenance': 'Maintenance', 'H_Drilling': 'Drilling',
}


def price_depco_activity(row, lines):
    """No fuzzy fallback, implicit one-day quantity, or missing-price-as-zero."""
    result = {k: None for k in ('unit_rate', 'quantity', 'line_cost')}
    year = re.search(r'\b(\d{4})\b', str(row.get('date') or ''))
    result['rate_year'] = year.group(1) if year else None
    result['quantity'] = number(row.get('quantity'))

    def pending(reason):
        return {**result, 'rate_basis': 'DEPCO review required: ' + reason}

    if not lines:
        return pending('select one active DEPCO contract for this project and program')
    if lines[0].get('_start_date') or lines[0].get('_end_date'):
        def parse_date(value):
            for fmt in ('%Y-%m-%d','%d/%m/%Y','%d/%m/%y'):
                try:
                    return datetime.strptime(str(value),fmt).date()
                except ValueError:
                    pass
            return None
        activity_date=parse_date(row.get('date'))
        start=parse_date(lines[0].get('_start_date'))
        end=parse_date(lines[0].get('_end_date'))
        if not activity_date or (start and activity_date < start) or (end and activity_date > end):
            return pending('activity date is missing or outside the contract dates')
    code = str(row.get('code') or '').strip()
    selected = [r for r in lines if r.get('cost_code') == code] if code else []
    if not selected:
        label = LEGACY.get(code, code)
        selected = [r for r in lines if label and norm(label) in {
            norm(r.get('name')), *[norm(a) for a in BY_CODE.get(r.get('cost_code'), {}).get('aliases', [])]
        }]
    if not selected:
        return pending('map this activity to a contract code')
    # One drill code identifies a size; pricing spans every depth band for that size.
    first = selected[0]
    if first.get('section') == 'Drilling Rates' and first.get('depth_from') is not None:
        bands = [r for r in lines if r.get('section') == 'Drilling Rates' and r.get('name') == first['name']]
        start, end, metres = (number(row.get(k)) for k in ('metres_from','metres_to','total_metres'))
        if start is None or end is None or metres is None or end <= start or abs(end-start-metres) > .01:
            return pending('provide matching from/to depths and drilled metres')
        relevant = sorted((r for r in bands if number(r.get('depth_from')) is not None and number(r.get('depth_to')) is not None and float(r['depth_to']) > start and float(r['depth_from']) < end), key=lambda r: float(r['depth_from']))
        if any(float(a['depth_to']) > float(b['depth_from']) for a,b in zip(relevant,relevant[1:])):
            return pending('overlapping drilling depth bands')
        cursor, cost, details = start, Decimal('0'), []
        while cursor < end:
            matches = [r for r in bands if number(r.get('depth_from')) is not None and number(r.get('depth_to')) is not None and float(r['depth_from']) <= cursor < float(r['depth_to'])]
            if len(matches) != 1:
                return pending('missing or overlapping drilling depth bands')
            rate = matches[0]
            if rate.get('status') != 'Active' or number(rate.get('charge')) is None:
                return pending('depth band needs an agreed rate: ' + str(rate.get('reference_name') or rate['name']))
            length = min(end, float(rate['depth_to']))-cursor
            cost += Decimal(str(length))*Decimal(str(rate['charge']))
            details.append(f"{length:g}m × ${rate['charge']:g}")
            cursor += length
        return {**result, 'code': first['cost_code'], 'quantity':metres,
                'unit_rate':float(cost/Decimal(str(metres))), 'line_cost':money(cost),
                'rate_basis':'DEPCO 26038 ex GST: '+ '; '.join(details)}
    if len(selected) != 1:
        return pending('multiple contract codes match; select one explicitly')
    rate = first
    result['code'] = rate['cost_code']
    if rate.get('status') != 'Active' or number(rate.get('charge')) is None:
        return pending(str(rate.get('reference_name') or rate.get('category') or 'confirm charge conditions and price'))
    unit = str(rate.get('unit') or '').lower()
    if not unit:
        return pending('set the contract billing unit')
    quantity = hours(row.get('total_time')) if unit == 'hour' else number(row.get('total_metres')) if unit == 'metre' else number(row.get('quantity'))
    if quantity is None:
        return pending('enter ' + ('duration' if unit == 'hour' else 'metres' if unit == 'metre' else f'quantity in {unit}'))
    if unit == 'hour' and '15 min increments' in str(rate.get('category')) and abs(quantity*4-round(quantity*4)) > .00001:
        return pending('confirm billable duration in 15-minute increments')
    result.update(unit_rate=number(rate['charge']), quantity=quantity,
                  line_cost=money(Decimal(str(rate['charge']))*Decimal(str(quantity))),
                  rate_basis=f"DEPCO 26038 ex GST: {quantity:g} {unit} × ${rate['charge']:g}; {rate.get('reference_name') or rate['name']}")
    return result
