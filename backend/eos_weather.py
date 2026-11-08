"""Free SILO/BOM-derived daily conditions, fetched independently of EOS production.

SILO: https://www.longpaddock.qld.gov.au/silo/api-documentation/
CC BY 4.0. Only coordinates and dates are sent to SILO; no report data.
"""
import json
import math
import os
from datetime import date, datetime, timedelta
from functools import lru_cache
from threading import Lock
from time import time
from urllib.parse import urlencode
from urllib.request import urlopen
from zoneinfo import ZoneInfo

SILO_URL = 'https://www.longpaddock.qld.gov.au/cgi-bin/silo/DataDrillDataset.php'
_FETCH_LOCK = Lock()


def project_centre(rows):
    points = []
    for row in rows:
        lat, lng = row.get('lat'), row.get('lng')
        if lat is None or lng is None:
            e, n = row.get('easting'), row.get('northing')
            if e is None or n is None or not (100000 < e < 900000 and 1000000 < n < 10000000):
                continue
            # The existing DrillOps planning map stores MGA zone 55 coordinates.
            from pyproj import Transformer
            lng, lat = Transformer.from_crs(28355, 4326, always_xy=True).transform(e, n)
        if math.isfinite(lat) and math.isfinite(lng) and -45 <= lat <= -9 and 112 <= lng <= 154:
            points.append((lat, lng))
    if not points:
        return None
    # Do not merge geographically separate sites into an invented weather location.
    if max(p[0] for p in points)-min(p[0] for p in points) > .25 or max(p[1] for p in points)-min(p[1] for p in points) > .25:
        return None
    return tuple(round(sum(p[i] for p in points)/len(points)*20)/20 for i in (0, 1))


def normalise_silo(payload):
    days = []
    for item in payload.get('data', []):
        date.fromisoformat(item['date'])
        variables = {v['variable_code']: v for v in item.get('variables', [])}
        def value(name, low, high):
            entry = variables.get(name, {})
            v = entry.get('value')
            # Source 75 is a long-term climatological average, not that day's weather.
            return v if isinstance(v, (int, float)) and math.isfinite(v) and low <= v <= high and entry.get('source') != 75 else None
        high, low = value('max_temp', -70, 65), value('min_temp', -70, 65)
        days.append({'date': item['date'], 'max_c': high, 'min_c': low,
                     'humidity_at_max': value('rh_tmax', 0, 100) if high is not None else None,
                     'humidity_at_min': value('rh_tmin', 0, 100) if low is not None else None,
                     'rain_mm': value('daily_rain', 0, 2000)})
    return days


@lru_cache(maxsize=64)
def _silo_daily(lat, lng, start, end, refresh_bucket):
    params = {'lat': f'{lat:.2f}', 'lon': f'{lng:.2f}', 'start': start.replace('-', ''),
              'finish': end.replace('-', ''), 'format': 'json', 'comment': 'XNRHG',
              'username': os.environ.get('SILO_CONTACT_EMAIL', 'admin@drillops.com.au'), 'password': 'apirequest'}
    with urlopen(SILO_URL+'?'+urlencode(params), timeout=18) as response:
        payload = json.load(response)
    if not isinstance(payload, dict) or not isinstance(payload.get('data'), list):
        raise ValueError('Weather response unavailable')
    return normalise_silo(payload)


def silo_daily(lat, lng, start, end):
    # Share results across projects in the same 5 km grid cell. Cache for six hours.
    with _FETCH_LOCK:
        return _silo_daily(lat, lng, start, end, int(time()//21600))


def weather_payload(rows, start, end, today=None, fetch=silo_daily):
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    if first > last or (last-first).days > 1826 or first < date(1889, 1, 1):
        raise ValueError('Choose a valid weather period of up to five years.')
    centre = project_centre(rows)
    if not centre:
        return {'days': [], 'available': False, 'message': 'No single saved project location is available.'}
    yesterday = (today or datetime.now(ZoneInfo('Australia/Brisbane')).date())-timedelta(days=1)
    last = min(last, yesterday)
    days = fetch(*centre, first.isoformat(), last.isoformat()) if first <= last else []
    return {'available': True, 'latitude': centre[0], 'longitude': centre[1], 'days': days,
            'source': 'Queensland Government SILO · BOM-derived', 'source_url': 'https://www.longpaddock.qld.gov.au/silo/',
            'licence': 'CC BY 4.0', 'estimated': True}


def create_eos_weather_router(get_conn):
    from fastapi import APIRouter, HTTPException, Query
    router = APIRouter()

    @router.get('/eos/weather')
    def weather(project: str = Query(..., min_length=1, max_length=200), contractor: str = Query(...), start: str = Query(...), end: str = Query(...)):
        """Cached SILO/BOM-derived weather at saved EOS project coordinates, with daily temperature, humidity and rain."""
        if contractor not in {'Mitchells Drilling', 'DEPCO Drilling', 'MCC Group'}:
            raise HTTPException(400, 'Select an EOS contractor.')
        # Validate dates before querying or contacting the provider.
        try:
            first, last = date.fromisoformat(start), date.fromisoformat(end)
            if first > last or (last-first).days > 1826 or first < date(1889, 1, 1):
                raise ValueError()
        except ValueError:
            raise HTTPException(400, 'Choose a valid weather period of up to five years.')
        with get_conn(read_only=True) as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT project,lat,lng,easting,northing FROM boreholes WHERE LOWER(TRIM(project))=LOWER(TRIM(%s))', (project,))
                rows = [dict(r) for r in cur.fetchall()]
                if not rows:
                    # A renamed reporting project can share an exact recorded hole.
                    # Accept only one planning project; never choose between ambiguous matches.
                    cur.execute('''SELECT DISTINCT b.id,b.project,b.lat,b.lng,b.easting,b.northing
                        FROM boreholes b JOIN activities a ON a.hole_num=b.hole_id
                        WHERE a.project=%s AND a.contractor=%s AND COALESCE(a.hole_num,'')<>'' ''', (project, contractor))
                    rows = [dict(r) for r in cur.fetchall()]
                    if not rows:
                        # Some newly named work packages share a hole with an
                        # existing project, but that hole is not in the plan yet.
                        cur.execute('''SELECT DISTINCT b.id,b.project,b.lat,b.lng,b.easting,b.northing
                            FROM boreholes b JOIN activities linked ON linked.project=b.project
                            JOIN activities target ON target.hole_num=linked.hole_num AND target.contractor=linked.contractor
                            WHERE target.project=%s AND target.contractor=%s AND COALESCE(target.hole_num,'')<>'' ''', (project, contractor))
                        rows = [dict(r) for r in cur.fetchall()]
                    if len({r['project'] for r in rows}) > 1:
                        rows = []
        try:
            result = weather_payload(rows, start, end)
            if rows and rows[0]['project'].strip().lower() != project.strip().lower():
                result['location_project'] = rows[0]['project']
            return result
        except Exception:
            raise HTTPException(503, 'Historical weather is temporarily unavailable. Production figures are unaffected.')
    return router
