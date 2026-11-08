import unittest
from datetime import date
from eos_weather import normalise_silo, project_centre, weather_payload


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

    def test_locations_are_rounded_to_real_grid_and_disjoint_sites_not_averaged(self):
        self.assertEqual(project_centre([{'lat':-21.7549,'lng':148.1686}]),(-21.75,148.15))
        self.assertIsNone(project_centre([{'lat':0,'lng':0}]))
        self.assertIsNone(project_centre([{'lat':-21.7,'lng':148.1},{'lat':-23,'lng':148.1}]))

    def test_future_dates_are_never_filled_with_forecast_or_invented_values(self):
        calls=[]
        def fetch(*args):calls.append(args);return []
        rows=[{'lat':-21.75,'lng':148.15}]
        weather_payload(rows,'2026-10-01','2026-11-08',today=date(2026,11,8),fetch=fetch)
        self.assertEqual(calls[0][-1],'2026-11-07')
        calls.clear();weather_payload(rows,'2026-11-08','2026-11-09',today=date(2026,11,8),fetch=fetch)
        self.assertEqual(calls,[])
        self.assertFalse(weather_payload([],'2026-10-01','2026-10-02',fetch=fetch)['available'])

    def test_invalid_periods_are_rejected_before_request(self):
        for start,end in [('bad','2026-11-08'),('2026-11-10','2026-11-08'),('2000-01-01','2026-11-08')]:
            with self.assertRaises(ValueError):weather_payload([],start,end)


if __name__=='__main__':unittest.main()
