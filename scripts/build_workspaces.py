"""Build standalone EOS, Account and Project documents from shared auth/shell and owned panels.
Run python3 scripts/build_workspaces.py after editing docs/workspace sources.
"""
from pathlib import Path
import re, json, html
ROOT=Path(__file__).resolve().parents[1]; DOCS=ROOT/'docs'; SRC=DOCS/'workspace'
APPS={
 'eos':{'name':'EOS','tag':'Record the work. Understand the charges.','copy':'Daily reports, production and charges from work completed.','panels':['reports','activities','production','costing','rates','cost-contracts','importer'],'nav':[('activities','Plods'),('reports','Period reports'),('production','Production'),('costing','Associated charges'),('rates','Rate library'),('cost-contracts','Contracts'),('importer','Import reports')]},
 'account':{'name':'Account','tag':'Your books. Clear and connected.','copy':'Actual invoices, credit notes and purchase orders in one place.','panels':['invoices','purchase-orders','contractors','importer'],'nav':[('invoices','Invoice ledger'),('purchase-orders','Purchase orders'),('contractors','Suppliers'),('importer','Import invoices')]},
 'project':{'name':'Project','tag':'Plan the program. Keep it moving.','copy':'Projects, borehole planning, maps and budget allocations.','panels':['project-budgets','budget','boreholes','admin'],'nav':[('project-budgets','Projects'),('boreholes','Borehole planning & map'),('budget','Budget planning'),('admin','Users & change log')]}}
shell=(SRC/'shell.html').read_text()
def link(area,page,label,css='app-task'):
 return f'<a class="{css}" href="./{area}.html?view={page}">{html.escape(label)}<span aria-hidden="true">↗</span></a>'
for area,cfg in APPS.items():
 title=cfg['name'];nav='<div class="drawer-section"><div class="drawer-section-title">'+title+'</div>'
 if area=='eos':nav+='<a class="drawer-nav-item" href="./eos.html">Overview</a>'
 for page,label in cfg['nav']:nav+=f'<button class="drawer-nav-item" data-page="{page}" onclick="drawerNav(this)">{label}</button>'
 if area=='project':nav+='<a class="drawer-nav-item" href="./training.html">Training matrix</a>'
 nav+='</div>'
 home=(SRC/'eos-home.html').read_text() if area=='eos' else ''
 s=shell.replace('{{navigation}}',nav).replace('{{area}}',area).replace('{{label}}',title).replace('{{home}}',home)
 local_links=''.join(link(area,p,l,'app-nav-link') for p,l in cfg['nav'])
 if area=='project':local_links+='<a href="./training.html">Training matrix</a>'
 if area=='eos':local_links='<a href="./eos.html">Overview</a>'+local_links
 s=s.replace('{{area-navigation}}','<nav class="app-local-nav" aria-label="'+title+' navigation">'+local_links+'</nav>')
 s=s.replace('<a class="logo" href="./index.html" aria-label="DrillOps home">Drill<span>Ops</span></a><span class="workspace-area-name">'+title+'</span>',f'<a class="workspace-area-name" href="./{area}.html" aria-label="{title} home">{title}</a>')

 def panel(m):
  name=m[1]
  if name not in cfg['panels']:return ''
  value=(SRC/'panels'/f'{name}.html').read_text().replace('class="page active"','class="page"')
  if name=='importer':
   value=value.replace('<h2 class="section-title">Import Data</h2>',f'<h2 class="section-title">Import {"invoices" if area=="account" else "reports"}</h2>')
   # Exclude other app's upload controls; listeners are optional in the shared runtime.
   from html.parser import HTMLParser
   class Cards(HTMLParser):
    def __init__(self,text):
     super().__init__();self.lines=text.splitlines(keepends=True);self.level=0;self.ranges=[];self.feed(text)
    def pos(self):
     l,c=self.getpos();return sum(map(len,self.lines[:l-1]))+c
    def handle_starttag(self,t,a):
     if t=='div':
      if self.level:self.level+=1
      elif 'chart-card' in dict(a).get('class','').split():self.level=1;self.start=self.pos()
    def handle_endtag(self,t):
     if t=='div' and self.level:
      self.level-=1
      if not self.level:self.ranges.append((self.start,self.pos()+6))
   ranges=Cards(value).ranges
   for i,(a,b) in reversed(list(enumerate(ranges))):
    if (area=='account' and i!=2) or (area=='eos' and i==2):value=value[:a]+value[b:]
   value=value.replace('grid-template-columns:1fr 1fr 1fr','grid-template-columns:repeat(auto-fit,minmax(280px,1fr))')
  return value
 s=re.sub(r'\{\{panel:([^}]+)\}\}',panel,s)
 s=s.replace('</head>','<link rel="stylesheet" href="./workspace/app-style.css?v=20261108">\n</head>')
 s=s.replace('<div class="drawer-title">DrillOps</div>',f'<div class="drawer-title">{title}</div>').replace(f'<div class="drawer-subtitle">{title}</div>','<div class="drawer-subtitle">'+{'eos':'Drilling operations','account':'Invoices &amp; purchase orders','project':'Planning &amp; people'}[area]+'</div>')
 if area=='eos':s=s.replace('<script src="./workspace/start.js', '<script src="./workspace/eos-overview.js?v=20261108"></script>\n<script src="./workspace/start.js').replace('<div class="drawer-title">DrillOps</div>','<div class="drawer-title">EOS</div>').replace('<div class="drawer-subtitle">EOS</div>','<div class="drawer-subtitle">Drilling operations</div>')
 s=re.sub(r'<title>.*?</title>',f'<title>{title} · DrillOps</title>',s,count=1)
 if area!='account':s=s.replace('<script src="./invoice-ledger.js?v=20261108"></script>','').replace('<link rel="stylesheet" href="./invoice-ledger.css?v=20261108">','')
 if area!='home':
  s=s.replace('<div id="login-screen" class="site">','<div id="login-screen" class="site signin-mode">').replace('Sign in to your workspace.',f'Sign in to {title}.').replace('Operations workspace',title).replace('>DO</div>',f'>{title[:1]}</div>')
 (DOCS/(area+'.html')).write_text('<!-- Generated by scripts/build_workspaces.py. Edit docs/workspace sources. -->\n'+'\n'.join(line.rstrip() for line in s.splitlines())+'\n')
# Legacy sign-in links now enter EOS directly; no app chooser.
(DOCS/'index.html').write_text((DOCS/'eos.html').read_text().replace('class="site signin-mode"','class="site"',1))
(SRC/'apps.json').write_text(json.dumps(APPS,indent=2)+'\n')
