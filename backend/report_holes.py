"""Keep row-level hole identity and source completion notes through OCR review."""
import re
from datetime import datetime, timedelta, timezone


def format_gas_riser_ocr_holes(data, project, program):
    if str(program or '').strip().lower() != 'gas riser':
        return
    places = {'ironbark': 'IBGR-', 'carborough downs': 'GR-'}
    prefix = places.get(str(project or '').strip().lower())
    if not prefix:
        return
    for row in [data, *(data.get('activities') or [])]:
        value = row.get('hole_num')
        if not isinstance(value, str):
            continue
        match = re.fullmatch(r'(?:(IB|CD)[ _-]*)?GR[ _-]*([0-9]+)', value.strip(), re.I)
        if not match:
            continue
        supplied_site = (match[1] or '').upper()
        if supplied_site and supplied_site != ('IB' if prefix == 'IBGR-' else 'CD'):
            continue
        row['hole_num'] = prefix + match[2].zfill(2)


def ironbark_ocr_rules(data, project, filename='', today=None):
    """Validate current Ironbark imports without guessing hole identities or dates."""
    if str(project or '').strip().lower() != 'ironbark':
        return []
    data['client'] = 'Argo'
    today = today or datetime.now(timezone(timedelta(hours=10))).date()
    warnings = []
    def warn(issue, blocking=True):
        warnings.append({'issue': issue, 'blocking': blocking, 'recommendation':
                         'Check the source PDF and correct the review fields before importing.' if blocking else
                         'Check the date against the source PDF. If correct, you can still import this report.'})
    parsed = None
    for fmt in ('%d/%m/%Y', '%Y-%m-%d'):
        try:
            parsed = datetime.strptime(str(data.get('date') or ''), fmt).date()
            break
        except ValueError:
            pass
    if parsed is None:
        warn('Enter a valid Ironbark report date.')
    elif not 0 <= (today - parsed).days <= 14:
        warn('Report date is outside the usual last 14 days (Brisbane time). Please check it.', blocking=False)
    match = re.search(r'(?<!\d)(20\d{6})(?!\d)', str(filename))
    if match and parsed:
        try:
            expected = datetime.strptime(match[1], '%Y%m%d').date()
            if expected != parsed:
                warn('Report date conflicts with filename date ' + expected.strftime('%d/%m/%Y') + '.')
        except ValueError:
            pass
    for i, row in enumerate(data.get('activities') or [], 1):
        hole = ocr_activity_hole(row, data).upper().strip()
        if hole and not hole.startswith('IB'):
            warn(f'Activity {i}: Ironbark hole {hole} must begin with IB.')
        bit = str(row.get('bit_type') or '')
        if hole and re.search(r'\b(core|coring|[HNP]Q3?)\b', bit, re.I) and not hole.endswith('C'):
            warn(f'Activity {i}: core hole {hole} must end with C.')
    return warnings


def single_hole(value):
    value = str(value or '').strip()
    if not value or re.fullmatch(r'n/?a|none|unknown|not recorded|-+', value, re.I):
        return ''
    if re.search(r'[,;/&\n]|\s+(?:and|to)\s+', value, re.I):
        return ''
    return value


def ocr_activity_hole(activity, header):
    # An explicitly blank row means unknown; do not replace it with the last
    # hole named in a multi-hole report. Older clients can still use one header.
    if 'hole_num' in activity:
        return single_hole(activity.get('hole_num'))
    return single_hole(header.get('hole_num'))


def ocr_activity_notes(activity):
    comments = str(activity.get('comments') or '').strip()
    evidence = str(activity.get('completion_note') or '').strip()
    return comments + ('\nSource completion note: ' + evidence if evidence else '')


def ocr_hole_warnings(data):
    activities = data.get('activities') or []
    missing = [i + 1 for i, row in enumerate(activities)
               if not ocr_activity_hole(row, data)
               and (row.get('total_metres') or re.search(r'cement|grout|eoh|complet', str(row.get('comments') or ''), re.I))]
    if not missing:
        return []
    return [{'issue': 'Hole is unconfirmed for activity row(s): ' + ', '.join(map(str, missing)),
             'recommendation': 'Check each activity against the source PDF. A report can finish one hole and start another; leave genuinely unknown holes blank.'}]
