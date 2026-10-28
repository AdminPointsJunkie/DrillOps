"""Public-page contracts: assets, navigation and separation from portal logic."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import re
import subprocess
import unittest
ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'
PAGES = ['index.html', 'drillops.html', 'fieldops.html', 'fieldmaps.html', 'support.html', 'privacy.html', 'fieldops-support.html', 'fieldops-privacy.html']
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
                path=DOCS/unquote(u.path.lstrip('/')) if u.path else DOCS/name
                if path.is_dir(): path=path/'index.html'
                self.assertTrue(path.exists(),f'{name}: missing {href}')
                if u.fragment and path.suffix=='.html':
                    self.assertIn(u.fragment,HTML(path.read_text()).ids,f'{name}: broken anchor {href}')
    def test_product_access(self):
        activities=(DOCS/'drillops.html').read_text()
        maps=(DOCS/'fieldmaps.html').read_text()
        self.assertIn('href="./index.html?signin=activities#portal-login">Sign in',activities)
        self.assertIn('href="./maps/">Sign in',maps)
        self.assertNotIn('6796881116',activities)
    def test_fieldops_store_and_qr(self):
        for name in ['fieldops.html','fieldops-support.html']:
            s=(DOCS/name).read_text()
            self.assertIn('id6797079076',s)
            self.assertIn('fieldops-app-store-qr.png',s)
    def test_portal_script_preserved(self):
        original=subprocess.check_output(['git','show','HEAD:docs/index.html'],cwd=ROOT,text=True)
        current=(DOCS/'index.html').read_text()
        scripts=lambda s:[x for x in re.findall(r'<script[^>]*>([\s\S]*?)</script>',s) if 'function doLogin' in x]
        self.assertEqual(scripts(original),scripts(current))
        self.assertTrue(scripts(current))
    def test_no_illustrative_marketing(self):
        for name in ['index.html','drillops.html','fieldops.html','fieldmaps.html']:
            s=(DOCS/name).read_text()
            self.assertNotIn('assets/ecosystem-map.svg',s)
            self.assertNotIn('assets/portal-borehole-planning.png',s)
if __name__=='__main__': unittest.main()
