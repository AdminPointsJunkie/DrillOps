"""Fixed regional weather context; no project, contractor or report data leaves EOS.

SILO/BOM-derived daily estimates and Meteostat modelled conditions, CC BY 4.0.
https://www.longpaddock.qld.gov.au/silo/api-documentation/
https://dev.meteostat.net/data/timeseries/hourly
"""
import csv
import gzip
import io
import json
import math
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from threading import Lock
from time import time
from urllib.parse import urlencode
from urllib.request import urlopen
from zoneinfo import ZoneInfo

SILO_URL = 'https://www.longpaddock.qld.gov.au/cgi-bin/silo/DataDrillDataset.php'
WEATHER_STATION = {'name': 'Coppabella–Moranbah area', 'reference': 'Moranbah Airport area',
                   'latitude': -22.0644, 'longitude': 148.0758, 'grid_latitude': -22.05, 'grid_longitude': 148.10}
_FETCH_LOCK = Lock()
_CONDITION_LOCK = Lock()
# Prioritise an explicit thunderstorm/lightning code, never infer lightning from rainfall.
CONDITION_PRIORITY = {23: 100, 26: 99, 25: 98, 24: 90, 27: 85, 9: 80, 18: 79,
                      11: 78, 8: 70, 17: 69, 7: 60, 6: 55, 5: 54, 4: 40, 3: 30, 2: 20, 1: 10}


def normalise_silo(payload):
    days = []
    for item in payload.get('data', []):
        date.fromisoformat(item['date'])
        variables = {v['variable_code']: v for v in item.get('variables', [])}
        def value(name, low, high):
            entry = variables.get(name, {})
            v = entry.get('value')
            return v if isinstance(v, (int, float)) and math.isfinite(v) and low <= v <= high and entry.get('source') != 75 else None
        high, low = value('max_temp', -70, 65), value('min_temp', -70, 65)
        days.append({'date': item['date'], 'max_c': high, 'min_c': low,
                     'humidity_at_max': value('rh_tmax', 0, 100) if high is not None else None,
                     'humidity_at_min': value('rh_tmin', 0, 100) if low is not None else None,
                     'rain_mm': value('daily_rain', 0, 2000)})
    return days


@lru_cache(maxsize=64)
def _silo_daily(start, end, refresh_bucket):
    params = {'lat': WEATHER_STATION['grid_latitude'], 'lon': WEATHER_STATION['grid_longitude'],
              'start': start.replace('-', ''), 'finish': end.replace('-', ''), 'format': 'json', 'comment': 'XNRHG',
              'username': os.environ.get('SILO_CONTACT_EMAIL', 'admin@drillops.com.au'), 'password': 'apirequest'}
    with urlopen(SILO_URL+'?'+urlencode(params), timeout=18) as response:
        payload = json.load(response)
    if not isinstance(payload, dict) or not isinstance(payload.get('data'), list):
        raise ValueError('Weather response unavailable')
    return normalise_silo(payload)


def silo_daily(start, end):
    with _FETCH_LOCK:
        return _silo_daily(start, end, int(time()//21600))


def normalise_conditions(text):
    days = {}
    for row in csv.DictReader(io.StringIO(text)):
        try:
            code = int(row['coco'])
            if not 1 <= code <= 27:
                continue
            stamp = datetime(*(int(row[k]) for k in ('year', 'month', 'day', 'hour')), tzinfo=timezone.utc)
            key = stamp.astimezone(ZoneInfo('Australia/Brisbane')).date().isoformat()
        except (ValueError, KeyError):
            continue
        current = days.get(key)
        if current is None or CONDITION_PRIORITY.get(code, 50) > CONDITION_PRIORITY.get(current['condition_code'], 50):
            # Moranbah's bulk feed uses model gap fills. Label all symbols as estimates,
            # rather than claiming station observations or confirmed lightning strikes.
            days[key] = {'condition_code': code, 'condition_estimated': True,
                         'condition_source': row.get('coco_source') or 'Meteostat'}
    return days


@lru_cache(maxsize=16)
def _conditions_year(year, refresh_bucket):
    with urlopen(f'https://data.meteostat.net/hourly/{year}/YMRB0.csv.gz', timeout=18) as response:
        return normalise_conditions(gzip.decompress(response.read()).decode('utf-8-sig'))


def conditions_daily(start, end):
    first = datetime.combine(date.fromisoformat(start), datetime.min.time(), ZoneInfo('Australia/Brisbane'))
    last = date.fromisoformat(end)
    merged = {}
    with _CONDITION_LOCK:
        for year in range(first.astimezone(timezone.utc).year, last.year+1):
            try:
                values = _conditions_year(year, int(time()//21600))
            except Exception:
                continue  # A missing year must not hide other years or the SILO trend.
            for key, value in values.items():
                if start <= key <= end and (key not in merged or CONDITION_PRIORITY.get(value['condition_code'], 50) > CONDITION_PRIORITY.get(merged[key]['condition_code'], 50)):
                    merged[key] = value
    return merged


def weather_payload(start, end, today=None, fetch=silo_daily, conditions_fetch=conditions_daily):
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    if first > last or (last-first).days > 1826 or first < date(1889, 1, 1):
        raise ValueError('Choose a valid weather period of up to five years.')
    yesterday = (today or datetime.now(ZoneInfo('Australia/Brisbane')).date())-timedelta(days=1)
    last = min(last, yesterday)
    days, conditions, quantitative_available = [], {}, False
    if first <= last:
        with ThreadPoolExecutor(max_workers=2) as pool:
            quantitative = pool.submit(fetch, first.isoformat(), last.isoformat())
            symbols = pool.submit(conditions_fetch, first.isoformat(), last.isoformat())
            try:
                days = quantitative.result()
                quantitative_available = bool(days)
            except Exception:
                pass
            try:
                conditions = symbols.result()
            except Exception:
                pass
    merged = {d['date']: dict(d) for d in days if first.isoformat() <= d['date'] <= last.isoformat()}
    for key, condition in conditions.items():
        if first.isoformat() <= key <= last.isoformat():
            merged.setdefault(key, {'date': key}).update(condition)
    return {'available': bool(merged), **WEATHER_STATION, 'days': [merged[k] for k in sorted(merged)],
            'quantitative_available': quantitative_available, 'conditions_available': bool(conditions),
            'source': 'SILO / Queensland Government · BOM-derived estimates',
            'source_url': 'https://www.longpaddock.qld.gov.au/silo/',
            'conditions_source': 'Meteostat and its data providers · modelled conditions',
            'conditions_source_url': 'https://dev.meteostat.net/data/timeseries/hourly',
            'licence': 'CC BY 4.0', 'estimated': True}


def create_eos_weather_router():
    from fastapi import APIRouter, HTTPException, Query
    router = APIRouter()

    @router.get('/eos/weather')
    def weather(start: str = Query(...), end: str = Query(...)):
        """Fixed Coppabella–Moranbah weather: SILO trends and Meteostat estimated conditions, independent of project and rig."""
        try:
            first, last = date.fromisoformat(start), date.fromisoformat(end)
            if first > last or (last-first).days > 1826 or first < date(1889, 1, 1):
                raise ValueError()
        except ValueError:
            raise HTTPException(400, 'Choose a valid weather period of up to five years.')
        return weather_payload(start, end)
    return router
