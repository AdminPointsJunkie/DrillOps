"""Confirmed Burton spelling variants must reconcile without editing source rows."""
import ast
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
TREE = ast.parse((ROOT / 'backend/main.py').read_text(encoding='utf-8'))
NAMES = {'burton_borehole_activity_aliases', 'BURTON_BOREHOLE_ACTIVITY_MATCH_SQL',
         'COMPANY_BOREHOLE_ACTIVITY_MATCH_SQL'}
NODES = [node for node in TREE.body if getattr(node, 'name', '') in NAMES or
         isinstance(node, ast.Assign) and any(getattr(t, 'id', '') in NAMES for t in node.targets)]
NS = {}
exec(compile(ast.Module(body=NODES, type_ignores=[]), '<aliases>', 'exec'), NS)


class BurtonHoleAliasesTests(unittest.TestCase):
    def test_aliases_are_project_scoped_and_preserve_existing_aliases(self):
        link = NS['burton_borehole_activity_aliases']
        other = {'project': 'Other', 'hole_id': 'ESPNG08'}
        self.assertEqual(link(other.copy()), other)
        row = {'project': 'BCC Fugitive Emissions', 'hole_id': 'ESPNG08', 'activity_hole_ids': ['existing']}
        self.assertEqual(link(row)['activity_hole_ids'], ['existing', 'ESPNG08', 'ESPNG8', 'ESPGN8'])
        self.assertEqual(link(row)['activity_hole_ids'], ['existing', 'ESPNG08', 'ESPNG8', 'ESPGN8'])

    def test_all_query_modes_expand_the_scoped_match_and_preserve_date_regex(self):
        fn = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == 'get_boreholes')
        queries = [node.args[0] for node in ast.walk(fn) if isinstance(node, ast.Call)
                   and isinstance(node.func, ast.Attribute) and node.func.attr == 'execute'
                   and node.args and isinstance(node.args[0], ast.JoinedStr)]
        env = {**NS, 'ACTIVITY_REPORT_DATE_AS_ISO_SQL': 'a.date'}
        self.assertEqual(len(queries), 3)
        for expr in queries:
            query = eval(compile(ast.Expression(expr), '<query>', 'eval'), env)
            self.assertIn("a.project='BCC Fugitive Emissions'", query)
            self.assertIn("a.contractor='Mitchells Drilling'", query)
            self.assertIn("WHEN 'ESPGN8' THEN 'ESPNG08'", query)
            if "a.date ~" in query:
                self.assertIn("[0-9]{4}-[0-9]{2}-[0-9]{2}", query)

    def test_live_population_reconciles_once_per_line_in_browser_functions(self):
        # Read-only production profile, 13 October 2026: seven source-ID groups.
        groups = [('ESPGN10', 'ESPGN10', 47), ('ESPGN13', 'ESPGN13', 41),
                  ('ESPGN8', 'ESPGN8', 9), ('ESPNG06', 'ESPNG06', 79),
                  ('ESPNG11', 'ESPNG11', 126), ('ESPNG13', 'ESPGN13', 75),
                  ('ESPNG8', 'ESPNG8', 89)]
        holes = [NS['burton_borehole_activity_aliases']({'project': 'BCC Fugitive Emissions', 'hole_id': h})
                 for h in ['ESPNG06', 'ESPNG08', 'ESPNG10', 'ESPNG11', 'ESPNG13']]
        html = (ROOT / 'docs/index.html').read_text(encoding='utf-8')
        functions = []
        for name in ['rowHole', 'reportIdentity', 'boreholeMatchValues', 'rowMatchesBorehole']:
            start = html.index('function ' + name + '(')
            functions.append(html[start:html.index('\nfunction ', start + 1)])
        script = '\n'.join(functions) + '\nconst holes=' + json.dumps(holes) + ';'
        script += '\nconst groups=' + json.dumps(groups) + ';'
        script += """
let linked=0;
for(const [hole_num,site_name,count] of groups){
  const matches=holes.filter(h=>rowMatchesBorehole({hole_num,site_name},h));
  if(matches.length!==1)throw new Error('Ambiguous or missing match: '+hole_num);
  linked+=count;
}
if(linked!==466)throw new Error('Wrong coverage');
if(holes.some(h=>rowMatchesBorehole({hole_num:'ESPGN12',site_name:''},h)))throw new Error('Invented alias');
console.log(linked);
"""
        result = subprocess.run(['node', '-'], input=script, text=True, capture_output=True, check=True)
        self.assertEqual(result.stdout.strip(), '466')


if __name__ == '__main__':
    unittest.main()
