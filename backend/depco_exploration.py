"""Read DEPCO Package A claim workbooks without repricing source charges."""

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
import re

from openpyxl import load_workbook


SOURCE_BASIS = "DEPCO Exploration claim XLSX"
HEADERS = ('Claim', 'Date', 'DAR #', 'Driller', 'Hole#', 'Activity Charge',
           'Rate', 'Start Metre', 'Finish Metre', 'Total Charge', 'Unit',
           'Line Total', 'Day Total', 'Comment')


def _number(value, label, optional=False):
    if optional and value in (None, ''):
        return None
    try:
        result = Decimal(str(value))
        if not result.is_finite():
            raise InvalidOperation
        return result
    except (InvalidOperation, ValueError):
        raise ValueError(f'{label}: missing or invalid number; recalculate and save the workbook in Excel') from None


def parse_depco_exploration_xlsx(content, filename):
    workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
    activities, warnings, crews, periods = [], [], {}, []
    try:
        for sheet in workbook:
            if not re.fullmatch(r'DR\s*\d+', sheet.title, re.I):
                continue
            rows = list(sheet.iter_rows(values_only=True))
            header_index = next((i for i, row in enumerate(rows[:30])
                                 if tuple(str(v or '').strip() for v in row[:14]) == HEADERS), None)
            if header_index is None:
                continue
            context = ' '.join(str(v or '') for row in rows[:header_index] for v in row)
            if not re.search(r'PACKAGE\s+A\b.*EXPLORATION', context, re.I):
                raise ValueError(f'{sheet.title}: expected Package A Exploration Drilling')
            po = re.search(r'\bPO\s+([A-Z0-9-]+)', context, re.I)
            bounds = {}
            for row in rows[:header_index]:
                for position, value in enumerate(row[:-1]):
                    label = str(value or '').strip().rstrip(':').lower()
                    if label in ('date from', 'date to') and isinstance(row[position + 1], (date, datetime)):
                        bounds[label] = row[position + 1].strftime('%Y-%m-%d')
            outside_period = set()
            if bounds.get('date from') and bounds.get('date to'):
                periods.append((bounds['date from'], bounds['date to']))
            totals, checks, dar_numbers = defaultdict(Decimal), defaultdict(Decimal), defaultdict(set)
            rig = re.sub(r'\s+', '', sheet.title).upper()
            for index, raw in enumerate(rows[header_index + 1:], header_index + 2):
                r = list(raw[:14]) + [None] * max(0, 14 - len(raw))
                claim, day, dar, driller, hole, activity, rate, start, end, quantity, unit, cost, day_total, comment = r
                # Ignore unused formula-filled template rows and the workbook grand total.
                if not any(v not in (None, '') for v in r[:6]):
                    continue
                where = f'{sheet.title}!{index}'
                if not isinstance(day, (date, datetime)):
                    raise ValueError(f'{where}: activity date is missing or invalid')
                if not activity or not dar:
                    raise ValueError(f'{where}: activity and DAR number are required')
                report_date = day.strftime('%d/%m/%Y')
                iso_date = day.strftime('%Y-%m-%d')
                if (bounds.get('date from') and iso_date < bounds['date from']) or (bounds.get('date to') and iso_date > bounds['date to']):
                    outside_period.add(report_date)
                key = report_date
                dar_numbers[key].add(str(dar))
                activity = str(activity).strip()
                if activity.lower() == 'shift total':
                    checks[key] += _number(day_total, where + ' Day Total')
                    continue
                if activity.lower() == 'end of hole':
                    warnings.append({'severity': 'warning', 'issue': f'{where}: End of Hole marker needs review in the production report; completion was not changed.'})
                    continue
                rate = _number(rate, where + ' Rate')
                quantity = _number(quantity, where + ' Total Charge')
                cost = _number(cost, where + ' Line Total')
                start = _number(start, where + ' Start Metre', True)
                end = _number(end, where + ' Finish Metre', True)
                unit = str(unit or '').strip().lower()
                if unit not in ('p/hr', 'p/m', 'each', 'l/sum', 'l.sum', 'p/6m length'):
                    raise ValueError(f'{where}: unsupported unit {unit!r}')
                if abs(rate * quantity - cost) > Decimal('0.02'):
                    raise ValueError(f'{where}: quantity × rate does not reconcile to Line Total')
                if unit == 'p/m' and (start is None or end is None or abs(end - start - quantity) > Decimal('0.01')):
                    raise ValueError(f'{where}: drilled metres do not reconcile to the depth interval')
                if quantity < 0 or cost < 0:
                    warnings.append({'severity': 'warning', 'issue': f'{where}: negative quantity or credit preserved ({quantity} {unit}, ${cost}); review the source entry.'})
                totals[key] += cost
                minutes = int(round(quantity * 60)) if unit == 'p/hr' else None
                text = ' | '.join(str(v) for v in (activity, comment, f'Claim {claim}; DAR {dar}', f'Driller: {driller}' if driller else '', where) if v)
                activities.append({
                    'source_file': filename, 'contractor': 'DEPCO Drilling', 'date': report_date,
                    'hole_num': str(hole or '').strip(), 'site_name': str(hole or '').strip(),
                    'program': 'Exploration', 'project': '', 'location': '', 'drill_rig': rig,
                    'client': '', 'contract': po.group(1) if po else '', 'shift': '',
                    'time_from': '', 'time_to': '', 'total_time': f'{minutes // 60}:{minutes % 60:02d}' if minutes is not None else '',
                    'bit_type': 'PCD' if activity.startswith('PCD') else 'Core' if activity.startswith('Core') else '',
                    'diameter': '', 'metres_from': float(start) if start is not None else None,
                    'metres_to': float(end) if end is not None else None,
                    'total_metres': float(quantity) if unit == 'p/m' else None,
                    'code': activity, 'notes': text, 'rate_year': str(day.year),
                    'unit_rate': float(rate), 'quantity': float(quantity), 'line_cost': float(cost),
                    'rate_basis': f'{SOURCE_BASIS}: {unit}; {where}', 'po_id': None,
                })
                if driller:
                    crew_key = (report_date, str(hole or ''), str(driller))
                    if crew_key not in crews:
                        crews[crew_key] = {'source_file': filename, 'contractor': 'DEPCO Drilling',
                                          'date': report_date, 'hole_num': str(hole or ''), 'site_name': str(hole or ''),
                                          'role': 'Driller', 'name': str(driller), 'hours': None}
            for key, expected in checks.items():
                if abs(totals[key] - expected) > Decimal('0.02'):
                    raise ValueError(f'{sheet.title} {key}: shift totals do not reconcile to charge lines')
            for key, numbers in dar_numbers.items():
                if len(numbers) > 1:
                    warnings.append({'severity': 'warning', 'issue': f'{sheet.title} {key}: multiple DAR numbers ({", ".join(sorted(numbers))}); source identifiers preserved.'})
            for report_date in sorted(outside_period):
                warnings.append({'severity': 'warning', 'issue': f'{sheet.title}: {report_date} is outside the workbook claim period; the source date is preserved and needs review.'})
        if not activities:
            raise ValueError('No DEPCO Exploration claim rows found; expected a DR rig sheet with Claim / Date / DAR # / Activity Charge columns')
        header = {'warnings': warnings}
        if periods:
            header.update(period_start=min(p[0] for p in periods), period_end=max(p[1] for p in periods))
        return header, activities, [], list(crews.values()), ''
    finally:
        workbook.close()
