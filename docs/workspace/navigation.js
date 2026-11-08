/* App boundaries and navigation. Authentication and project selection stay shared. */
const WORKSPACE_APP = document.body.dataset.workspaceArea || 'eos';
let eosRawLogsEnabled=false;
const EOS_CONTRACTOR_NAMES = new Set(['Mitchells Drilling','DEPCO Drilling']);
function contractorsForApp(rows, field='name'){
 const list=Array.isArray(rows)?rows:[];
 return WORKSPACE_APP==='eos'?list.filter(row=>EOS_CONTRACTOR_NAMES.has(row[field])):list;
}
const WORKSPACE_PAGES = {
 eos:['reports','activities','report-calendar','costing','rates','cost-contracts','importer','settings'],
 account:['accounts-overview','invoices','reconciliation','purchase-orders','contractors','importer'],
 project:['project-dashboard','project-budgets','budget','boreholes','drilling-schedule','reports','admin']
};
function workspacePageStorageKey(){return 'drillops_'+WORKSPACE_APP+'_page';}
function routeWorkspacePage(page){
 if(page==='production'){if(WORKSPACE_APP==='eos')drawerNav(document.querySelector('.drawer-nav-item[data-page="reports"]'));else window.location.assign('./eos.html?view=reports');return true;}
 if(page==='app-home'||WORKSPACE_PAGES[WORKSPACE_APP].includes(page))return false;
 const owner=Object.keys(WORKSPACE_PAGES).find(app=>WORKSPACE_PAGES[app].includes(page));
 if(owner){window.location.assign('./'+owner+'.html?view='+encodeURIComponent(page));return true;}
 return false;
}
function showAppHome(){
 document.querySelectorAll('.page').forEach(node=>node.classList.toggle('active',node.id==='page-app-home'));
 document.getElementById('workspace-gate').classList.remove('open');
 document.body.classList.remove('workspace-locked');
 updateContractorSwitcherVisibility('app-home');
 if(WORKSPACE_APP==='eos'){syncEosRoute('app-home');loadEosOverview();}
}
function openInitialAppPage(){
 let requested=new URLSearchParams(location.search).get('view');
 if(WORKSPACE_APP==='eos'&&requested==='production'){requested='reports';syncEosRoute('reports',true);}
 const page=WORKSPACE_PAGES[WORKSPACE_APP].includes(requested)?requested:({account:'accounts-overview',project:'project-dashboard'}[WORKSPACE_APP]||'');
 if(page&&WORKSPACE_PAGES[WORKSPACE_APP].includes(page)){
  const button=document.querySelector('.drawer-nav-item[data-page="'+page+'"]');
  if(button)drawerNav(button);
 }else showAppHome();
}

function syncEosRoute(page,replace=false){
 if(WORKSPACE_APP!=='eos')return;
 const url=new URL('./eos.html',location.href);if(page!=='app-home')url.searchParams.set('view',page);
 if(url.pathname+url.search!==location.pathname+location.search)history[replace?'replaceState':'pushState']({},'',url);
 document.querySelectorAll('.app-local-nav a,.drawer-nav-item').forEach(el=>{
  const target=el.dataset.page||(el.href?new URL(el.href).searchParams.get('view')||'app-home':'');
  el.classList.toggle('active',target===page);if(target===page)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
 });
}
document.addEventListener('click',event=>{
 if(WORKSPACE_APP!=='eos'||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 const link=event.target.closest('a[href]');if(!link||link.target||link.hasAttribute('download')||document.getElementById('login-screen').style.display!=='none')return;
 const url=new URL(link.href);if(url.origin!==location.origin||!url.pathname.endsWith('/eos.html'))return;
 let view=url.searchParams.get('view')||'app-home';if(view==='production')view='reports';if(view!=='app-home'&&!WORKSPACE_PAGES.eos.includes(view))return;
 event.preventDefault();
 if(view==='app-home'){syncEosRoute(view);showAppHome();closeDrawer();}
 else drawerNav(document.querySelector('.drawer-nav-item[data-page="'+view+'"]'));
});
window.addEventListener('popstate',()=>{if(WORKSPACE_APP==='eos'&&document.getElementById('login-screen').style.display==='none')openInitialAppPage();});
