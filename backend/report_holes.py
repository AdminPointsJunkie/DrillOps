"""Keep row-level hole identity and source completion notes through OCR review."""
import re


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
