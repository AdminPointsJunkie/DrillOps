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

# Match operational language, not dollar amounts or instructions inside a report.
DESCRIPTION_RULES = [
    ('Safety Prestart', r'\bpre[ -]?start\b'),
    ('Repairs', r'\b(?:repair\w*|breakdown)\b'),
    ('Maintenance', r'\b(?:maintenance|servicing)\b'),
    ('Safety Contractor', r'\b(?:depco|contractor|internal)\b.*\btoolbox\b'),
    ('Safety Company', r'\b(?:client|company|argo|mine)\b.*\btoolbox\b'),
    ('Training', r'\b(?:induction\w*|training)\b'),
    ('Inspections', r'\b(?:client|company)\b.*\binspection\w*\b'),
    ('Casing Install', r'\b(?:install\w*|run(?:ning)?|lower\w*)\s+(?:\w+\s+){0,2}casing\b|\bcasing installation\b'),
    ('Casing Retrieval', r'\b(?:pull\w*|retriev\w*|remov\w*|extract\w*)\s+(?:\w+\s+){0,2}casing\b'),
    ('Tripping Rods', r'\b(?:tripp?\w*|pull\w*)\b.*\brods?\b|\btrip (?:in|out)\b'),
    ('Rig Cementing', r'\b(?:cementing|grouting|cement (?:the )?hole)\b'),
    ('Setup Packup Site', r'\b(?:set[ -]?up|pack[ -]?up|rig[ -]?(?:up|down))\b'),
    ('Mob Demob site to site', r'\b(?:site move|move (?:to|between) (?:the |next |new )?(?:pad|site)|relocat\w*)\b'),
    ('Reaming', r'\bream(?:ing)?\b'),
    ('Cleanouts', r'\b(?:clean[ -]?out\w*|clean(?:ing)? (?:the )?(?:hole|borehole))\b'),
    ('Circulation Flus', r'\bflush\w*\b'),
    ('Circulation Lost', r'\b(?:lost circulation|regain\w* circulation)\b'),
    ('Mud Mixing', r'\b(?:mix\w* (?:drilling )?(?:mud|fluids?)|mud mixing)\b'),
    ('Standby Logger', r'\b(?:wait\w*|stand[ -]?by)\b.*\b(?:for (?:the )?)?logger\b'),
    ('Standby Logging', r'\b(?:wait\w*|stand[ -]?by)\b.*\blogging\b'),
    ('Standby Water', r'\b(?:wait\w*|stand[ -]?by)\b.*\bwater\b'),
    ('Standby Wet Weat', r'\b(?:wet weather|rain delay|standby.*rain|wait.*rain)\b'),
    ('Standby Blasting', r'\b(?:blast\w* delay|standby.*blast|wait.*blast)\b'),
    ('Standby AAC', r'\b(?:client|company|argo)\s+(?:instruct\w*|delay|stand[ -]?by)|\bstand[ -]?by.*\b(?:client|company|argo)\b'),
    ('Crew Travel On', r'\b(?:on[ -]lease travel|travel.*(?:gate to (?:rig|site|pad)|on (?:company )?lease))\b'),
    ('Crew Travel Off', r'\b(?:off[ -]lease travel|travel.*(?:accommodation|camp|off (?:company )?lease))\b'),
]


def _diameter_mm(text, default_unit='mm'):
    match = re.fullmatch(r'\s*(\d+(?:\.\d+)?(?:\s+\d+/\d+)?|\d+/\d+)\s*(mm|inches|inch|in|["″])?\s*', str(text or ''), re.I)
    if not match:
        return None
    parts = match[1].split()
    try:
        value = sum(float(p.split('/')[0])/float(p.split('/')[1]) if '/' in p else float(p) for p in parts)
    except (ValueError, ZeroDivisionError):
        return None
    unit = (match[2] or ('inch' if '/' in match[1] else default_unit)).lower()
    return value if unit == 'mm' else value*25.4


def _drilling_candidates(row, lines, text):
    bit_text = (str(row.get('bit_type') or '')+' '+text).lower()
    core = re.findall(r'\b(hq3?|pq3?)\b', bit_text)
    bit = 'Core' if core else 'PCD' if re.search(r'\bpcd\b',bit_text) else 'Hammer' if re.search(r'\b(?:hammer|dth)\b',bit_text) else 'Blade' if re.search(r'\bblade\b',bit_text) else None
    kinds=sum(bool(re.search(pattern,bit_text)) for pattern in (r'\b(?:hq3?|pq3?)\b',r'\bpcd\b',r'\b(?:hammer|dth)\b',r'\bblade\b'))
    if kinds > 1:
        return [], 'multiple drilling types on one line; select a code or split the interval'
    diameter = _diameter_mm(row.get('diameter'))
    if diameter is None:
        explicit = re.findall(r'\b(\d+(?:\.\d+)?(?:\s+\d+/\d+)?\s*(?:mm|inches|inch|["″]))',bit_text)
        if not explicit:
            explicit = re.findall(r'\b(\d+\s+\d+/\d+)\s*(?=pcd|hammer|blade)',bit_text)
        measured = {_diameter_mm(v) for v in explicit}
        measured.discard(None)
        if len(measured)==1: diameter=measured.pop()
    if not bit or (not core and diameter is None):
        return [], 'drilling needs an explicit bit type and hole diameter (or HQ/PQ core size)'
    candidates=[]
    for rate in lines:
        if rate.get('section') != 'Drilling Rates' or rate.get('status') == 'Inactive': continue
        meta=BY_CODE.get(rate.get('cost_code'),{})
        name=rate.get('name') or ''
        if core:
            sizes={c[:2].upper() for c in core}
            matches=any(re.search(r'\b'+size+r'(?:3)?\b',name,re.I) for size in sizes)
        elif meta.get('bit'):
            size=meta.get('size','')
            bounds=re.findall(r'\d+(?:\.\d+)?',size)
            factor=25.4 if 'inch' in size else 1
            matches=(meta['bit']==bit and len(bounds)==2 and float(bounds[0])*factor <= diameter <= float(bounds[1])*factor)
        elif bit=='PCD' and 'PCD' in name:
            size=name.split('PCD')[0].strip()
            bounds=re.split(r'[–—]',size)
            values=[_diameter_mm(v, 'inch') for v in bounds]
            matches=bool(values and all(v is not None for v in values) and min(values)-.05 <= diameter <= max(values)+.05)
            if 'in-seam' in name.lower(): matches=matches and bool(re.search(r'in[ -]?seam',text))
        else: matches=False
        if matches: candidates.append(rate)
    # A drilling size may contain several depth bands. Choose the starting band;
    # the pricing engine still checks and splits the complete interval.
    groups={}
    for rate in candidates: groups.setdefault(rate['name'],[]).append(rate)
    selected=[]
    start=number(row.get('metres_from'))
    for group in groups.values():
        group.sort(key=lambda r:number(r.get('depth_from')) or 0)
        selected.append(next((r for r in group if start is not None and number(r.get('depth_from')) is not None and number(r.get('depth_to')) is not None and float(r['depth_from'])<=start<float(r['depth_to'])),group[0]))
    return selected, 'matched drilling type and diameter/core size' if selected else 'no contract drilling rate matches the reported type and size'


def suggest_depco_activity(row, lines):
    """Suggest only codes present in the selected contract, then price independently."""
    row=dict(row)
    code=str(row.get('code') or '').strip()
    if code and any(r.get('cost_code')==code for r in lines or []):
        return price_depco_activity(row,lines)
    if not lines:
        return price_depco_activity(row,lines)
    if code.startswith('DEPCO_'):
        return {**price_depco_activity(row,lines),'rate_basis':'DEPCO review required: the selected code is not in this project contract'}
    text=str(row.get('notes') or row.get('comments') or '').lower().strip()
    candidates=[];reason='matched the reported activity'
    metres=number(row.get('total_metres'))
    if metres is not None and metres > 0:
        if any(re.search(pattern,text,re.I) for _,pattern in DESCRIPTION_RULES):
            return {**price_depco_activity({**row,'code':''},lines),'rate_basis':'DEPCO review required: metres and a separate time activity appear on this line; confirm or split the activities'}
        candidates,reason=_drilling_candidates(row,lines,text)
    else:
        # Negative or combined narratives must not become a charge on keyword overlap.
        if re.search(r'\b(?:no|not|without|cancelled)\b',text):
            return {**price_depco_activity({**row,'code':''},lines),'rate_basis':'DEPCO review required: confirm the activity described by this qualified or negative statement'}
        names={name for name,pattern in DESCRIPTION_RULES if re.search(pattern,text,re.I)}
        # SIS has a different naming system. Use only equivalent, specific activities.
        equivalents={'Mob Demob site to site':'Site move on site'}
        for rate in lines:
            if rate.get('status') == 'Inactive': continue
            name=rate.get('name','')
            label=LEGACY.get(code,code)
            exact=bool(label and norm(label) in {norm(name),*[norm(a) for a in BY_CODE.get(rate.get('cost_code'),{}).get('aliases',[])]})
            if names and code in ('H_Active','H_Inactive'):
                exact=False
            description_exact=bool(text and norm(text)==norm(name))
            if name in names or any(equivalents.get(n)==name for n in names) or exact or description_exact:
                candidates.append(rate)
    # Do not discard a conditional or missing-price candidate to manufacture a match.
    unique={r['cost_code']:r for r in candidates}
    if len(unique)!=1:
        labels=', '.join(dict.fromkeys(r['name'] for r in candidates))
        message=('multiple activities match: '+labels+'; select a code or split the line') if candidates else reason if metres and metres>0 else 'no reliable contract-code match; choose a code'
        return {**price_depco_activity({**row,'code':''},lines),'rate_basis':'DEPCO review required: '+message}
    rate=next(iter(unique.values()))
    priced=price_depco_activity({**row,'code':rate['cost_code']},lines)
    return {**priced,'code':rate['cost_code'], 'rate_basis':f"DEPCO suggested: {rate['name']} ({reason}). "+str(priced.get('rate_basis') or '')}


def suggest_depco_rows(cur, rows, contractor):
    if contractor != 'DEPCO Drilling': return rows
    cache={}
    output=[]
    for row in rows:
        key=(row.get('project') or '',row.get('program') or '')
        if key not in cache: cache[key]=contract_rates(cur,contractor,*key)
        output.append({**row,**suggest_depco_activity(row,cache[key])})
    return output


def preview_depco_ocr(cur, data, contractor, project, program):
    """Recompute preview prices from current text; never trust posted prices."""
    lines=contract_rates(cur,contractor,project,program) or []
    activities=[]
    for activity in data.get('activities',[]):
        row={**activity,'notes':activity.get('comments'),'date':data.get('date'),
             'project':project,'program':program}
        priced=suggest_depco_activity(row,lines)
        activities.append({**activity,'pricing':priced})
    return {**data,'activities':activities},lines


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
