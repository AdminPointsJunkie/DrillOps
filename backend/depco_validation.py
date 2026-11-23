"""Validation Sheet rates, preserved zero-charge exceptions and explicit line matching."""
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from io import BytesIO
import re
from openpyxl import load_workbook


def norm(value):
    return re.sub(r'[^a-z0-9]+', '', str(value or '').lower().replace('<', ' less ').replace('>', ' greater '))


def validation_rates(content):
    workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
    try:
        sheet = next((s for s in workbook if norm(s.title) == 'validationsheet'), None)
        if sheet is None:
            raise ValueError('The workbook must include its Validation Sheet')
        rates = {}
        for index, row in enumerate(sheet.iter_rows(values_only=True), 1):
            name = str(row[0] or '').strip()
            if not name or name in ('Activity', 'Shift Total', 'End of Hole'):
                continue
            value = row[1] if len(row) > 1 else None
            rate = None
            if value is not None:
                try:
                    amount = Decimal(str(value))
                    if not amount.is_finite() or amount < 0:
                        raise ValueError()
                    rate = float(amount)
                except Exception:
                    raise ValueError(f'Validation Sheet row {index}: invalid rate') from None
            key = norm(name)
            if key in rates:
                raise ValueError(f'Validation Sheet: duplicate activity {name}')
            rates[key] = {'name': name, 'rate': rate, 'unit': str(row[2] or '').strip().lower(), 'source': f'Validation Sheet!B{index}'}
        return rates
    finally:
        workbook.close()


def apply_validation(rows, rates):
    result = []
    for row in rows:
        match = rates.get(norm(row.get('code')))
        rate = match['rate'] if match else None
        exception = row.get('line_cost') == 0 and row.get('unit_rate') == 0 and rate is not None and rate > 0
        expected = None if rate is None else 0.0 if exception else float(Decimal(str(rate)) * Decimal(str(row['quantity'])))
        result.append(dict(row, validation_rate=rate, validation_source=match['source'] if match else '',
                           validation_unit=match['unit'] if match else '', expected_cost=expected,
                           zero_exception=exception, validation_status='No-charge exception' if exception else 'Missing validation rate' if rate is None else 'Validation Sheet'))
    return result


def contract_validation_item(row, rates):
    """Map equivalent schedule items; never invent a charge for a blank/absent item."""
    name = str(row.get('name') or '')
    aliases = {
        'Active Rig Rate': 'UDR650 Active Rig Rate', 'Standby Rate': 'UDR650 Standby Rate',
        'Wet Weather Standby': 'UDR650 Standby Rate', 'Standby Wet Weat': 'UDR650 Standby Rate',
        'Mobilisation to site': 'Mobilisation', 'Demobilisation from site': 'Demobilisation',
        'Crew Travel On': 'Crew Travel (>0.5hrs)', 'Crew Travel Off': 'Crew Travel (>0.5hrs)',
        'Safety Prestart': 'Pre-Start', 'Repairs': 'Breakdowns', 'Truck Vacuum': 'Vac Truck',
        '4" PVC CL12': '4" PVC Casing PN12', '5" PVC': '5" PVC Casing PN9',
        'Accommodation': 'Accommodation - DEPCO Facility', 'Additional Supervisor': 'Additional Rig Supervisor',
    }
    target = aliases.get(name, name)
    if row.get('section') == 'Drilling Rates':
        base = name.replace(' /', '/').replace('/ ', '/').replace(' ', '')
        for item in rates.values():
            candidate = re.sub(r'(?<=\d)mm', '', item['name'].split(' (')[0].replace('Drilling', '')).replace(' ', '')
            # The legacy blade label starts at 90 mm, within the supplied 87â€“125 mm band.
            candidate = candidate.replace('Blade87-125', 'Blade90-125')
            depth = re.search(r'\((\d+)-(\d+)m\)', item['name'])
            if norm(candidate) == norm(base) and depth and [float(depth[1]),float(depth[2])] == [row.get('depth_from'),row.get('depth_to')]:
                return item
        return None
    if name == 'Backoe' and str(row.get('cost_code','')).endswith('_058'):
        target = 'Backhoe Hire'
    if name == 'Water Collect' and row.get('section') == 'Equipment':
        target = 'Water Truck Hire 18,000L'
    if row.get('section') == 'Time Activities' and row.get('charge') == 630.5:
        target = 'UDR650 Active Rig Rate'
    return rates.get(norm(target))


def hours(value):
    try:
        text = str(value or '')
        if ':' in text:
            h, m = text.split(':', 1)
            return float(h) + float(m) / 60
        return float(text)
    except ValueError:
        return None


def activity_family(row, claim=False):
    code = str(row.get('code') or row.get('description') or '').upper()
    if 'PCD' in code or 'HAMMER' in code or 'BLADE' in code:
        kind = next(k for k in ('PCD', 'HAMMER', 'BLADE') if k in code)
        size = re.search(r'(\d{2,3})\D+(\d{2,3})', code)
        return f'{kind}:{size[1]}:{size[2]}' if size else None
    if 'CORE' in code and ('HQ' in code or 'PQ' in code):
        return 'CORE:' + ('PQ' if 'PQ' in code else 'HQ')
    if 'CREW' in code and 'TRAVEL' in code:
        return 'TRAVEL'
    if 'PRE' in code and 'START' in code:
        return 'PRESTART'
    if 'MAINTENANCE' in code:
        return 'MAINTENANCE'
    if 'BREAKDOWN' in code or 'REPAIRS' in code:
        return 'REPAIRS'
    if 'STANDBY' in code:
        return 'STANDBY'
    if 'MOBILISATION' in code or 'DEMOBILISATION' in code:
        return 'DEMOB' if 'DEMOBILISATION' in code else 'MOB'
    if claim and 'ACTIVE RIG RATE' in code:
        return 'ACTIVE'
    if not claim and any(part in code for part in ('ACTIVE_RIG','CIRCULATION','CASING_INSTALL','CASING_RETRIEVAL','TRIPPING','CANGE_DRILL','RIG_CEMENTING','SETUP_PACKUP','MOB_DEMOB','CLEANOUT','REAMING')):
        return 'ACTIVE'
    if not claim and 'SAFETY_COMPANY' in code:
        return 'TOOLBOX'
    return norm(code) or None


def comment_key(row, claim=False):
    text = str(row.get('notes') or '').lower()
    if claim:
        parts = text.split(' | ')
        text = parts[1] if len(parts) > 1 and not parts[1].startswith('claim ') else ''
    return norm(text.rstrip('.'))


def same_quantity(c, e):
    expected = c.get('quantity')
    actual = e.get('total_metres') if c.get('total_metres') is not None else hours(e.get('total_time')) if c.get('total_time') else e.get('quantity')
    return actual is not None and expected is not None and abs(float(expected) - float(actual)) < .00001


def reconcile_activities(claim, eos):
    """Only unambiguous one-to-one candidates; no greedy or amount-only pairing."""
    remaining_c, remaining_e = set(range(len(claim))), set(range(len(eos)))
    pairs = []

    def compatible(c, e):
        if c['date_iso'] != e['date_iso'] or c['hole'] != e['hole']:
            return False
        cf, ef = activity_family(c, True), activity_family(e)
        if cf == 'ACTIVE' and ef == 'TOOLBOX' and 'toolbox' in comment_key(c, True):
            return True
        return bool(cf and cf == ef)

    def pair_pass(predicate, reason):
        candidates = {i: [j for j in remaining_e if compatible(claim[i], eos[j]) and predicate(claim[i], eos[j])] for i in remaining_c}
        reverse = defaultdict(list)
        for i, js in candidates.items():
            for j in js:
                reverse[j].append(i)
        unique = [(i, js[0]) for i, js in candidates.items() if len(js) == 1 and len(reverse[js[0]]) == 1]
        for i, j in unique:
            pairs.append((i, j, reason));remaining_c.remove(i);remaining_e.remove(j)

    pair_pass(lambda c, e: bool(comment_key(c, True)) and comment_key(c, True) == comment_key(e), 'Same date, hole, activity family and source description')
    pair_pass(lambda c, e: same_quantity(c, e) and (c.get('metres_from') is None or (c.get('metres_from') == e.get('metres_from') and c.get('metres_to') == e.get('metres_to'))), 'Unique activity with matching quantity / depth interval')
    pair_pass(lambda c, e: True, 'Only remaining activity in this family; verify the pairing')
    entries = []
    for i, j, reason in sorted(pairs):
        c, e = claim[i], eos[j]
        issues = []
        if reason.startswith('Only remaining') or (reason.startswith('Unique activity') and activity_family(c, True) in ('ACTIVE', 'STANDBY', 'TRAVEL')):
            issues.append('Confirm activity pairing')
        if not same_quantity(c, e):
            issues.append('Quantity differs')
        if c.get('total_metres') is not None and any(c.get(k) != e.get(k) for k in ('metres_from','metres_to')):
            issues.append('Depth interval differs')
        if c['zero_exception']:
            issues.append('Review preserved $0 exception')
        if c['expected_cost'] is None:
            issues.append('Validation Sheet rate missing')
        if e.get('line_cost') is None:
            issues.append('DrillOps amount unpriced')
        effective_rate = 0 if c['zero_exception'] else c['validation_rate']
        if effective_rate is not None and e.get('unit_rate') != effective_rate:
            issues.append('DrillOps rate differs from Validation Sheet')
        expected, recorded = c['expected_cost'], e.get('line_cost')
        cents = lambda value: Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        delta = None if expected is None or recorded is None else float(cents(expected) - cents(recorded))
        if delta not in (None, 0):
            issues.append('Amount differs')
        entries.append({'claim': c, 'eos': e, 'status': 'Matched' if not issues else 'Review', 'issues': issues, 'reason': reason, 'difference': delta})
    for i in sorted(remaining_c):
        entries.append({'claim': claim[i], 'eos': None, 'status': 'Unpaired claim', 'issues': ['Missing, split or ambiguous DrillOps activity'], 'reason': '', 'difference': None})
    for j in sorted(remaining_e):
        entries.append({'claim': None, 'eos': eos[j], 'status': 'Unpaired DrillOps', 'issues': ['Missing, split or ambiguous claim activity'], 'reason': '', 'difference': None})
    return entries
