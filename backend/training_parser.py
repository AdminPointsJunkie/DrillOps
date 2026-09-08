"""Read the tabular Cardholder Report format; document text is data only."""
import hashlib
import io
import re
from datetime import datetime

import pdfplumber


def clean(value):
    return ' '.join((value or '').split())


def parse_date(value):
    if not value:
        return None
    return datetime.strptime(value, '%d %b %y').date().isoformat()


def parse_report(payload, filename):
    if not payload.startswith(b'%PDF-'):
        raise ValueError('This file is not a PDF.')
    digest = hashlib.sha256(payload).hexdigest()
    with pdfplumber.open(io.BytesIO(payload)) as doc:
        if len(doc.pages) > 50:
            raise ValueError('Reports are limited to 50 pages.')
        first = doc.pages[0].extract_text() or ''
        name = re.search(r'Cardholder Report for (.+?) at (.+)', first)
        card = re.search(r'Cardholder ID\s*=\s*([\d ]+)', first)
        printed = re.search(r'Printed on (\d{2} \w{3} \d{2})(?: at (\d{2}:\d{2}))?', first)
        company = re.search(r'^Companies:\s*(.+)', first, re.M)
        if not name or not card:
            raise ValueError('No cardholder identity found. Upload a text-based Cardholder Report.')
        records = []
        for number, page in enumerate(doc.pages, 1):
            for table in page.extract_tables():
                for row in table:
                    if len(row) != 10 or clean(row[0]) == 'Competency Name':
                        continue
                    cells = [clean(c) for c in row]
                    if not cells[0] or not cells[9]:
                        raise ValueError(f'Incomplete training row on page {number}; import stopped for review.')
                    try:
                        issued, expires = parse_date(cells[5]), parse_date(cells[7])
                    except ValueError:
                        raise ValueError(f'Unrecognised date on page {number}: {cells[0]}')
                    records.append(dict(name=cells[0], location=cells[1], issuer=cells[2],
                                        assignment=cells[3], issued=issued, expires=expires,
                                        duration=cells[6], reportedStatus=cells[9], page=number))
        if not records:
            raise ValueError('No training table found. Scanned PDFs need OCR before importing.')
        return dict(id=re.sub(r'\s', '', card.group(1)), name=name.group(1),
                    company=company.group(1) if company else '', site=name.group(2),
                    role='Unassigned', reportDate=parse_date(printed.group(1)) if printed else None,
                    reportPrintedAt=(parse_date(printed.group(1)) + 'T' + printed.group(2)) if printed and printed.group(2) else None,
                    source=filename, sourceId=digest, records=records)
