/* Mastt-informed project overview, using the existing authenticated APIs. */
let projectDashboardRequest = 0;
const pmColours = {Complete:'#315d49','In Progress':'#86a88b',Planned:'#dce6dc',Other:'#a9b4ae'};
const pmMoney = value => value === null ? 'Not set' : new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(value);
const pmExactMoney = value => value === null ? 'Not set' : new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(value);
const pmDate = time => new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',timeZone:'UTC'}).format(time);
const pmEmpty = message => '<p class="pm-empty">'+esc(message)+'</p>';
function pmSet(id, value) { document.getElementById(id).textContent = value; }

function renderProjectDashboard(model) {
  const {budget,budgets,holes,categories,groups,schedule,located,imported} = model;
  const costs=model.costs;
  document.getElementById('pm-costs').innerHTML=costs?[['Accounts invoiced',costs.invoiced],['Open estimated accruals',costs.accruals],['Invoiced + accruals',costs.combined],['Budget less total',budget===null?null:budget-Number(costs.combined)]].map(([label,value])=>'<article class="pm-metric"><span>'+label+'</span><strong>'+pmExactMoney(value)+'</strong></article>').join('')+(Number(costs.missing_amounts)?'<p class="pm-footnote">Partial total: '+Number(costs.missing_amounts)+' invoices have no amount.</p>':''):pmEmpty('Financial totals unavailable.');
  const total = holes?.length ?? null;
  pmSet('pm-budget',budgets === null ? 'Unavailable' : imported ? pmExactMoney(budget) : pmMoney(budget));
  pmSet('pm-budget-label',imported?'Approved budget':'Allocated budget');
  pmSet('pm-budget-note',imported ? 'Original workbook budget · AUD' : budgets?.length ? budgets.length+' allocation lines · AUD' : 'Recorded project allocations · AUD');
  pmSet('pm-total',total === null ? '—' : total.toLocaleString());
  pmSet('pm-complete',total === null ? '—' : groups.Complete.toLocaleString());
  pmSet('pm-scheduled',total === null ? '—' : schedule.length.toLocaleString());
  pmSet('pm-complete-note',total ? groups.Complete+' of '+total+' boreholes in plan' : 'Recorded completion status');
  let offset = 0;
  const segments = Object.entries(groups).map(([status,count]) => {
    const from = offset; offset += total ? count/total*100 : 0;
    return pmColours[status]+' '+from+'% '+offset+'%';
  });
  document.getElementById('pm-progress').innerHTML = total ?
    '<div class="pm-donut" style="background:conic-gradient('+segments.join(',')+')" role="img" aria-label="'+attr(groups.Complete+' of '+total+' boreholes complete')+'"><div><strong>'+Math.round(groups.Complete/total*100)+'%</strong><span>holes complete</span></div></div><div class="pm-legend">'+Object.entries(groups).filter(([,count])=>count).map(([status,count])=>'<div><i style="background:'+pmColours[status]+'"></i><span>'+esc(status)+'</span><strong>'+count+'</strong></div>').join('')+'</div>' : pmEmpty(total === null ? 'Borehole records could not be loaded.' : 'No current-year boreholes recorded for this project.');
  pmSet('pm-budget-chart-title',imported?'Workbook plan by category':'Budget allocation');
  pmSet('pm-budget-chart-note',imported?'Workbook plan costs shown separately from the approved budget.':'Planning allocations by category. These are not expenditure totals.');
  const categoryEntries = Object.entries(categories).sort((a,b)=>b[1]-a[1]);
  const max = Math.max(...categoryEntries.map(([,value])=>Math.abs(value)),1);
  document.getElementById('pm-budget-chart').innerHTML = categoryEntries.length ? categoryEntries.map(([name,value])=>'<div class="pm-allocation"><div><span>'+esc(name)+'</span><strong>'+pmMoney(value)+'</strong></div><div class="pm-bar"><span style="width:'+Math.abs(value)/max*100+'%"></span></div></div>').join('') : pmEmpty(budgets === null ? 'Budget allocations could not be loaded.' : budgets?.length ? 'An allocation amount is missing. Open Budget to complete the records.' : 'No budget allocations recorded.');
  const readiness = [
    [imported?'Approved budget':'Budget allocations',budgets === null ? 'Unavailable' : budget === null ? 'Not set' : 'Recorded',budgets !== null && budget !== null],
    ['Schedule dates',total === null ? 'Unavailable' : schedule.length+' of '+total,!!total && schedule.length === total],
    ['Borehole locations',total === null ? 'Unavailable' : located+' of '+total,!!total && located === total]
  ];
  document.getElementById('pm-readiness').innerHTML = readiness.map(([label,value,ready])=>'<div class="pm-readiness-row"><span>'+label+'</span><strong class="'+(ready?'ready':'incomplete')+'"><i></i>'+esc(value)+'</strong></div>').join('')+'<p class="pm-footnote">Coverage of saved planning records.</p>';
  renderProjectSchedule(schedule,total);
}

function renderProjectSchedule(schedule,total) {
  const target = document.getElementById('pm-schedule');
  if (!schedule.length) {target.innerHTML = pmEmpty(total === null ? 'The schedule could not be loaded.' : 'No complete date ranges recorded. Add start and finish dates in borehole planning.'); return;}
  const rows = schedule.slice(0,8), day = 86400000;
  const min = Math.min(...rows.map(row=>row.start)), max = Math.max(...rows.map(row=>row.end))+day;
  target.innerHTML = '<div class="pm-timeline"><div class="pm-timeline-axis"><span>Borehole / rig</span><div><span>'+pmDate(min)+'</span><span>'+pmDate((min+max)/2)+'</span><span>'+pmDate(max-day)+'</span></div></div>'+rows.map(row=>{
    const colour = pmColours[Object.keys(pmColours).find(key=>key.toLowerCase()===String(row.status).toLowerCase())] || pmColours.Other;
    return '<div class="pm-timeline-row"><div><strong>'+esc(row.hole_id||row.site_id||'Unnamed borehole')+'</strong><small>'+esc(row.assigned_rig||'Rig not assigned')+'</small></div><div class="pm-track"><span style="left:'+((row.start-min)/(max-min)*100)+'%;width:'+((row.end-row.start+day)/(max-min)*100)+'%;background:'+colour+'" title="'+attr(pmDate(row.start)+' – '+pmDate(row.end)+' · '+(row.status||'Status not recorded'))+'"></span></div><small class="pm-date-range">'+pmDate(row.start)+' – '+pmDate(row.end)+'</small></div>';
  }).join('')+'</div><p class="pm-footnote">'+(schedule.length>8?'First 8 of '+schedule.length+' scheduled boreholes, ordered by start date. ':schedule.length+' scheduled boreholes. ')+(total-schedule.length)+' without a complete, valid date range.</p>';
}

async function loadProjectDashboard() {
  const request = ++projectDashboardRequest;
  renderProjectSwitcher();
  const project = activeWorkspaceProject();
  const scope = {project:activeProjectName,program:activeProgram,year:activeProjectYear(),clientId:activeClientId,projectId:project?.id};
  pmSet('pm-title',scope.project || 'Project dashboard');
  pmSet('pm-scope',[clientById(activeClientId)?.name,activeWorkspaceProgramLabel()].filter(Boolean).join(' / '));
  document.getElementById('pm-details').innerHTML = [['Client',clientById(activeClientId)?.name],['Program',activeProgram],['Year',scope.year],['Project status',project?.status]].map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+esc(value||'Not recorded')+'</dd></div>').join('');
  pmSet('pm-message','Loading project records…');
  pmSet('pm-workbook-note','');
  for (const id of ['pm-budget','pm-total','pm-complete','pm-scheduled']) pmSet(id,'—');
  for (const id of ['pm-progress','pm-budget-chart','pm-readiness','pm-schedule','pm-costs']) document.getElementById(id).innerHTML = pmEmpty('Loading…');
  const load = async path => {const response = await fetch(API+path,{cache:'no-store'});if(!response.ok)throw new Error('Request failed');const data=await response.json();if(!Array.isArray(data)||data.some(row=>!row||typeof row!=='object'))throw new Error('Unexpected response');return data;};
  // Name-based legacy endpoints cannot distinguish identically named workspaces.
  const ambiguous = projects.some(item=>item.name===scope.project && projectProgram(item)===scope.program && Number(item.client_id)!==Number(scope.clientId));
  const readCosts=async()=>{const response=await fetch(API+'/account-accruals/project-summary?project_id='+encodeURIComponent(scope.projectId),{cache:'no-store'});if(!response.ok)throw Error('Financial totals unavailable');const value=await response.json();if(!['invoiced','accruals','combined'].every(k=>value[k]!==null&&value[k]!==undefined&&Number.isFinite(Number(value[k]))))throw Error('Invalid financial totals');return value;};
  const results = ambiguous ? [{status:'rejected'},{status:'rejected'},{status:'rejected'},{status:'rejected'}] : await Promise.allSettled([load('/project-budgets?contractor=Company'),load('/boreholes?contractor=Company'),loadProjectWorkbook(scope),readCosts()]);
  if (request !== projectDashboardRequest || activeProjectName !== scope.project || activeProgram !== scope.program || activeClientId !== scope.clientId || activeProjectYear() !== scope.year) return;
  const data = results.map(result=>result.status==='fulfilled'?result.value:null);
  if(results[2].status==='rejected'&&projectWorkbookApplicable(scope))data[0]=null;
  renderProjectDashboard({...ProjectDashboardModel.build(data[0],data[1],scope,data[2]),costs:data[3]});
  if(results[2].status==='rejected' && projectWorkbookApplicable(scope)){pmSet('pm-budget','Unavailable');pmSet('pm-budget-note','Workbook budget could not load');document.getElementById('pm-budget-chart').innerHTML=pmEmpty('Workbook budget could not be loaded. Refresh to retry.');}
  document.getElementById('pm-workbook-note').textContent=data[2] ? 'Workbook plan: '+pmExactMoney(data[2].total)+(data[2].planVariance===null?' · Approved budget not recorded':data[2].planVariance>0?' · '+pmExactMoney(data[2].planVariance)+' above approved budget':data[2].planVariance<0?' · '+pmExactMoney(-data[2].planVariance)+' below approved budget':' · Matches approved budget')+'. Source: '+data[2].source+'.' : '';
  const failed = results.map((result,index)=>result.status==='rejected'?['Budget allocations','Borehole plan','Workbook budget','Financial totals'][index]:null).filter(Boolean);
  pmSet('pm-message',!scope.project?'Choose a project using the bottom-left sidebar selector.':ambiguous?'This project name is shared by another client. Its records cannot be separated reliably in this dashboard.':failed.length?failed.join(' and ')+' could not be loaded. Refresh to try again.':'');
  pmSet('pm-updated',(failed.length?'Last attempted ':'Updated ')+new Date().toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short'}));
}
