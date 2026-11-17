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
  elif path=='/activity-report-data':data={'activities':[],'consumables':[],'crew':[],'daily_reports':[]}
  elif path=='/invoice-ledger':data={'invoices':[],'purchase_orders':[]}
  route.fulfill(json=data)
 context.route('http://localhost:8000/**',route_api)
 context.set_default_timeout(10000)
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 for app in ['eos','account','project']:
  print('Checking',app,flush=True)
  page.goto('http://localhost:8767/'+app+'.html',wait_until='domcontentloaded')
  page.locator('#business-context').wait_for()
  assert page.locator('.business-role').inner_text()=='Platform Admin'
  if app=='eos':
   page.goto('http://localhost:8767/workspace.html');page.locator('[data-open-project]').click();page.locator('[data-open-app=eos]').click();page.locator('#business-context').wait_for()
  assert page.evaluate("JSON.parse(localStorage.getItem('drillops_business_scope')).campaign_id")==C
  assert page.evaluate("JSON.parse(localStorage.getItem('drillops_business_scope')).project_id")==P
  page.locator('.drawer-nav-item[data-page=workspace-settings]').click(force=True);page.locator('#business-dialog.active').wait_for()
  assert 'Ironbark No1 2026' in page.locator('#business-settings-body').inner_text()
  page.locator('[data-tab=sharing]').click()
  assert page.locator('#business-share button').is_disabled(), 'Protected Platform Admin must not be editable as a share'
  page.locator('[data-tab=people]').click();assert 'Platform Admin' in page.locator('#business-settings-body').inner_text()
  page.goto('http://localhost:8767/'+app+'.html');page.locator('#business-context').wait_for()
  if app=='project':page.screenshot(path=str(ROOT/'business-workspace-desktop.png'),full_page=True)
 print('Checking landing and importer',flush=True)
 page.goto('http://localhost:8767/workspace.html');page.locator('#page-workspace-home.active').wait_for()
 assert 'Exploration' in page.locator('.workspace-projects').inner_text()
 page.screenshot(path=str(ROOT/'workspace-landing-preview.png'),full_page=True)
 page.locator('[data-open-project]').click();page.locator('[data-open-app=eos]').click();page.locator('#business-context').wait_for()
 page.evaluate("sessionStorage.setItem('drillops_contractor','Weatherfords')")
 page.goto('http://localhost:8767/eos.html?view=importer');page.locator('#operational-import-title').wait_for()
 page.wait_for_function("document.querySelector('#operational-import-title').textContent.includes('Weatherfords')")
 assert page.locator('#handwritten-import-card').is_hidden()
 assert 'ARGO NR / Exploration / Ironbark No1 2026' in page.locator('#report-import-destination').inner_text()
 page.locator('#file-input').set_input_files({'name':'logging.pdf','mimeType':'application/pdf','buffer':b'local-test-only'})
 page.locator('#import-btn').click();page.wait_for_function("document.querySelector('#import-log').textContent.includes('1 rows')")
 assert imports and imports[-1][0]['x-campaign-id']==C and imports[-1][0]['x-workspace-id']==W and imports[-1][0]['x-business-project-id']==P
 assert 'Weatherfords' in imports[-1][1] and 'Ironbark' in imports[-1][1] and 'Exploration' in imports[-1][1]
 print('Checking logging report',errors,flush=True)
 page.goto('http://localhost:8767/eos.html?view=reports');page.locator('.service-report h1').wait_for()
 assert 'Logging report' in page.locator('.service-report h1').inner_text()
 page.screenshot(path=str(ROOT/'logging-report-preview.png'),full_page=True)
 assert page.locator('#eos-period-metrics').is_hidden()
 page.goto('http://localhost:8767/eos.html?view=workspace-settings');page.locator('#business-dialog.active').wait_for()
 assert page.locator('#business-dialog').evaluate('(el)=>el.tagName')=='SECTION'
 page.locator('[data-tab=contractors]').click();assert 'Geophysical Logging' in page.locator('#business-settings-body').inner_text()
 page.goto('http://localhost:8767/workspace.html');page.locator('#page-workspace-home.active').wait_for()
 assert page.locator('.workspace-projects [data-open-app]').count()==0
 page.get_by_text('New project',exact=True).click();page.locator('#workspace-create [name=name]').fill('New Project');page.locator('#workspace-create button').click()
 page.get_by_role('heading',name='New Project',exact=True).wait_for()
 page.locator('[data-open-project="55555555-5555-4555-8555-555555555555"]').click()
 page.get_by_text('New campaign',exact=True).click();page.locator('#workspace-create [name=name]').fill('New Campaign 2027');page.locator('#workspace-create [name=year]').fill('2027');page.locator('#workspace-create button').click()
 page.get_by_role('heading',name='New Campaign 2027',exact=True).wait_for()
 page.locator('[data-open-app=account]').click();page.locator('#business-context').wait_for();assert 'New Campaign 2027' in page.locator('#business-context').inner_text()
 page.goto('http://localhost:8767/project.html');page.locator('#business-context').wait_for();assert 'New Campaign 2027' in page.locator('#business-context').inner_text()
 page.goto('http://localhost:8767/eos.html?view=workspace-settings');page.locator('#business-dialog.active').wait_for()
 page.set_viewport_size({'width':390,'height':844});page.evaluate('closeDrawer()');page.locator('.drawer-nav-item[data-page=workspace-settings]').click(force=True);page.locator('#business-dialog.active').wait_for();page.screenshot(path=str(ROOT/'business-workspace-mobile.png'),full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'Mobile horizontal overflow'
 scoped=[h for path,h in requests if not path.startswith(('/mobile/','/platform/')) and h.get('x-campaign-id')==C]
 assert scoped and all(h.get('x-workspace-id')==W and h.get('x-business-project-id')==P for h in scoped)
 assert not [e for e in errors if 'business' in e.lower()],errors
 browser.close()
server.shutdown()
print('PASS shared selection across EOS/Account/Project, scoped requests, protected admin, desktop/mobile settings')
