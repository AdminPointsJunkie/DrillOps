/* Read the existing authenticated workbook source; never duplicate its allocations. */
let projectWorkbookData=null,projectWorkbookError='',projectBudgetRequest=0;
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
 projectWorkbookData=null;projectWorkbookError='';projectBudgetsData=[];
 renderProjectBudgets();
 const host=document.getElementById('project-workbook-budget');host.hidden=false;host.textContent=scope.project?'Loading budget…':'Choose a project using the bottom-left sidebar selector.';
 ['total','drilling','support','rows'].forEach(k=>setPeriodText('budget-kpi-'+k,'—'));
 if(!scope.project)return;
 const results=await Promise.allSettled([fetch(API+'/project-budgets?contractor=Company',{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('Allocations unavailable');const rows=await r.json();if(!Array.isArray(rows))throw new Error('Invalid allocations');return rows;}),loadProjectWorkbook(scope)]);
 if(request!==projectBudgetRequest||JSON.stringify(scope)!==JSON.stringify(projectBudgetScope()))return;
 projectBudgetsData=results[0].status==='fulfilled'?results[0].value:[];
 projectWorkbookData=results[1].status==='fulfilled'?results[1].value:null;
 projectWorkbookError=[results[0].status==='rejected'?'Manual allocations could not load.':'',results[1].status==='rejected'?'Workbook budget could not load. Refresh to retry.':''].filter(Boolean).join(' ');
 renderProjectBudgets();
}
function renderProjectWorkbookBudget(){
 const host=document.getElementById('project-workbook-budget');if(!host)return;
 const source=projectWorkbookData,scope=projectBudgetScope();
 const valid=source&&source.project===scope.project&&Number(source.year)===Number(scope.year)&&scope.program==='Exploration';
 host.hidden=!valid&&!projectWorkbookError;host.innerHTML='';
 const labels=document.querySelectorAll('#page-budget .budget-kpi-row .kpi-label'),notes=document.querySelectorAll('#page-budget .budget-kpi-row .kpi-sub');
 if(labels[0])labels[0].textContent='Project budget';if(labels[3])labels[3].textContent='Budget lines';if(notes[0])notes[0].textContent='Selected project allocations';if(notes[3])notes[3].textContent='Editable allocation rows';
 if(projectWorkbookError&&!valid){host.innerHTML='<p role="alert">'+esc(projectWorkbookError)+'</p>';if(projectWorkbookApplicable(scope)&&!valid){['total','drilling','support','rows'].forEach(k=>setPeriodText('budget-kpi-'+k,'Unavailable'));}return;}
 if(!valid)return;
 const exact=value=>Number(value).toLocaleString('en-AU',{style:'currency',currency:'AUD'});
 host.innerHTML=(projectWorkbookError?'<p role="alert">'+esc(projectWorkbookError)+'</p>':'')+'<div class="pm-panel-heading"><div><h2>Imported workbook budget</h2><p>'+esc(source.source)+'</p></div><strong>'+exact(source.total)+'</strong></div><p class="pm-footnote">'+esc(source.project)+' · '+esc(source.year)+' · Exploration · '+source.boreholes.length+' workbook rows. Comparison total: '+exact(source.comparison_total)+'. This is the revised workbook plan, not a change to approved funding. Manual allocations below are separate and are not added to this total.</p><div class="project-source-categories">'+Object.entries(source.categories).map(([name,value])=>'<div><span>'+esc(name)+'</span><strong>'+exact(value)+'</strong></div>').join('')+'</div><details><summary>View workbook budget by hole</summary><div class="tbl-scroll"><table><thead><tr><th>Hole</th><th>Drilling</th><th>Earthworks</th><th>Geophysical</th><th>Geological support</th><th>Other</th><th>Total</th></tr></thead><tbody>'+source.boreholes.map(h=>'<tr><td>'+esc(h.hole_id||h.site_id)+'</td>'+['drilling_budget_total','earthworks_budget_total','geophysical_budget_total','geological_support_budget_total','misc_budget_total','budget_total'].map(k=>'<td>'+exact(h[k])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></details>';
 setPeriodText('budget-kpi-total',exact(source.total));setPeriodText('budget-kpi-drilling',exact(source.categories.Drilling));setPeriodText('budget-kpi-support',exact(source.total-source.categories.Drilling));setPeriodText('budget-kpi-rows',source.boreholes.length);
 if(labels[0])labels[0].textContent='Workbook plan budget';if(labels[3])labels[3].textContent='Workbook holes';
 if(notes[0])notes[0].textContent='Saved workbook total';if(notes[3])notes[3].textContent='Source rows, including original statuses';
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
 projectWorkbookData=null;projectWorkbookError='';projectBudgetsData=[];projectBudgetRequest++;projectDashboardRequest++;
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
