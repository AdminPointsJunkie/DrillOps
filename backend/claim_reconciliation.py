"""Accounts-only saved claim comparison. Never posts or reprices operational costs."""

from collections import defaultdict
from contextlib import contextmanager
from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
from pathlib import PurePosixPath
import re

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from business_platform import current_business_scope
from depco_exploration import parse_depco_exploration_xlsx
from depco_validation import validation_rates, apply_validation, reconcile_activities


FILE_TYPE = 'depco_claim_reconciliation'
CONTRACTOR = 'DEPCO Drilling'


def as_date(value):
    for fmt in ('%d/%m/%Y', '%Y-%m-%d'):
        try:
            return datetime.strptime(str(value), fmt).date()
        except ValueError:
            pass
    raise ValueError(f'Invalid activity date: {value}')


def decimal(value):
    return Decimal(str(value)) if value is not None else Decimal(0)


def money(value):
    return float(decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


def hole_key(value):
    text = str(value or '').strip().upper()
    return '' if text in ('', 'NA', 'N/A', 'NONE', '0', '-') else text


def compare_claim(header, claim, live, consumables=()):
    dates = [as_date(row['date']) for row in claim]
    start = as_date(header['period_start']) if header.get('period_start') else min(dates)
    end = as_date(header['period_end']) if header.get('period_end') else max(dates)
    if end < start:
        raise ValueError('The claim period end precedes its start')
    claim_rows, outside, eos_rows = [], [], []
    for row in apply_validation(claim, header.get('validation_rates', {})):
        copied = dict(row, date_iso=as_date(row['date']).isoformat(), hole=hole_key(row.get('hole_num')),
                      description=row.get('code') or '', source_kind='claim')
        (claim_rows if start <= as_date(row['date']) <= end else outside).append(copied)
    for source, kind in ((live, 'activity'), (consumables, 'consumable')):
        for row in source:
            if not start <= as_date(row['date']) <= end:
                continue
            allocation = decimal(row.get('allocation_percent') if row.get('allocation_percent') is not None else 100) / 100
            cost = None if row.get('line_cost') is None else float(decimal(row['line_cost']) * allocation)
            eos_rows.append(dict(row, line_cost=cost, date_iso=as_date(row['date']).isoformat(),
                                hole=hole_key(row.get('hole_num')), description=row.get('code') or row.get('consumable') or '',
                                source_kind=kind))

    def rollup(key):
        groups = {}
        for side, rows in (('claim', claim_rows), ('eos', eos_rows)):
            for row in rows:
                value = row[key]
                group = groups.setdefault(value, {'key': value, 'claim_rows': [], 'eos_rows': []})
                group[side + '_rows'].append(row)
        result = []
        for value, group in sorted(groups.items()):
            c, e = group['claim_rows'], group['eos_rows']
            ca = sum((decimal(r['line_cost']) for r in c), Decimal(0))
            ea = sum((decimal(r['line_cost']) for r in e), Decimal(0))
            unpriced = sum(r['line_cost'] is None for r in e)
            expected = sum((decimal(r['expected_cost']) for r in c), Decimal(0))
            missing_rates = sum(r['expected_cost'] is None for r in c)
            status = ('Only DrillOps' if not c else 'Only claim' if not e else
                      'Incomplete' if unpriced or missing_rates else 'Difference' if money(expected) != money(ea) else 'Matched')
            result.append({**group, 'claim': money(ca), 'eos': money(ea), 'difference': money(ca - ea),
                           'expected': money(expected) if not missing_rates else None, 'expected_priced': money(expected), 'missing_rates': missing_rates,
                           'claim_count': len(c), 'eos_count': len(e), 'unpriced': unpriced, 'status': status,
                           'campaigns': sorted({str(r.get('campaign_name') or r.get('project') or '') for r in e} - {''})})
        return result

    ca = sum((decimal(r['line_cost']) for r in claim_rows), Decimal(0))
    ea = sum((decimal(r['line_cost']) for r in eos_rows), Decimal(0))
    outside_cost = sum((decimal(r['line_cost']) for r in outside), Decimal(0))
    unpriced = [r for r in eos_rows if r['line_cost'] is None]
    included = [r for r in eos_rows if r['line_cost'] == 0 and 'flat fee' in str(r.get('rate_basis') or '').lower()]
    warnings = list(header.get('warnings', []))
    if unpriced:
        warnings.append({'severity': 'warning', 'issue': f'{len(unpriced)} DrillOps lines are unpriced. The recorded amount is incomplete; the difference is not an overcharge determination.'})
    if included:
        warnings.append({'severity': 'warning', 'issue': f'{len(included)} DrillOps lines are explicitly included in an onboarding flat fee. Review claim charges against that decision.'})
    missing_rates = sum(r['expected_cost'] is None for r in claim_rows)
    exceptions = sum(r['zero_exception'] for r in claim_rows)
    if missing_rates:
        warnings.append({'severity': 'warning', 'issue': f'{missing_rates} claim lines have no numeric Validation Sheet rate. Expected charges are incomplete; the submitted amounts are shown separately.'})
    if exceptions:
        warnings.append({'severity': 'warning', 'issue': f'{exceptions} explicit $0 claim exceptions are preserved despite a positive Validation Sheet rate and require review.'})
    claim_holes = {r['hole'] for r in claim_rows} - {''}
    live_holes = {r['hole'] for r in eos_rows} - {''}
    for hole in sorted(claim_holes - live_holes):
        possible = sorted(h for h in live_holes if re.sub(r'^[A-Z]+', '', h) == re.sub(r'^[A-Z]+', '', hole))
        warnings.append({'severity': 'warning', 'issue': f'Claim hole {hole} has no exact DrillOps match.' + (f' Check against {", ".join(possible)}; identifiers have not been merged.' if possible else '')})
    daily, holes = rollup('date_iso'), rollup('hole')
    activity_pairs = reconcile_activities(claim_rows, eos_rows)
    for day in daily:
        day['activity_pairs'] = [pair for pair in activity_pairs if (pair['claim'] or pair['eos'])['date_iso'] == day['key']]
        day['matched_activities'] = sum(p['status'] == 'Matched' for p in day['activity_pairs'])
        day['review_activities'] = len(day['activity_pairs']) - day['matched_activities']
        day['daily_total_matches'] = day['status'] == 'Matched'
        if day['status'] == 'Matched' and day['review_activities']:
            day['status'] = 'Activity review'
    return {
        'period_start': start.isoformat(), 'period_end': end.isoformat(),
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'reconciled': bool(daily) and all(r['status'] == 'Matched' for r in daily) and not outside and not warnings,
        'totals': {'claim_total': money(ca + outside_cost), 'claim_in_period': money(ca),
                   'outside_period': money(outside_cost), 'eos_priced': money(ea), 'difference': money(ca - ea),
                   'claim_lines': len(claim_rows), 'eos_lines': len(eos_rows), 'unpriced_lines': len(unpriced),
                   'outside_lines': len(outside), 'matched_days': sum(r['status'] == 'Matched' for r in daily),
                   'expected_priced': money(sum((decimal(r['expected_cost']) for r in claim_rows), Decimal(0))),
                   'validation_missing': missing_rates, 'zero_exceptions': exceptions,
                   'activity_pairs': len(activity_pairs), 'matched_activities': sum(p['status'] == 'Matched' for p in activity_pairs),
                   'review_activities': sum(p['status'] != 'Matched' for p in activity_pairs),
                   'review_days': sum(r['status'] != 'Matched' for r in daily)},
        'daily': daily, 'holes': [{k: v for k, v in row.items() if k not in ('claim_rows', 'eos_rows')} for row in holes],
        'outside_rows': outside, 'warnings': warnings,
        'validation_rates': list(header.get('validation_rates', {}).values()),
        'campaigns': sorted({str(r.get('campaign_name') or r.get('project') or '') for r in eos_rows} - {''}),
    }


@contextmanager
def project_report_scope(write=False):
    """A multi-campaign source requires project access, never just one campaign share."""
    scope = current_business_scope.get()
    if scope is None:
        raise HTTPException(403, 'A company workspace is required')
    grants = scope.write_projects if write else scope.read_projects
    if scope.project_id and not (scope.admin or scope.project_id in grants):
        raise HTTPException(403, 'Full project access is required for a claim spanning multiple campaigns')
    if not scope.project_id and (write or not (scope.admin or grants)):
        raise HTTPException(409, 'Choose the Exploration project before saving or opening a claim report')
    token = current_business_scope.set(replace(scope, campaign_id=''))
    try:
        yield current_business_scope.get()
    finally:
        current_business_scope.reset(token)


def create_claim_reconciliation_router(get_conn):
    router = APIRouter(prefix='/reconciliation/depco-claims', tags=['Accounts reconciliation'])

    def source(cur, claim_id):
        cur.execute('SELECT id,filename,pdf_data,business_project_id,imported_at FROM source_files WHERE id=%s AND file_type=%s AND contractor=%s',
                    (claim_id, FILE_TYPE, CONTRACTOR))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, 'Claim report not found in this workspace/project')
        return row

    @router.get('')
    def list_claims():
        with project_report_scope() as scope, get_conn(read_only=True) as conn:
            with conn.cursor() as cur:
                cur.execute('''SELECT s.id,s.filename,s.imported_at,p.name project FROM source_files s
                    JOIN business_projects p ON p.id=s.business_project_id AND p.workspace_id=s.workspace_id
                    WHERE s.file_type=%s AND s.contractor=%s ORDER BY s.imported_at DESC,s.id DESC''', (FILE_TYPE, CONTRACTOR))
                return {'claims': [dict(r, filename=PurePosixPath(r['filename']).name) for r in cur.fetchall()],
                        'can_save': bool(scope.project_id and (scope.admin or scope.project_id in scope.write_projects))}

    @router.post('')
    async def save_claim(file: UploadFile = File(...)):
        filename = re.split(r'[\\/]', file.filename or '')[-1]
        if not filename.lower().endswith('.xlsx'):
            raise HTTPException(400, 'Choose a Depco Exploration claim XLSX workbook')
        content = await file.read(8 * 1024 * 1024 + 1)
        if not content or len(content) > 8 * 1024 * 1024:
            raise HTTPException(400, 'The workbook must be between 1 byte and 8 MB')
        try:
            parse_depco_exploration_xlsx(content, filename)
            validation_rates(content)
        except Exception as exc:
            raise HTTPException(400, f'Could not read claim: {exc}') from exc
        with project_report_scope(write=True) as scope, get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT name FROM business_projects WHERE id=%s AND workspace_id=%s', (scope.project_id, scope.workspace_id))
                project = cur.fetchone()
                if not project or project['name'].strip().lower() != 'exploration':
                    raise HTTPException(400, 'Choose the Exploration project for this claim')
                stored_name = f'reconciliation/{scope.project_id}/{sha256(content).hexdigest()[:20]}/{filename}'
                cur.execute('''INSERT INTO source_files(filename,contractor,file_type,pdf_data)
                    VALUES(%s,%s,%s,%s) ON CONFLICT(workspace_id,filename,contractor) DO NOTHING RETURNING id''',
                    (stored_name, CONTRACTOR, FILE_TYPE, content))
                saved = cur.fetchone()
                if not saved:
                    cur.execute('SELECT id FROM source_files WHERE filename=%s AND contractor=%s AND file_type=%s', (stored_name, CONTRACTOR, FILE_TYPE))
                    saved = cur.fetchone()
                if not saved:
                    raise HTTPException(409, 'The claim could not be saved in the selected project')
                return {'id': saved['id'], 'filename': filename}

    @router.get('/{claim_id}')
    def report(claim_id: int):
        with project_report_scope(), get_conn(read_only=True) as conn:
            with conn.cursor() as cur:
                saved = source(cur, claim_id)
                filename = PurePosixPath(saved['filename']).name
                header, claim, *_ = parse_depco_exploration_xlsx(bytes(saved['pdf_data']), filename)
                header['validation_rates'] = validation_rates(bytes(saved['pdf_data']))
                dates = [as_date(r['date']) for r in claim]
                start = header.get('period_start') or min(dates).isoformat()
                end = header.get('period_end') or max(dates).isoformat()
                # Fetch only this source's business project, even at workspace-wide scope.
                cur.execute('''SELECT a.id,a.source_file,a.date,a.hole_num,a.project,a.drill_rig,a.code,a.notes,
                    a.total_time,a.metres_from,a.metres_to,a.total_metres,a.quantity,a.unit_rate,a.line_cost,a.rate_basis,a.allocation_percent,
                    c.name campaign_name FROM activities a LEFT JOIN business_campaigns c ON c.id=a.campaign_id AND c.workspace_id=a.workspace_id
                    WHERE a.contractor=%s AND a.business_project_id=%s AND a.program='Exploration' AND a.drill_rig=ANY(%s)
                    AND to_date(a.date,'DD/MM/YYYY') BETWEEN %s::date AND %s::date ORDER BY to_date(a.date,'DD/MM/YYYY'),a.id''',
                    (CONTRACTOR, saved['business_project_id'], sorted({r['drill_rig'] for r in claim}), start, end))
                live = [dict(r) for r in cur.fetchall()]
                cur.execute('''SELECT x.id,x.source_file,x.date,x.hole_num,x.consumable,x.quantity,x.unit_price AS unit_rate,
                    x.line_cost,c.name campaign_name FROM consumables x
                    LEFT JOIN business_campaigns c ON c.id=x.campaign_id AND c.workspace_id=x.workspace_id
                    WHERE x.contractor=%s AND x.business_project_id=%s
                    AND to_date(x.date,'DD/MM/YYYY') BETWEEN %s::date AND %s::date
                    AND EXISTS(SELECT 1 FROM activities a WHERE a.workspace_id=x.workspace_id AND a.source_file=x.source_file
                        AND a.contractor=x.contractor AND a.business_project_id=x.business_project_id AND a.drill_rig=ANY(%s))''',
                    (CONTRACTOR, saved['business_project_id'], start, end, sorted({r['drill_rig'] for r in claim})))
                consumables = [dict(r) for r in cur.fetchall()]
                cur.execute('SELECT name FROM business_projects WHERE id=%s', (saved['business_project_id'],))
                project = cur.fetchone()
        result = compare_claim(header, claim, live, consumables)
        return dict(result, id=claim_id, filename=filename, contractor=CONTRACTOR,
                    project=project['name'] if project else 'Exploration', scope_label='All campaigns in this project')

    @router.get('/{claim_id}/source')
    def download(claim_id: int):
        with project_report_scope(), get_conn(read_only=True) as conn:
            with conn.cursor() as cur:
                saved = source(cur, claim_id)
        return Response(bytes(saved['pdf_data']), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        headers={'Content-Disposition': 'attachment; filename="depco-claim.xlsx"'})

    return router
