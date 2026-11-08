import unittest
from datetime import date
from eos_weather import normalise_silo, normalise_conditions, weather_payload, create_eos_weather_router


class WeatherTests(unittest.TestCase):
    def test_missing_and_climatology_values_are_not_real_weather(self):
        payload={'data':[{'date':'2026-10-01','variables':[
            {'variable_code':'max_temp','value':30,'source':75},
            {'variable_code':'min_temp','value':17,'source':25},
            {'variable_code':'rh_tmax','value':45,'source':26},
            {'variable_code':'rh_tmin','value':85,'source':26},
            {'variable_code':'daily_rain','value':-999,'source':25}]}]}
        d=normalise_silo(payload)[0]
        self.assertIsNone(d['max_c']);self.assertIsNone(d['humidity_at_max']);self.assertIsNone(d['rain_mm'])
        self.assertEqual(d['min_c'],17);self.assertEqual(d['humidity_at_min'],85)

    def test_symbols_use_explicit_codes_and_brisbane_dates(self):
        text='year,month,day,hour,coco,coco_source\n2026,10,1,13,9,metno_forecast\n2026,10,1,14,25,metno_forecast\n2026,10,2,1,1,metno_forecast\n2026,10,2,2,,\n2026,10,2,3,99,\n'
        days=normalise_conditions(text)
        self.assertEqual(days['2026-10-01']['condition_code'],9)
        self.assertEqual(days['2026-10-02']['condition_code'],25)
        self.assertTrue(days['2026-10-02']['condition_estimated'])
        self.assertEqual(len(days),2)

    def test_fixed_location_and_future_dates_never_filled(self):
        calls=[]
        def fetch(*args):calls.append(args);return []
        result=weather_payload('2026-10-01','2026-11-08',today=date(2026,11,8),fetch=fetch,conditions_fetch=lambda *_:{})
        self.assertEqual(calls,[('2026-10-01','2026-11-07')]);self.assertIn('Moranbah',result['reference'])
        calls.clear();weather_payload('2026-11-08','2026-11-09',today=date(2026,11,8),fetch=fetch,conditions_fetch=fetch)
        self.assertEqual(calls,[])

    def test_independent_failures_and_future_provider_values_are_excluded(self):
        def failure(*_):raise RuntimeError()
        conditions=lambda *_:{'2026-10-01':{'condition_code':25},'2026-11-09':{'condition_code':23}}
        result=weather_payload('2026-10-01','2026-10-02',fetch=failure,conditions_fetch=conditions)
        self.assertTrue(result['available']);self.assertFalse(result['quantitative_available']);self.assertEqual(len(result['days']),1)
        self.assertFalse(weather_payload('2026-10-01','2026-10-02',fetch=failure,conditions_fetch=failure)['available'])
        result=weather_payload('2026-10-01','2026-10-02',fetch=lambda *_:[{'date':'2026-10-01','rain_mm':30}],conditions_fetch=failure)
        self.assertEqual(result['days'],[{'date':'2026-10-01','rain_mm':30}]);self.assertFalse(result['conditions_available'])

    def test_invalid_periods_are_rejected_before_request(self):
        for start,end in [('bad','2026-11-08'),('2026-11-10','2026-11-08'),('2000-01-01','2026-11-08')]:
            with self.assertRaises(ValueError):weather_payload(start,end)

    def test_route_has_no_project_or_database_dependency(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        app=FastAPI();app.include_router(create_eos_weather_router());client=TestClient(app)
        params=app.openapi()['paths']['/eos/weather']['get']['parameters']
        self.assertEqual({p['name'] for p in params},{'start','end'})
        self.assertEqual(client.get('/eos/weather?start=bad&end=2026-10-01').status_code,400)

if __name__=='__main__':unittest.main()
