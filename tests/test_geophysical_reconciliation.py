import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from geophysical_reconciliation import ARGO, IRONBARK, BCC, reconcile_rows
class ReconciliationTests(unittest.TestCase):
 def row(self, hole, **kw):
  return dict(workspace_id=ARGO,campaign_id=IRONBARK,contractor='Weatherfords',hole_num=hole,**kw)
 def test_reviewed_alias_requires_source_workspace_and_campaign(self):
  r=self.row('IB688C',source_file='CJS 2026.08_Individual Sheets.pdf')
  register=[dict(self.row(''),hole_id='IB668C')]
  variants=[r,{**r,'source_file':'unknown.pdf'},{**r,'workspace_id':'other'},{**r,'campaign_id':'other'},{**r,'contractor':'Other'}]
  linked,_=reconcile_rows(variants,[],register)
  self.assertEqual(linked[0]['canonical_hole_num'],'IB668C')
  self.assertEqual(linked[0]['hole_num'],'IB688C')
  self.assertTrue(linked[0]['hole_match_reason'])
  self.assertTrue(all(x['canonical_hole_num']=='IB688C' for x in linked[1:]))
 def test_bcc_aliases_but_redrill_suffixes_stay_separate(self):
  rows=[{**self.row(h),'campaign_id':BCC} for h in ['ESPGN8','ESPNG08','BL26-005','BL26-005A']]
  register=[{**rows[0],'hole_id':'ESPNG08'}]
  linked,drilling=reconcile_rows(rows,rows,register)
  self.assertEqual([r['canonical_hole_num'] for r in linked],['ESPNG08','ESPNG08','BL26-005','BL26-005A'])
  self.assertEqual(drilling[0]['canonical_hole_num'],'ESPNG08')
 def test_endpoint_keeps_read_only_scoped_connection_and_eos_access(self):
  import ast
  from app_access import route_apps
  tree=ast.parse((Path(__file__).resolve().parents[1]/'backend/main.py').read_text(encoding='utf-8'))
  fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='get_geophysical_reconciliation')
  calls=[n for n in ast.walk(fn) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='get_conn']
  self.assertEqual(len(calls),1)
  self.assertTrue(any(k.arg=='read_only' and k.value.value is True for k in calls[0].keywords))
  self.assertEqual(route_apps('/activities/geophysical-reconciliation','GET'),frozenset({'eos'}))
if __name__=='__main__':unittest.main()
