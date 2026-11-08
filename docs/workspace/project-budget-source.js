/* Read the existing authenticated workbook source; never duplicate its allocations. */
let projectWorkbookData=null,projectWorkbookError='',projectBudgetRequest=0,projectBudgetPlannerRows=null;
function projectBudgetScope(){return {project:activeProjectName,program:activeProgram,year:activeProjectYear(),clientId:activeClientId,projectId:activeWorkspaceProject()?.id};}
function projectWorkbookApplicable(scope){return String(scope.project||'').trim().toLowerCase()==='ironbark'&&scope.program==='Exploration'&&Number(scope.year)===2026;}
async function loadProjectWorkbook(scope){
 if(!projectWorkbookApplicable(scope))return null;
 if(projects.some(p=>p.name===scope.project&&projectProgram(p)===scope.program&&Number(p.client_id)!==Number(scope.clientId)))throw new Error('Ambiguous project');
 const response=await fetch(API+'/project-budget-source?project='+encodeURIComponent(scope.project)+'&year='+encodeURIComponent(scope.year),{cache:'no-store'});
 if(!response.ok)throw new Error('Workbook budget could not load');
 const source=ProjectDashboardModel.workbook(await response.json(),scope);
 if(!source)throw new Error('Workbook does not match this project');
 return source;
}
async function loadProjectBudgetPanel(){
 const request=++projectBudgetRequest,scope=projectBudgetScope();
 projectWorkbookData=null;projectWorkbookError='';projectBudgetsData=[];projectBudgetPlannerRows=null;
 renderProjectBudgets();
 const host=document.getElementById('project-workbook-budget');host.hidden=false;host.textContent=scope.project?'Loading budget…':'Choose a project using the bottom-left sidebar selector.';
 ['total','drilling','support','rows'].forEach(k=>setPeriodText('budget-kpi-'+k,'—'));
 if(!scope.project)return;
 const results=await Promise.allSettled([fetch(API+'/project-budgets?contractor=Company',{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('Allocations unavailable');const rows=await r.json();if(!Array.isArray(rows))throw new Error('Invalid allocations');return rows;}),loadProjectWorkbook(scope),fetch(API+'/boreholes?contractor=Company',{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('Planner unavailable');const rows=await r.json();if(!Array.isArray(rows))throw new Error('Invalid planner response');return rows;})]);
 if(request!==projectBudgetRequest||JSON.stringify(scope)!==JSON.stringify(projectBudgetScope()))return;
 projectBudgetsData=results[0].status==='fulfilled'?results[0].value:[];
 projectBudgetPlannerRows=results[2].status==='fulfilled'?results[2].value:null;
 projectWorkbookData=results[1].status==='fulfilled'?results[1].value:null;
 projectWorkbookError=[results[0].status==='rejected'?'Manual allocations could not load.':'',results[1].status==='rejected'?'Workbook budget could not load. Refresh to retry.':'',results[2].status==='rejected'?'BH Planner statuses could not load; original budgets remain available.':''].filter(Boolean).join(' ');
 renderProjectBudgets();
}
function renderProjectWorkbookBudget(){
 const host=document.getElementById('project-workbook-budget');if(!host)return;
 const source=projectWorkbookData,scope=projectBudgetScope();
 const valid=source&&source.project===scope.project&&Number(source.year)===Number(scope.year)&&scope.program==='Exploration';
 host.hidden=!valid&&!projectWorkbookError;host.innerHTML='';
 document.getElementById('budget-manual-section').open=!valid;
 const labels=document.querySelectorAll('#page-budget .budget-kpi-row .kpi-label'),notes=document.querySelectorAll('#page-budget .budget-kpi-row .kpi-sub');
 if(labels[0])labels[0].textContent='Project budget';if(labels[1])labels[1].textContent='Drilling';if(labels[2])labels[2].textContent='Support / Other';if(notes[1])notes[1].textContent='Drilling contractor allocation';if(notes[2])notes[2].textContent='All non-drilling allocations';if(labels[3])labels[3].textContent='Budget lines';if(notes[0])notes[0].textContent='Selected project allocations';if(notes[3])notes[3].textContent='Editable allocation rows';
 if(projectWorkbookError&&!valid){host.innerHTML='<p role="alert">'+esc(projectWorkbookError)+'</p>';if(projectWorkbookApplicable(scope)&&!valid){['total','drilling','support','rows'].forEach(k=>setPeriodText('budget-kpi-'+k,'Unavailable'));}return;}
 if(!valid)return;
 const exact=value=>value===null?'Not set':Number(value).toLocaleString('en-AU',{style:'currency',currency:'AUD'});
 const ledger=renderBudgetLedger(source);
 setPeriodText('budget-kpi-total',exact(source.approvedBudget));setPeriodText('budget-kpi-drilling',budgetLedgerMoney(ledger.plannedBudget));setPeriodText('budget-kpi-support',budgetLedgerMoney(ledger.remainingBudget));setPeriodText('budget-kpi-rows',source.boreholes.length);
 if(labels[0])labels[0].textContent='Approved budget';if(labels[1])labels[1].textContent='Planned Holes';if(labels[2])labels[2].textContent='Unallocated Budget';if(labels[3])labels[3].textContent='Workbook holes';
 if(notes[0])notes[0].textContent='Original workbook budget';if(notes[1])notes[1].textContent='Original budgets, excluding cancelled holes';if(notes[2])notes[2].textContent='Approved budget minus Planned Holes';if(notes[3])notes[3].textContent='Source rows, including cancelled holes';
}
function renderProjectSwitcher(){
 const button=document.getElementById('project-switcher-button');if(!button)return;
 const current=activeWorkspaceProject();
 document.getElementById('project-switcher-name').textContent=current?.name||'Choose a project';
 document.getElementById('project-switcher-meta').textContent=current?[current.year,projectProgram(current)].filter(Boolean).join(' · '):'Select your workspace';
 const search=document.getElementById('project-switcher-search').value.toLowerCase();
 const options=projects.filter(p=>[p.name,p.year,projectProgram(p),clientById(p.client_id)?.name].join(' ').toLowerCase().includes(search));
 document.getElementById('project-switcher-options').innerHTML=options.map(p=>'<button type="button" data-project-choice="'+Number(p.id)+'" aria-pressed="'+(Number(p.id)===Number(current?.id))+'"><strong>'+esc(p.name)+'</strong><small>'+esc([clientById(p.client_id)?.name,p.year,projectProgram(p),p.status==='Inactive'?'Inactive':''].filter(Boolean).join(' · '))+'</small></button>').join('')||'<p>No matching projects.</p>';
}
function toggleProjectSwitcher(open){
 const panel=document.getElementById('project-switcher-panel'),button=document.getElementById('project-switcher-button');
 const show=open??panel.hidden;panel.hidden=!show;button.setAttribute('aria-expanded',String(show));
 if(show){renderProjectSwitcher();document.getElementById('project-switcher-search').focus();}else button.focus();
}
async function selectProjectWorkspace(id){
 const project=projects.find(p=>Number(p.id)===Number(id));if(!project)return;
 activeClientId=Number(project.client_id)||null;activeProjectName=project.name;activeProgram=projectProgram(project);
 projectWorkbookData=null;projectWorkbookError='';projectBudgetsData=[];projectBudgetPlannerRows=null;projectBudgetRequest++;projectDashboardRequest++;
 saveWorkspaceSelection();syncWorkspaceControls();renderProjectSwitcher();toggleProjectSwitcher(false);closeDrawer();
 const page=document.querySelector('.page.active')?.id.replace('page-','')||'project-dashboard';
 // Refresh immediately so the old project's figures never remain under the new label.
 if(page==='project-dashboard')await loadProjectDashboard();
 else if(page==='budget')await loadProjectBudgets();
 else {const nav=document.querySelector('.drawer-nav-item[data-page="'+page+'"]');if(nav)drawerNav(nav);}
 await loadProjectContractors();ensureActiveContractorInProgram();buildContractorSwitcher();
}
const projectSwitcher=document.getElementById('project-switcher');
projectSwitcher.querySelector('#project-switcher-button').addEventListener('click',()=>toggleProjectSwitcher());
projectSwitcher.querySelector('#project-switcher-search').addEventListener('input',renderProjectSwitcher);
projectSwitcher.addEventListener('click',event=>{const button=event.target.closest('[data-project-choice]');if(button)selectProjectWorkspace(button.dataset.projectChoice);});
document.addEventListener('click',event=>{if(!projectSwitcher.contains(event.target)){document.getElementById('project-switcher-panel').hidden=true;document.getElementById('project-switcher-button').setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.getElementById('project-switcher-panel').hidden){event.preventDefault();toggleProjectSwitcher(false);}});

let projectBudgetStatusRefreshTimer;
function refreshVisibleBudgetStatuses(){
 if(!document.getElementById('page-budget')?.classList.contains('active')||document.getElementById('login-screen')?.style.display!=='none')return;
 clearTimeout(projectBudgetStatusRefreshTimer);projectBudgetStatusRefreshTimer=setTimeout(loadProjectBudgets,150);
}
window.addEventListener('focus',refreshVisibleBudgetStatuses);
window.addEventListener('storage',event=>{if(event.key==='drillops_borehole_status_changed')refreshVisibleBudgetStatuses();});
window.addEventListener('drillops-borehole-status-changed',refreshVisibleBudgetStatuses);
