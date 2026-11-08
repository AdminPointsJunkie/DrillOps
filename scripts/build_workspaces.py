"""Build standalone EOS, Account and Project documents from shared auth/shell and owned panels.
Run python3 scripts/build_workspaces.py after editing docs/workspace sources.
"""
from pathlib import Path
import re, json, html
from site_brand import navigation, footer, wordmark
ROOT=Path(__file__).resolve().parents[1]; DOCS=ROOT/'docs'; SRC=DOCS/'workspace'
APPS={
 'eos':{'name':'EOS','tag':'Record the work. Understand the charges.','copy':'Daily reports, production and charges from work completed.','panels':['reports','activities','report-calendar','costing','rates','cost-contracts','importer','settings'],'nav':[('activities','PLODs / Activity Reports'),('report-calendar','Report calendar'),('reports','Production Report'),('costing','Associated charges'),('rates','Rate library'),('cost-contracts','Contracts'),('importer','Import reports'),('settings','Settings')]},
 'account':{'name':'Account','tag':'Your books. Clear and connected.','copy':'Actual invoices, credit notes and purchase orders in one place.','panels':['accounts-overview','invoices','reconciliation','purchase-orders','contractors','importer'],'nav':[('accounts-overview','Overview'),('invoices','Invoice ledger'),('reconciliation','Reconciliation'),('purchase-orders','Purchase orders'),('contractors','Suppliers'),('importer','Import invoices')]},
 'project':{'name':'Project','tag':'Plan the program. Keep it moving.','copy':'Projects, borehole planning, maps and budget allocations.','panels':['project-dashboard','project-budgets','budget','boreholes','reports','admin'],'nav':[('project-dashboard','Dashboard'),('project-budgets','Projects'),('boreholes','Borehole planning & map'),('budget','Budget planning'),('reports','Hole-by-hole report'),('admin','Users & change log')]}}
shell=(SRC/'shell.html').read_text()
shell=re.sub(r'<nav class="site-nav".*?</nav>',navigation(),shell,flags=re.S)
shell=re.sub(r'<footer class="site-footer".*?</footer>',footer(),shell,flags=re.S)
shell=shell.replace('{{company-home}}',(DOCS/'website/home.html').read_text())
# Same simple line icons used in FieldMaps' navigation.
ICONS={'calendar':'M3 5h18v16H3zM3 10h18M7 3v4M17 3v4M7 14h2M15 14h2M7 18h2M15 18h2','overview':'M3 3h7v10H3zM14 3h7v6h-7zM3 17h7v4H3zM14 13h7v8h-7z',
 'report':'M5 3h14v13l-5 5H5zM14 21v-5h5M8 7h8M8 11h6',
 'table':'M3 4h18v16H3zM3 9h18M9 9v11M15 9v11',
 'layers':'M3 7l9-5 9 5-9 5zM3 12l9 5 9-5M3 17l9 5 9-5',
 'upload':'M12 16V3M7 8l5-5 5 5M4 15v6h16v-6',
 'settings':'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
 'chart':'M4 3v17h17M8 15v-4M13 15V7M18 15V4',
 'people':'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M17 4a4 4 0 0 1 0 7M22 21v-2a4 4 0 0 0-3-3.9'}
PAGE_ICONS={'accounts-overview':'overview','reconciliation':'chart','report-calendar':'calendar','settings':'settings','activities':'report','reports':'report','production':'chart','costing':'chart','rates':'table','cost-contracts':'report','importer':'upload','invoices':'table','purchase-orders':'report','contractors':'people','project-dashboard':'overview','project-budgets':'layers','boreholes':'layers','budget':'chart','admin':'settings','training':'people'}
def icon(name):
 return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+ICONS[name]+'"/></svg>'
def link(area,page,label,css='app-task'):
 return f'<a class="{css}" href="./{area}.html?view={page}">{html.escape(label)}<span aria-hidden="true">↗</span></a>'
for area,cfg in APPS.items():
 title=cfg['name'];nav='<div class="drawer-section"><div class="drawer-section-title">'+{'eos':'Operations','account':'Accounting','project':'Project management'}[area]+'</div>'
 if area=='eos':nav+='<a class="drawer-nav-item" href="./eos.html">'+icon('overview')+'<span>Overview</span></a>'
 settings_pages={'project-budgets','admin'} if area=='project' else set()
 for page,label in cfg['nav']:
  if page in settings_pages:continue
  nav+=f'<button class="drawer-nav-item" data-page="{page}" onclick="drawerNav(this)">'+icon(PAGE_ICONS[page])+f'<span>{label}</span></button>'
 if area=='project':nav+='<a class="drawer-nav-item" href="./training.html">'+icon('people')+'<span>Training matrix</span></a>'
 nav+='</div>'
 if area=='project':
  nav+='<div class="drawer-section project-settings-section"><div class="drawer-section-title">Settings</div>'
  for page,label in cfg['nav']:
   if page in settings_pages:nav+=f'<button class="drawer-nav-item" data-page="{page}" onclick="drawerNav(this)">'+icon(PAGE_ICONS[page])+f'<span>{label}</span></button>'
  nav+='</div>'
 home=(SRC/'eos-home.html').read_text() if area=='eos' else ''
 s=shell.replace('{{navigation}}',nav).replace('{{area}}',area).replace('{{label}}',title).replace('{{home}}',home)
 s=s.replace('{{app-wordmark}}',wordmark(title,'./'+area+'.html',stacked=True))
 if area=='eos':
  scope=(SRC/'eos-scope.html').read_text()
  s=s.replace('{{area-navigation}}',scope+'{{area-navigation}}')
 local_links=''.join(link(area,p,l,'app-nav-link') for p,l in cfg['nav'] if p not in settings_pages)
 if area=='project':local_links+='<a href="./training.html">Training matrix</a><details class="project-mobile-settings"><summary>Settings</summary>'+''.join(link(area,p,l,'app-nav-link') for p,l in cfg['nav'] if p in settings_pages)+'</details>'
 if area=='eos':local_links='<a href="./eos.html">Overview</a>'+local_links
 s=s.replace('{{area-navigation}}','<nav class="app-local-nav" aria-label="'+title+' navigation">'+local_links+'</nav>')
 s=s.replace('<a class="logo" href="./index.html" aria-label="DrillOps home">Drill<span>Ops</span></a><span class="workspace-area-name">'+title+'</span>',f'<a class="workspace-area-name" href="./{area}.html" aria-label="{title} home"><span class="mobile-company">DrillOps </span>{title}</a>')

 def panel(m):
  name=m[1]
  if name not in cfg['panels']:return ''
  value=(SRC/'panels'/('eos-period.html' if area=='eos' and name=='reports' else f'{name}.html')).read_text().replace('class="page active"','class="page"')
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
  if name=='importer' and area=='eos':
   value=value.replace('Workspace client','Import client').replace('Workspace project','Project / program').replace('Selected workspace','Import destination')
  if area=='eos':
   value=value.replace('onclick="loadActivities()">Refresh','onclick="refreshEosPage(\'activities\')">Refresh').replace('onclick="loadCosting()">Refresh','onclick="refreshEosPage(\'costing\')">Refresh')
  return value
 s=re.sub(r'\{\{panel:([^}]+)\}\}',panel,s)
 s=s.replace('</head>','<link rel="stylesheet" href="./workspace/app-style.css?v=20261108">\n</head>')
 if area=='account':
  s=s.replace('</head>','<link rel="stylesheet" href="./workspace/accounts-overview.css?v=20261108-1"></head>').replace('<script src="./workspace/start.js','<script src="./workspace/accounts-overview-model.js?v=20261108-1"></script>\n<script src="./workspace/accounts-overview.js?v=20261108-1"></script>\n<script src="./workspace/start.js')
  s=s.replace('</head>','<link rel="stylesheet" href="./workspace/reconciliation.css?v=20261108-1"></head>').replace('<script src="./workspace/start.js','<script src="./workspace/reconciliation-model.js?v=20261108-1"></script>\n<script src="./workspace/reconciliation.js?v=20261108-1"></script>\n<script src="./workspace/start.js')
 if area=='project':
  s=s.replace('</head>','<link rel="stylesheet" href="./workspace/project-budget-ledger.css?v=20261108-livestatus1"></head>')
  s=s.replace('<script src="./workspace/start.js','<script src="./workspace/project-budget-ledger-model.js?v=20261108-livestatus1"></script>\n<script src="./workspace/project-budget-ledger.js?v=20261108-livestatus1"></script>\n<script src="./workspace/start.js')
  s=s.replace('</head>','<link rel="stylesheet" href="./workspace/project-dashboard.css?v=20261108-report1">\n</head>')
  s=s.replace('<script src="./workspace/start.js','<script src="./workspace/project-dashboard-model.js?v=20261108-approved1"></script>\n<script src="./workspace/project-dashboard.js?v=20261108-approved1"></script>\n<script src="./workspace/start.js')
 if area=='project':
  s=s.replace('  </div>\n</div>\n\n<!-- Header -->','  </div>\n'+(SRC/'project-switcher.html').read_text()+'\n</div>\n\n<!-- Header -->')
  s=s.replace('<script src="./workspace/start.js','<script src="./workspace/project-budget-source.js?v=20261108-livestatus1"></script>\n<script src="./workspace/start.js')
 s=s.replace('<div class="drawer-title">DrillOps</div>',f'<div class="drawer-title">{title}</div>').replace(f'<div class="drawer-subtitle">{title}</div>','<div class="drawer-subtitle">'+{'eos':'Drilling operations','account':'Invoices &amp; purchase orders','project':'Planning &amp; people'}[area]+'</div>')
 if area=='eos':s=s.replace('</head>','<link rel="stylesheet" href="./workspace/eos-production.css?v=20261108-standby1"></head>').replace('<script src="./workspace/runtime.js','<script src="./workspace/eos-production-model.js?v=20261108-holes1"></script>\n<script src="./workspace/runtime.js').replace('<script src="./workspace/start.js', '<script src="./workspace/eos-data-cache.js?v=20261108-speed1"></script>\n<script src="./workspace/eos-scope.js?v=20261108-plods1"></script>\n<script src="./workspace/eos-production.js?v=20261108-register4"></script>\n<script src="./workspace/start.js').replace('<script src="./workspace/start.js', '<script src="./workspace/eos-shift-charges.js?v=20261108-report2"></script>\n<script src="./workspace/eos-weather.js?v=20261108-report2"></script>\n<script src="./workspace/eos-period.js?v=20261108-holes1"></script>\n<script src="./workspace/eos-overview.js?v=20261108-plods1"></script>\n<script src="./workspace/start.js').replace('<div class="drawer-title">DrillOps</div>','<div class="drawer-title">EOS</div>').replace('<div class="drawer-subtitle">EOS</div>','<div class="drawer-subtitle">Drilling operations</div>')
 if area=='eos':s=s.replace('<script src="./workspace/start.js','<script src="./workspace/eos-standby-details.js?v=20261108-standby1"></script>\n<script src="./workspace/start.js')
 if area=='eos':s=s.replace('</head>','<link rel="stylesheet" href="./workspace/eos-calendar.css?v=20261108-calendar1"></head>').replace('<script src="./workspace/start.js','<script src="./workspace/eos-calendar-model.js?v=20261108-calendar1"></script>\n<script src="./workspace/eos-calendar.js?v=20261108-calendar1"></script>\n<script src="./workspace/start.js')
 if area=='eos':s=s.replace('<script src="./workspace/start.js','<script src="./workspace/eos-settings.js?v=20261108-standby1"></script>\n<script src="./workspace/eos-sections.js?v=20261108-report2"></script>\n<script src="./workspace/start.js')
 s=re.sub(r'<title>.*?</title>',f'<title>{title} · DrillOps</title>',s,count=1)
 if area!='account':s=s.replace('<script src="./invoice-ledger.js?v=20261108"></script>','').replace('<link rel="stylesheet" href="./invoice-ledger.css?v=20261108">','')
 if area!='home':
  s=s.replace('<div id="login-screen" class="site">','<div id="login-screen" class="site signin-mode">').replace('Sign in to your workspace.',f'Sign in to {title}.').replace('Operations workspace',title).replace('>DO</div>',f'>{title[:1]}</div>')
 s=s.replace('<div class="login-copy"><div class="kicker">DrillOps</div>', '<div class="login-copy">'+wordmark(title,'./'+area+'.html'))
 s=s.replace('Access your DrillOps workspace',f'Access your {title} workspace')
 s=s.replace('Sign in to review daily reports and manage your drilling program.',cfg['copy'])
 s=s.replace('</head>','<link rel="stylesheet" href="./brand.css?v=20261108-fieldmaps1">\n</head>')
 (DOCS/(area+'.html')).write_text('<!-- Generated by scripts/build_workspaces.py. Edit docs/workspace sources. -->\n'+'\n'.join(line.rstrip() for line in s.splitlines())+'\n')
# Keep the homepage public until explicit sign-in or recovery.
homepage=(DOCS/'eos.html').read_text().replace('class="site signin-mode"','class="site"',1)
homepage=homepage.replace('<body ','<body data-public-home="true" ',1).replace('<title>EOS · DrillOps</title>','<title>DrillOps</title>')
homepage=homepage.replace('class="page active eos-dashboard"','class="page eos-dashboard"',1)
(DOCS/'index.html').write_text(homepage)
(SRC/'apps.json').write_text(json.dumps(APPS,indent=2)+'\n')
