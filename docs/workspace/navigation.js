/* App boundaries and navigation. Authentication and project selection stay shared. */
const WORKSPACE_APP = document.body.dataset.workspaceArea || 'eos';
const WORKSPACE_PAGES = {
 eos:['reports','activities','production','costing','rates','cost-contracts','importer'],
 account:['invoices','purchase-orders','contractors','importer'],
 project:['project-dashboard','project-budgets','budget','boreholes','admin']
};
function workspacePageStorageKey(){return 'drillops_'+WORKSPACE_APP+'_page';}
function routeWorkspacePage(page){
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
 if(WORKSPACE_APP==='eos')loadEosOverview();
}
function openInitialAppPage(){
 const requested=new URLSearchParams(location.search).get('view');
 const page=WORKSPACE_PAGES[WORKSPACE_APP].includes(requested)?requested:({account:'invoices',project:'project-dashboard'}[WORKSPACE_APP]||'');
 if(page&&WORKSPACE_PAGES[WORKSPACE_APP].includes(page)){
  const button=document.querySelector('.drawer-nav-item[data-page="'+page+'"]');
  if(button)drawerNav(button);
 }else showAppHome();
}
