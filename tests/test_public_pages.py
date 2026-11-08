"""Public-page contracts: assets, navigation and separation from portal logic."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import re
import subprocess
import unittest
ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'
PAGES = ['index.html', 'eos.html', 'account.html', 'project.html', 'drillops.html', 'accounting.html', 'project-management.html', 'fieldops.html', 'fieldmaps.html', 'support.html', 'privacy.html', 'fieldops-support.html', 'fieldops-privacy.html']
PAGES += [str(path.relative_to(DOCS)) for path in (DOCS/'OLD').glob('*.html')]
class HTML(HTMLParser):
    def __init__(self, source):
        super().__init__(); self.links=[]; self.assets=[]; self.ids=[]; self.feed(source)
    def handle_starttag(self, tag, pairs):
        a=dict(pairs)
        if 'id' in a: self.ids.append(a['id'])
        if tag=='a' and 'href' in a: self.links.append(a['href'])
        if tag in ['img','script'] and 'src' in a: self.assets.append(a['src'])
        if tag=='link' and a.get('rel')=='stylesheet': self.assets.append(a['href'])
class PublicPages(unittest.TestCase):
    def test_assets_and_local_links(self):
        for name in PAGES:
            parsed=HTML((DOCS/name).read_text())
            for href in parsed.links+parsed.assets:
                u=urlsplit(href)
                if u.scheme or u.netloc or href=='#': continue
                base=DOCS if u.path.startswith('/') else (DOCS/name).parent
                path=base/unquote(u.path.lstrip('/')) if u.path else DOCS/name
                if path.is_dir(): path=path/'index.html'
                self.assertTrue(path.exists(),f'{name}: missing {href}')
                if u.fragment and path.suffix=='.html':
                    self.assertIn(u.fragment,HTML(path.read_text()).ids,f'{name}: broken anchor {href}')
    def test_product_access(self):
        activities=(DOCS/'drillops.html').read_text()
        maps=(DOCS/'fieldmaps.html').read_text()
        self.assertIn('href="./eos.html">Sign in',activities)
        self.assertIn('href="./maps/?signin=1">Sign in',maps)
        self.assertNotIn('6796881116',activities)
    def test_fieldops_store_and_qr(self):
        for name in ['fieldops.html','fieldops-support.html']:
            s=(DOCS/name).read_text()
            self.assertIn('id6797079076',s)
            self.assertIn('fieldops-app-store-qr.png',s)
    def test_shared_authentication_and_app_boundaries(self):
        for name in ['index.html','eos.html','account.html','project.html']:
            source=(DOCS/name).read_text()
            self.assertIn('src="./workspace/runtime.js',source)
            self.assertIn('src="./workspace/start.js',source)
            ids=HTML(source).ids
            self.assertEqual(len(ids),len(set(ids)),name+' duplicate ids')
        for name in ['index.html','eos.html','account.html','project.html']:
            self.assertNotIn('Switch app',(DOCS/name).read_text())
            self.assertNotIn('app-chooser',(DOCS/name).read_text())
        self.assertNotIn('id="page-invoices"',(DOCS/'eos.html').read_text())
        self.assertNotIn('id="page-activities"',(DOCS/'account.html').read_text())
        self.assertNotIn('id="page-invoices"',(DOCS/'project.html').read_text())
        runtime=(DOCS/'workspace/runtime.js').read_text()
        self.assertIn("const AUTH_STORAGE_KEY='drillops_supabase_session'",runtime)
        self.assertIn("DrillOpsSession.fetch(input,options)",runtime)
        session=(DOCS/'auth-session.js').read_text()
        self.assertIn("headers.set('Authorization','Bearer '+access)",session)
        for name in ['eos.html','account.html','project.html']:
            self.assertNotIn('id="workspace-context-btn"',(DOCS/name).read_text())
    def test_no_illustrative_marketing(self):
        for name in ['index.html','drillops.html','fieldops.html','fieldmaps.html']:
            s=(DOCS/name).read_text()
            self.assertNotIn('assets/ecosystem-map.svg',s)
            self.assertNotIn('assets/portal-borehole-planning.png',s)
    def test_legacy_portal_remains_combined_and_authenticated(self):
        old=(DOCS/'OLD/index.html').read_text()
        self.assertIn('id="page-invoices"',old)
        self.assertIn('id="page-activities"',old)
        self.assertIn('id="page-project-budgets"',old)
        self.assertIn("const AUTH_STORAGE_KEY='drillops_supabase_session'",old)
        self.assertNotIn('./workspace/runtime.js',old)
        self.assertIn('href="./index.html"',(DOCS/'OLD/training.html').read_text())
    def test_homepage_has_an_explicit_public_entry_marker(self):
        self.assertIn('data-public-home="true"',(DOCS/'index.html').read_text())
        self.assertIn('<title>DrillOps</title>',(DOCS/'index.html').read_text())
        for name in ['eos','account','project']:
            self.assertNotIn('data-public-home=',(DOCS/(name+'.html')).read_text())
if __name__=='__main__': unittest.main()
