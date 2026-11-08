/* EOS viewing scope is independent of the project destination used for imports. */
let eosScope={project:'',program:''},eosScopeVersion=0,eosReportScopeRows=[];
const applyEosActivityBundle=applyActivityReportBundle;
applyActivityReportBundle=function(bundle){eosReportScopeRows=bundle.activities||[];return applyEosActivityBundle(bundle);};
const eosKnownProjects=new Set();
function rememberEosProjects(rows,complete=true){
 if(rows?.length&&rows.some(r=>r.contractor&&r.contractor!==activeContractor))return;
 if(complete){
 const catalogue=(rows||[]).filter(r=>EosProduction.scopeMatch(r,eosScope));
 filterOpts={dates:[...new Set(catalogue.map(r=>r.date).filter(Boolean))].sort(),holes:[...new Set(catalogue.map(r=>r.hole_num).filter(Boolean))].sort(),sites:[...new Set(catalogue.map(r=>r.site_name).filter(Boolean))].sort(),codes:[...new Set(catalogue.map(r=>r.code).filter(Boolean))].sort(),total_rows:catalogue.length};
 if(eosRawLogsEnabled)for(const [id,key] of [['f-dates','dates'],['f-holes','holes'],['f-sites','sites'],['f-codes','codes']]){const chosen=getSelVals(id);fillSelect(id,filterOpts[key]);if(chosen.length)document.querySelectorAll('#'+id+' option').forEach(o=>o.selected=chosen.includes(o.value));}
 const count=document.getElementById('db-count');if(count)count.textContent=catalogue.length.toLocaleString();
 }
 for(const row of rows||[])if(row.project)eosKnownProjects.add(String(row.project));renderEosScopeControls();}
function renderEosScopeControls(){
 const contractor=document.getElementById('eos-contractor-filter');if(contractor){contractor.innerHTML=contractorsForApp(CONTRACTORS).map(c=>'<option value="'+attr(c.name)+'">'+esc(c.name)+'</option>').join('');contractor.value=activeContractor;}
 const project=document.getElementById('eos-project-filter'),program=document.getElementById('eos-program-filter');if(!project)return;
 const names=[...new Set([...projects.map(p=>p.name),...eosKnownProjects,...(eosScope.project&&eosScope.project!=='__unassigned__'?[eosScope.project]:[])])].filter(Boolean).sort();
 project.innerHTML='<option value="">All projects</option>'+names.map(p=>'<option value="'+attr(p)+'">'+esc(p)+'</option>').join('')+'<option value="__unassigned__">Unassigned project</option>';
 project.value=eosScope.project;if(project.selectedIndex<0){eosScope.project='';project.value='';}
 const programs=[...new Set(PROJECT_PROGRAMS.concat(projects.map(projectProgram)))].filter(Boolean).sort();
 program.innerHTML='<option value="">All programs</option>'+programs.map(p=>'<option value="'+attr(p)+'">'+esc(p)+'</option>').join('');program.value=eosScope.program;
 for(const id of ['workspace-context-label','cost-contract-project-context']){const label=document.getElementById(id);if(label)label.textContent=eosScopeLabel();}
}
function eosScopeLabel(){return (eosScope.project==='__unassigned__'?'Unassigned project':eosScope.project||'All projects')+' / '+(eosScope.program||'All programs');}
function persistEosScope(){sessionStorage.setItem('drillops_eos_view_scope',JSON.stringify(eosScope));}
function setEosScopeState(){
 activeProjectName=eosScope.project==='__unassigned__'?'':eosScope.project;activeProgram=eosScope.program;
 const matching=projects.filter(p=>p.name===activeProjectName&&(!activeProgram||projectProgram(p)===activeProgram));
 const ids=[...new Set(matching.map(p=>p.client_id).filter(Boolean))];activeClientId=ids.length===1?ids[0]:null;
 projectContractorsData=[];renderEosScopeControls();
}
function initializeEosScope(){
 try{const saved=JSON.parse(sessionStorage.getItem('drillops_eos_view_scope')||'null');if(saved&&typeof saved.project==='string'&&typeof saved.program==='string')eosScope=saved;}catch{}
 // An old Account/Project selection does not restrict EOS on first entry.
 if(eosScope.project&&eosScope.project!=='__unassigned__')eosKnownProjects.add(eosScope.project);
 setEosScopeState();document.getElementById('workspace-gate').classList.remove('open');document.body.classList.remove('workspace-locked');
}
async function changeEosScope(reset=false){
 eosScopeVersion++;
 eosScope={project:reset?'':document.getElementById('eos-project-filter').value,program:reset?'':document.getElementById('eos-program-filter').value};
 setEosScopeState();persistEosScope();
 activitiesData=[];consumablesData=[];reportConsumablesData=[];crewData=[];dailyReportsData=[];periodReportActivitiesData=[];periodReportConsumablesData=[];bhData=[];
 selectedCostContractId=null;costContractsData=[];costContractRatesData=[];document.getElementById('cost-contract-detail').innerHTML='';
 productionRawData=[];productionFilteredData=[];filterOpts={dates:[],holes:[],sites:[],codes:[]};
 for(const id of ['f-dates','f-holes','f-sites','f-codes','f-cost-holes','f-cost-dates'])fillSelect(id,[]);
 ensureActiveContractorInProgram();buildContractorSwitcher();syncWorkspaceControls();
 triggerPageLoad(document.querySelector('.page.active')?.id.replace('page-','')||'app-home');
}
function filterEosRows(rows){
 const relatedRows=rows===consumablesData||rows===crewData||rows===reportConsumablesData;
 return (rows||[]).filter(row=>{
  if(row.contractor&&row.contractor!==activeContractor)return false;
  if(!eosScope.project&&!eosScope.program)return true;
  let candidate=row;
  // Related crew/material rows can inherit a report's scope only when it is unambiguous.
  if(relatedRows&&(!row.project||!row.program)&&row.source_file){
   const related=eosReportScopeRows.filter(a=>a!==row&&a.source_file===row.source_file&&a.date===row.date&&(!row.contractor||a.contractor===row.contractor));
   const names=[...new Set(related.map(a=>a.project||''))],programs=[...new Set(related.map(a=>a.program||''))];
   candidate={...row,project:row.project||(names.length===1?names[0]:''),program:row.program||(programs.length===1?programs[0]:'')};
  }
  return EosProduction.scopeMatch(candidate,eosScope);
 });
}
// Imports always carry an explicit client, project and program, regardless of the view filters.
function populateEosImportProjects(){
 const clientSelect=document.getElementById('import-client-select'),select=document.getElementById('import-project-select');if(!select)return;
 const previous=select.value,clientId=Number(clientSelect.value||0);
 select.innerHTML='<option value="">Select project and program</option>'+projects.filter(p=>Number(p.client_id)===clientId&&p.status!=='Inactive').map(p=>'<option value="'+attr(p.id)+'">'+esc(p.name+' / '+workspaceProgramLabel(p,projectProgram(p)))+'</option>').join('');
 select.value=previous;if(select.selectedIndex<0)select.value='';select.disabled=!clientId;
}
populateImportProjectOptions=populateEosImportProjects;
selectedImportScope=function(){
 const clientId=Number(document.getElementById('import-client-select')?.value||0),id=document.getElementById('import-project-select')?.value;
 return {client:clients.find(c=>Number(c.id)===clientId),project:projects.find(p=>String(p.id)===id&&Number(p.client_id)===clientId&&p.status!=='Inactive')};
};
const importClient=document.getElementById('import-client-select');if(importClient){importClient.disabled=false;importClient.addEventListener('change',()=>{document.getElementById('import-project-select').value='';populateEosImportProjects();});}
document.getElementById('eos-project-filter')?.addEventListener('change',()=>changeEosScope());
document.getElementById('eos-program-filter')?.addEventListener('change',()=>changeEosScope());
document.getElementById('eos-clear-scope')?.addEventListener('click',()=>changeEosScope(true));

// Changing a project must never silently switch contractors. All EOS pages share this selection.
switchContractor=async function(name){
 if(!EOS_CONTRACTOR_NAMES.has(name)||!CONTRACTORS.some(c=>c.name===name))return;
 activeContractor=name;sessionStorage.setItem('drillops_contractor',name);eosScopeVersion++;
 activitiesData=[];consumablesData=[];reportConsumablesData=[];crewData=[];dailyReportsData=[];costingHolesData=[];costingDatesData=[];costingLinesData=[];productionRawData=[];productionFilteredData=[];
 filterOpts={dates:[],holes:[],sites:[],codes:[]};eosKnownProjects.clear();
 for(const id of ['f-dates','f-holes','f-sites','f-codes','f-cost-holes','f-cost-dates','production-rig','production-drill-type','eos-period-rig']){const el=document.getElementById(id);if(el)el.value='';}
 for(const id of ['f-dates','f-holes','f-sites','f-codes','f-cost-holes','f-cost-dates'])fillSelect(id,[]);
 selectedCostContractId=null;costContractsData=[];costContractRatesData=[];document.getElementById('cost-contract-detail').innerHTML='';
 for(const id of ['rate-library-summary-body','cost-contract-body'])document.getElementById(id).innerHTML='';
 renderEosScopeControls();buildContractorSwitcher();
 triggerPageLoad(document.querySelector('.page.active')?.id.replace('page-','')||'app-home');
};
