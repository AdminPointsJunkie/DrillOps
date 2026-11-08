import ast
from contextlib import contextmanager
from pathlib import Path
import unittest
from eos_reconciliation import MONTHLY_SQL

# Can also run against Postgres through a read-only connection; all rows are synthetic CTEs.
FIXTURE_SQL = """WITH sample_activities(contractor,project,program,drill_rig,date,source_file,hole_num,shift,line_cost) AS (VALUES
 ('Mitchells Drilling','Sample','Exploration','R1','1/10/2026','report.pdf','H1','Day',100.0),
 ('Mitchells Drilling','Sample','Exploration','R2','1/10/2026','report.pdf','H2','Day',200.0),
 ('Mitchells Drilling','Sample','Exploration','R1','2026-11-02','new.pdf','H1','Day',NULL)
), sample_consumables(contractor,date,source_file,hole_num,line_cost) AS (VALUES
 ('Mitchells Drilling','1/10/2026','report.pdf','',30.0),
 ('Mitchells Drilling','1/10/2026','report.pdf','H1',40.0),
 ('Mitchells Drilling','1/10/2026','orphan.pdf','',50.0)
), sample_invoices(contractor,project,program,billing_month,invoice_date,subtotal) AS (VALUES
 ('Mitchells Drilling','Sample','Exploration','10/2026','2026-11-10',200.0),
 ('Mitchells Drilling','Sample','Exploration','','2/10/2026',-20.0),
 ('Other supplier','Sample','Exploration','10/2026','2026-10-10',999.0)
), """ + MONTHLY_SQL.strip()[5:].replace('FROM activities ', 'FROM sample_activities ').replace('FROM consumables ', 'FROM sample_consumables ').replace('FROM invoices ', 'FROM sample_invoices ').replace('FROM day_rate_days', 'FROM (SELECT * FROM day_rate_days WHERE FALSE) day_rate_days')

class MonthlyEndpoint(unittest.TestCase):
    def test_one_read_only_query_and_response(self):
        calls=[];modes=[]
        class Cursor:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def execute(self,sql):calls.append(sql)
            def fetchone(self):return {'eos':[], 'invoices':[]}
        class Conn:
            def cursor(self):return Cursor()
        @contextmanager
        def conn(**kw):modes.append(kw);yield Conn()
        tree=ast.parse((Path(__file__).parent/'main.py').read_text())
        node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='get_monthly_eos_reconciliation');node.decorator_list=[]
        ns={'get_conn':conn};exec(compile(ast.Module(body=[node],type_ignores=[]),'<test>','exec'),ns)
        self.assertEqual(ns[node.name](),{'eos':[],'invoices':[]})
        self.assertEqual(calls,[MONTHLY_SQL]);self.assertEqual(modes,[{'read_only':True}])

if __name__=='__main__':unittest.main()
