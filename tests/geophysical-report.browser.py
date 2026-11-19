"""Browser regression: shared hierarchy, admin protection and request scope across all apps."""
import base64,json,threading,time
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
W='a7ecd88b-8ba9-4c5f-80c8-872fcc50f34f';P='11111111-1111-4111-8111-111111111111';C='22222222-2222-4222-8222-222222222222';U='44444444-4444-4444-8444-444444444444'
ctxdata={'user_id':U,'platform_admin':True,'workspaces':[{'id':W,'name':'ARGO NR','role':'owner'}],'projects':[{'id':P,'workspace_id':W,'name':'Exploration'}],'campaigns':[{'id':C,'workspace_id':W,'project_id':P,'name':'Ironbark No1 2026','year':'2026','legacy_name':'Ironbark','legacy_program':'Exploration','client_id':1}],'shares':[]}
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',8767),partial(Quiet,directory=str(ROOT/'docs')))
threading.Thread(target=server.serve_forever,daemon=True).start()
enc=lambda x:base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip('=')
session={'access_token':enc({'alg':'HS256'})+'.'+enc({'iss':'https://dzthwvxrltkltfvubvld.supabase.co/auth/v1','sub':U,'exp':int(time.time())+3600})+'.mock','refresh_token':'mock','expires_at':int(time.time())+3600,'user':{'id':U,'email':'admin@example.test'}}
logging_rows=[
 {'id':1,'contractor':'Weatherfords','project':'Ironbark','program':'Exploration','date':'22/Aug/2026','hole_num':'IB1','drill_rig':'11604','code':'P200','notes':'Logging Run | Sonde DD6640 | E-ticket A1','total_time':'02:00','metres_from':100,'metres_to':0,'line_cost':0,'source_file':'august.pdf'},
 {'id':2,'contractor':'Weatherfords','project':'Ironbark','program':'Exploration','date':'01/Sep/2026','hole_num':'IB2','drill_rig':'11604','code':'P200','notes':'Logging Run | Sonde MS2408 | E-ticket B1','total_time':'01:00','metres_from':150,'metres_to':0,'line_cost':0,'source_file':'september.pdf'},
 {'id':3,'contractor':'Weatherfords','project':'Other','program':'Exploration','date':'01/Sep/2026','hole_num':'HIDDEN','code':'P200','total_time':'10:00','metres_from':999,'metres_to':0,'source_file':'other.pdf'},
]
requests=[];errors=[];imports=[]
with sync_playwright() as p:
 browser=p.chromium.launch(channel='msedge',headless=True)
 context=browser.new_context(viewport={'width':1440,'height':1000})
 context.add_init_script('localStorage.setItem("sb-dzthwvxrltkltfvubvld-auth-token",'+json.dumps(json.dumps(session))+');')
 def route_api(route):
  req=route.request;path=req.url.split(':8000')[-1].split('?')[0];requests.append((path,req.headers))
  data=[]
  if path=='/import':imports.append((req.headers,req.post_data))
  if path=='/mobile/me':data={'name':'Admin','email':'admin@example.test','role':'Platform Admin','owner':True,'management_portal_access':True,'apps':['eos','account','project']}
  elif path=='/platform/context':data=ctxdata
  elif path.endswith('/settings'):data={'people':[{'id':U,'name':'Admin','email':'admin@example.test','role':'owner','status':'active','platform_admin':True,'apps':['eos','account','project']}],'shares':[],'events':[],'contractors':[{'name':'Weatherfords','category':'Geophysical Logging'}],'contractor_types':['Drilling','Geophysical Logging']}
  elif path==f'/platform/workspaces/{W}/projects' and req.method=='POST':
   data={'id':'55555555-5555-4555-8555-555555555555'};ctxdata['projects'].append({'id':data['id'],'workspace_id':W,'name':req.post_data_json['name']})
  elif path==f'/platform/workspaces/{W}/campaigns' and req.method=='POST':
   payload=req.post_data_json;assert payload['project_id']=='55555555-5555-4555-8555-555555555555'
   data={'id':'66666666-6666-4666-8666-666666666666'};ctxdata['campaigns'].append({'id':data['id'],'workspace_id':W,**payload,'legacy_name':payload['name'],'legacy_program':'New Project','client_id':1})
  elif path=='/projects':data=[{'id':4,'name':'Ironbark','program':'Exploration','client_id':1,'status':'Active','year':'2026'}]
  elif path=='/clients':data=[{'id':1,'name':'ARGO NR','status':'Active'}]
  elif path=='/import':data={'status':'imported','contractor':'Weatherfords','rows':1}
  elif path=='/contractors':data=[{'id':2,'name':'Weatherfords','category':'Geophysical Logging','active':True},{'id':1,'name':'Mitchells Drilling','category':'Drilling','program':'Exploration','sites':'Ironbark','active':True}]
  elif path=='/filters':data={'dates':[],'holes':[],'sites':[],'codes':[],'total_rows':0}
  elif path=='/activity-report-data':data={'activities':logging_rows if 'Weatherfords' in req.url else [],'consumables':[],'crew':[],'daily_reports':[]}
  elif path=='/invoice-ledger':data={'invoices':[],'purchase_orders':[]}
  route.fulfill(json=data)
 context.route('http://localhost:8000/**',route_api)
 context.set_default_timeout(10000)
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://localhost:8767/workspace.html');page.locator('[data-open-project]').click();page.locator('#business-campaign').select_option(C)
 page.wait_for_load_state('domcontentloaded')
 page.evaluate("sessionStorage.setItem('drillops_contractor','Weatherfords')")
 page.goto('http://localhost:8767/eos.html?view=reports');page.locator('.geo-cover').wait_for()
 assert '2 e-tickets' in page.locator('.geo-intro').inner_text()
 assert 'HIDDEN' not in page.locator('.geo-document').inner_text()
 assert page.locator('#eos-period-metrics').is_hidden()
 page.locator('[data-from]').fill('2026-09-01');page.locator('[data-from]').dispatch_event('change')
 assert '1 e-tickets' in page.locator('.geo-intro').inner_text()
 page.locator('[data-from]').fill('2026-12-01');page.locator('[data-from]').dispatch_event('change')
 assert 'Choose an end date' in page.locator('[data-results]').inner_text()
 page.locator('[data-all]').click()
 page.set_viewport_size({'width':390,'height':844})
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
 page.set_viewport_size({'width':1440,'height':1000})
 page.evaluate("window.dispatchEvent(new Event('beforeprint'))")
 page.emulate_media(media='print')
 assert page.locator('.geo-document').is_visible()
 assert page.locator('.geo-toolbar').first.is_hidden()
 assert page.locator('.geo-cover').evaluate("e=>getComputedStyle(e).position")=='static'
 page.emulate_media(media='screen');page.evaluate("window.dispatchEvent(new Event('afterprint'))")
 assert not errors,errors
 browser.close()
server.shutdown()
print('PASS logging report scope, date formats, range validation, mobile and print')
