import unittest
from eos_time_register import rig_register_rows, load_register

class RigHoursTests(unittest.TestCase):
    def test_both_contractors_without_people(self):
        for contractor in ('DEPCO Drilling', 'Mitchells Drilling'):
            base=dict(id=1,date='10/11/2026',contractor=contractor,drill_rig='R1',project='Ironbark',program='Exploration')
            rows=rig_register_rows([dict(base,total_time='10:30'),dict(base,id=2,total_time='1.5')])
            self.assertEqual(len(rows),1)
            self.assertEqual(rows[0]['hours'],12)
            self.assertEqual(rows[0]['basis'],'Rig hours')
            self.assertIsNone(rows[0]['days'])
    def test_scope_and_invalid_values(self):
        base=dict(id=1,date='2026-11-10',contractor='DEPCO Drilling',drill_rig='R1',project='Ironbark',program='Exploration')
        rows=rig_register_rows([dict(base,total_time='2'),dict(base,program='Gas Risers',total_time='3'),dict(base,drill_rig='R2',total_time='4')]+[dict(base,total_time=x) for x in ['N/A','NaN','-2','1:99','']]+[dict(base,total_time='12',code='H_Min_Shift')])
        self.assertEqual(len(rows),3)
        self.assertEqual(sum(r['hours'] for r in rows),9)
    def test_register_does_not_require_or_multiply_by_crew(self):
        class Cursor:
            def execute(self,query):
                self.query=query
            def fetchall(self):
                if 'FROM activities' in self.query and 'worked_days AS' not in self.query:
                    return [dict(id=1,date='2026-11-10',contractor='Mitchells Drilling',total_time='12')]
                return []
        rows=load_register(Cursor())['rows']
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['hours'],12)

if __name__=='__main__':unittest.main()
