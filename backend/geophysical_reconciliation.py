"""Reviewed geophysical hole identities; original activity and PDF data stay unchanged."""
import re

ARGO = 'a7ecd88b-8ba9-4c5f-80c8-872fcc50f34f'
IRONBARK = 'affc2d28-31bd-492a-8895-e3c25bf0291c'
BCC = '4e74d217-c2cf-43aa-b9d3-9eecea69831a'
# Deliberately limited to the reviewed source bundles, not fuzzy hole-name guesses.
REVIEWED = {
    ('GDB 2026.08_Individual Sheets.pdf', 'IN-666C'): ('IB666C', '22 Aug: 249.4 m source depth and Mitchells logger-over-hole entry for IB666C.'),
    ('CJS 2026.08_Individual Sheets.pdf', 'IB688C'): ('IB668C', '31 Aug: site 26-026, 264.5 m logging depth and drilling register / logger entry for IB668C.'),
    ('CJS 2026.09_Individual Sheets.pdf', 'IB688C'): ('IB668C', '1 Sep continuation of CJS08310800 at site 26-026; Mitchells records logging IB668C on both dates.'),
    ('CJS 2026.09_Individual Sheets.pdf', 'IB699C'): ('IB669C', '11 Sep: 294.4 m driller depth and 293.8 m logger TD match the 10 Sep IB669C ticket; Mitchells records logging IB669C on 10–11 Sep. Printed site 26-026 conflicts and is retained for review.'),
}


def scope(row):
    return (str(row.get('workspace_id') or ''), str(row.get('campaign_id') or (str(row.get('program') or '') + '|' + str(row.get('project') or ''))))


def identity(row, name):
    value = re.sub(r'[^A-Z0-9]', '', str(name or '').upper())
    if str(row.get('workspace_id')) == ARGO and str(row.get('campaign_id')) == BCC:
        match = re.fullmatch(r'ESP(?:GN|NG)0*(\d+)', value)
        if match:
            return 'ESPNG' + str(int(match[1])).zfill(2)
    return value


def reconcile_rows(logging, drilling, register):
    """Only link within the same authorised workspace and campaign.

    Actual positive-metre drilling rows are the comparison population. Planning
    records supply preferred labels, not extra drilled holes. Letter suffixes are
    significant, so a redrill such as BL26-005A is never merged with BL26-005.
    """
    names = {}
    for row in drilling:
        name = str(row.get('hole_num') or '').strip()
        if name:
            names.setdefault((scope(row), identity(row, name)), name)
    for row in register:
        name = str(row.get('hole_id') or '').strip()
        key = (scope(row), identity(row, name))
        if name:
            names[key] = name

    def annotate(row, is_logging):
        result = dict(row)
        original = str(row.get('hole_num') or '').strip()
        candidate, reason = original, ''
        if (is_logging and row.get('contractor') == 'Weatherfords'
                and str(row.get('workspace_id')) == ARGO and str(row.get('campaign_id')) == IRONBARK):
            candidate, reason = REVIEWED.get((row.get('source_file'), original), (original, ''))
        matched = names.get((scope(row), identity(row, candidate)))
        result['source_hole_num'] = original
        result['canonical_hole_num'] = matched or original
        result['hole_match_status'] = ('reviewed_alias' if reason else 'matched') if matched else 'unmatched'
        result['hole_match_reason'] = reason if matched else ''
        if matched and original != matched and not reason:
            result['hole_match_reason'] = 'Register spelling / formatting variant within the same campaign.'
        return result

    return [annotate(r, True) for r in logging], [annotate(r, False) for r in drilling]


def read_reconciliation(cur, contractor):
    """Use the caller's scoped connection/RLS; never open a privileged connection."""
    fields = 'id,workspace_id,business_project_id,campaign_id,project,program,contractor,hole_num,date,total_metres,source_file'
    cur.execute(f'''SELECT {fields} FROM activities a
        WHERE total_metres > 0 AND EXISTS (
            SELECT 1 FROM contractors c WHERE c.name=a.contractor
              AND c.workspace_id=a.workspace_id AND c.category='Drilling')
        ORDER BY a.id''')
    drilling = [dict(r) for r in cur.fetchall()]
    cur.execute('''SELECT workspace_id,campaign_id,project,program,hole_id,site_id,status
        FROM boreholes ORDER BY id''')
    register = [dict(r) for r in cur.fetchall()]
    cur.execute('SELECT * FROM activities WHERE contractor=%s ORDER BY id', (contractor,))
    logging = [dict(r) for r in cur.fetchall()]
    logging, drilling = reconcile_rows(logging, drilling, register)
    return {'activities': logging, 'drilling_reference': drilling, 'version': 'hole-reconciliation-2026-11-20'}
