import {evidence, readiness, requirement, recordStatus, todayISO, evidenceType, evidenceTypes, recordDueDate} from './logic.mjs?v=20260911-evidence';
import {sectionColours, trainingSections, orderedTrainingColumns} from './sections.mjs?v=20260911-section-editor';
const $ = (s,root=document)=>root.querySelector(s);
const $$ = (s,root=document)=>[...root.querySelectorAll(s)];
const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = s => s ? new Date(s+'T00:00:00').toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'}) : 'Not recorded';
const shortDate = s => s ? new Date(s+'T00:00:00').toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'2-digit'}) : 'No expiry date';
const kindLabel={qualification:'Qualification / RII',site_authorisation:'Site authorisation',voc:'VOC / RCC',site_training:'Site training',medical:'Medical',licence:'Licence',transcript:'Transcript',other:'Other evidence'};
const evidenceStatusLabel=(r,status)=>status==='expired'&&r?.renewalDue&&!r.expires&&r.reportedStatus!=='Expired'?'Renewal overdue':statusLabel[status];
const statusLabel = {current:'Current',soon:'Due soon',expired:'Expired',missing:'No record',unmapped:'Unmapped',review:'Review',na:'Not applicable'};
let state, view='matrix', category='All training', selectedRole='Driller', horizon=90, today=todayISO();
let importing=false;
const API = ['localhost','127.0.0.1'].includes(location.hostname) ? 'http://localhost:8000' : 'https://api.drillops.com.au';
let contractor = new URLSearchParams(location.search).get('contractor') || sessionStorage.getItem('drillops_contractor') || 'DEPCO Drilling';
const ALL_CONTRACTORS='All contractors';
let workspaceContractor=contractor===ALL_CONTRACTORS?'DEPCO Drilling':contractor;
const endpoint = (path,scope=workspaceContractor) => API+'/training/'+path+'?contractor='+encodeURIComponent(scope);
let sourceBlobUrl;


async function api(path, body, method="POST", scope=workspaceContractor) {
  const response=await fetch(endpoint(path,scope),body?{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,revision:state?.revision})}:{cache:'no-store'});
  const data=await response.json();
  if(!response.ok) throw new Error((typeof data.detail==='string'?data.detail:data.error)||'Request failed');
  return data;
}
function notify(message,error=false) { $('#notice').innerHTML=`<div class="notice ${error?'error':''}">${esc(message)}</div>`; }
async function refresh() {
  let snapshot=await api('state');
  if(contractor===ALL_CONTRACTORS){
    const snapshots=await Promise.all(snapshot.contractors.map(c=>c===workspaceContractor?snapshot:api('state',null,'GET',c)));
    // Keep the complete view atomic: never show a partial workforce after a failed request.
    if(snapshots.some(s=>s.revision!==snapshot.revision))throw new Error('Requirements changed while loading. Reload to get a consistent matrix.');
    workspaceContractor=snapshot.contractors[0]||workspaceContractor;
    snapshot={...snapshot,people:snapshots.flatMap((s,i)=>s.people.map(p=>({...p,recordId:p.id,id:JSON.stringify([snapshot.contractors[i],p.id]),contractor:snapshot.contractors[i]})))};
  }else{
    if(snapshot.contractors.length&&!snapshot.contractors.includes(contractor)){
      contractor=snapshot.contractors.includes('DEPCO Drilling')?'DEPCO Drilling':snapshot.contractors[0];
      workspaceContractor=contractor;
      history.replaceState(null,'','./training.html?contractor='+encodeURIComponent(contractor));
      snapshot=await api('state');
    }
    snapshot={...snapshot,people:snapshot.people.map(p=>({...p,contractor}))};
  }
  state=snapshot;
  render();
}
function openDialog(title,subtitle,body) {
  $('#dialog-body').innerHTML=`<div class="dialog-header"><div><div class="eyebrow">TRAINING WORKSPACE</div><h2 id="dialog-title">${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="close" aria-label="Close dialog">×</button></div><div class="dialog-content">${body}</div>`;
  $('#dialog').setAttribute('aria-labelledby','dialog-title');
  $('.close',$('#dialog')).onclick=()=>$('#dialog').close();
  if(!$('#dialog').open) $('#dialog').showModal();
  $('#dialog').scrollTop=0;
}
function roleOptions(value,all=false) { return `${all?'<option value="all">All roles</option>':''}${['Unassigned',...Object.keys(state.roles)].map(r=>`<option ${r===value?'selected':''}>${esc(r)}</option>`).join('')}`; }
function groups() { return trainingSections(state).map(s=>s.name); }
function sectionColour(name) { return trainingSections(state).find(s=>s.name===name)?.colour||'slate'; }
function sectionAttrs(name) { return `data-training-group="${esc(name)}" data-section-colour="${esc(sectionColour(name))}"`; }
function render() {
  $('#report-count').textContent=state.people.reduce((total,p)=>total+1+(p.documents?.length||0),0);
  $('#contractor-select').innerHTML=[ALL_CONTRACTORS,...state.contractors].map(c=>`<option ${c===contractor?'selected':''}>${esc(c)}</option>`).join('');
  $('#contractor-select').disabled=importing;
  $('#contractor-select').onchange=e=>{location.href='./training.html?contractor='+encodeURIComponent(e.target.value);};
  $('#as-of').textContent='As of '+date(today);
  const currentFilter=$('#role-filter').value||'all';
  $('#role-filter').innerHTML=roleOptions(currentFilter,true);
  renderMatrix();
  if(view==='roles') renderRoles();
  if(view==='library') renderLibrary();
  if(view==='imports') renderImports();
}
function switchView(next) {
  view=next;
  if(next!=='imports') $('#imports-view').innerHTML='';
  const titles={matrix:['Training matrix','One view of your people, their training and what comes next.'],roles:['Role requirements','Shared across all contractors. Define minimum training and optional skills once for each role.'],library:['Training library','Shared across all contractors. Connect matrix columns to exact competencies in your reports.'],imports:['PDF reports','Import cardholder reports to keep your training evidence up to date.']};
  $('#page-title').textContent=titles[view][0];$('#breadcrumb').textContent=titles[view][0];$('#page-description').textContent=titles[view][1];
  for(const v of ['matrix','roles','library','imports']) $('#'+v+'-view').hidden=v!==view;
  $$('.nav').forEach(b=>{const active=b.dataset.view===view;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  render();
}
function filteredPeople() {
  const term=$('#search').value.toLowerCase(), role=$('#role-filter').value, attention=$('#status-filter').value;
  return state.people.filter(p=>p.name.toLowerCase().includes(term)&&(role==='all'||p.role===role)&&
    (attention==='all'||(attention==='unassigned'&&p.role==='Unassigned')||(attention==='gaps'&&readiness(state,p,today,horizon).gaps.length)||(attention==='soon'&&state.columns.some(c=>evidence(p,c,today,horizon).status==='soon'))));
}
function renderMatrix() {
  if(category!=='All training'&&!groups().includes(category))category='All training';
  $('#categories').innerHTML=['All training',...groups()].map(g=>`<button class="chip ${category===g?'active':''}" aria-pressed="${category===g}" data-category="${esc(g)}" data-section-colour="${esc(sectionColour(g))}">${esc(g)}</button>`).join('');
  $$('#categories button').forEach(b=>b.onclick=()=>{category=b.dataset.category;renderMatrix();});
  const columns=orderedTrainingColumns(state).filter(c=>category==='All training'||c.group===category);
  $('#empty-section').hidden=columns.length>0;
  $('#empty-section-name').textContent=category==='All training'?'No training columns yet':category;
  $('#matrix-scroll').hidden=!columns.length;
  const sectionClass=i=>i===0||columns[i-1].group!==columns[i].group?' section-start':'';
  const people=filteredPeople();$('#people-count').textContent=people.length;
  let groupHeaders='';
  for(let i=0;i<columns.length;) {
    const group=columns[i].group;let count=1;while(columns[i+count]?.group===group)count++;
    groupHeaders+=`<th class="group-head" ${sectionAttrs(group)} colspan="${count}" scope="colgroup"><span>${esc(group)}</span></th>`;i+=count;
  }
  const head=`<thead><tr><th class="person-head" rowspan="2" scope="col">Personnel <p style="font-size:10px;font-weight:400;margin:8px 0 0">Role & minimum requirements</p></th>${groupHeaders}</tr><tr>${columns.map((c,i)=>`<th class="course-head${sectionClass(i)}" ${sectionAttrs(c.group)} scope="col"><button data-edit-column="${esc(c.id)}" title="Edit mapping: ${esc(c.label)}">${esc(c.label)}${!c.aliases.length?' ◇':''}${c.evidenceType?`<small class="course-kind">${esc(kindLabel[c.evidenceType])}</small>`:''}</button></th>`).join('')}</tr></thead>`;
  let body='';
  for(const role of [...Object.keys(state.roles),'Unassigned']) {
    const list=people.filter(p=>p.role===role);if(!list.length)continue;
    body+=`<tr class="role-row"><th colspan="${columns.length+1}"><span>${esc(role)} <small> / ${list.length} ${list.length===1?'person':'people'}</small></span></th></tr>`;
    body+=list.map(p=>{
      const r=readiness(state,p,today,horizon);
      return `<tr class="person-row"><td class="person-cell"><div class="person-name"><span class="avatar">${esc(p.name.split(' ').map(s=>s[0]).slice(0,2).join(''))}</span><button class="person-records" data-person-records="${esc(p.id)}" title="View all training records and documents">${esc(p.name)}</button></div><div class="person-meta"><small class="person-contractor">${esc(p.contractor)}</small><select data-person="${esc(p.id)}" aria-label="Role for ${esc(p.name)}">${roleOptions(p.role)}</select><small title="${esc(r.label)}">${r.total?`${r.met}/${r.total} minimum`:'Setup needed'}</small>${r.gaps.length?`<small class="minimum-gap-flag" title="${esc(r.gaps.map(c=>c.label).join(', '))}">⚑ ${r.gaps.length} minimum unmet</small>`:''}</div></td>${columns.map((c,i)=>{
        const e=evidence(p,c,today,horizon), req=requirement(state,p,c), status=req==='na'?'na':e.status;
        const icon={current:'✓',soon:'◷',expired:'!',missing:'—',unmapped:'◇',review:'?',na:'·'}[status];
        const minimumGap=r.gaps.some(g=>g.id===c.id);
        return `<td class="matrix-cell${sectionClass(i)}" ${sectionAttrs(c.group)}><button class="cell-button ${status}${minimumGap?' minimum-gap':''}" data-person-cell="${esc(p.id)}" data-column="${esc(c.id)}" title="${esc(p.name+' · '+c.label+' · '+statusLabel[status]+' · '+(req==='minimum'?'Minimum':req==='na'?'Not applicable':'Optional / not configured'))}" aria-label="${esc(p.name+', '+c.label+', '+statusLabel[status]+(minimumGap?', minimum requirement unmet':''))}">${minimumGap?'<small class="minimum-gap-label">⚑ Minimum unmet</small>':''}${req==='minimum'?'<b class="required-dot">●</b>':''}<span>${icon} ${evidenceStatusLabel(e.best,status)}</span>${e.best&&status!=='na'?`<small>${esc(shortDate(recordDueDate(e.best)))}</small>`:''}</button></td>`;
      }).join('')}</tr>`;
    }).join('');
  }
  if(!people.length) body=`<tr><td colspan="${columns.length+1}" class="empty">${state.people.length?'No people match these filters.':'Import your first Cardholder Report to populate the matrix.'}</td></tr>`;
  $('#matrix').innerHTML=head+`<tbody>${body}</tbody>`;
  $$('[data-person]').forEach(s=>s.onchange=async()=>{try{const p=state.people.find(p=>p.id===s.dataset.person);await api('person',{id:p.recordId||p.id,role:s.value},'POST',p.contractor);await refresh();notify('Role assignment saved.');}catch(e){notify(e.message,true);await refresh();}});
  $$('[data-person-cell]').forEach(b=>b.onclick=()=>showEvidence(b.dataset.personCell,b.dataset.column));
  $$('[data-edit-column]').forEach(b=>b.onclick=()=>editColumn(b.dataset.editColumn));
}
function sourceButton(sourceId, source, page=1, scope=workspaceContractor) {
  return `<button class="button" data-source-contractor="${esc(scope)}" data-source-id="${esc(sourceId)}" data-source-page="${Number(page)||1}" data-source-name="${esc(source)}">Open source PDF · page ${Number(page)||1} ↗</button>`;
}
function recordCard(p,r,used=false) {
  const status=recordStatus(r,today,horizon);
  return `<article class="evidence-record"><div class="record-tags"><span class="pill">${esc(evidenceTypes[evidenceType(r)]||'Other evidence')}</span>${r.transcriptCategory?`<span class="pill">${esc(r.transcriptCategory)}</span>`:''}<span class="pill evidence-${status}">${evidenceStatusLabel(r,status)}${used?' · used in matrix':''}</span></div><h3>${esc(r.name)}</h3>${r.unitCode?`<p>Unit / qualification: <strong>${esc(r.unitCode)}</strong></p>`:''}${r.relatedUnitCodes?.length?`<p>Related RII: ${esc(r.relatedUnitCodes.join(', '))}. This record provides ${esc(evidenceTypes[evidenceType(r)]?.toLowerCase()||'supporting evidence')}, not an RII award.</p>`:''}<div class="evidence-grid"><div><small>Issue / completion date</small>${date(r.issued)}</div><div><small>Document expiry</small>${date(r.expires)}</div>${r.renewalDue?`<div><small>Renewal due · ${r.renewalBasis==='supplied_filename'?'supplied filename':'source document'}</small>${date(r.renewalDue)}</div>`:''}<div><small>Location / scope</small>${esc(r.location||'Not recorded')}</div><div><small>Issuer</small>${esc(r.issuer||'Not recorded')}</div>${r.reportDate?`<div><small>Transcript / report date</small>${date(r.reportDate)}</div>`:''}</div>${r.notes?`<p class="${r.reviewRequired?'data-warning':'record-note'}">${esc(r.notes)}</p>`:''}<p class="record-source">${esc(r.source||p.source)}</p>${sourceButton(r.sourceId||p.sourceId,r.source||p.source,r.page,p.contractor)}</article>`;
}
function showPersonRecords(id) {
  const p=state.people.find(p=>p.id===id);if(!p)return;
  const sections=Object.entries(evidenceTypes).map(([type,label])=>{
    const records=p.records.filter(r=>evidenceType(r)===type);
    return records.length?`<details class="record-section" ${type==='qualification'?'open':''}><summary>${esc(label)} <span class="count">${records.length}</span></summary>${records.map(r=>recordCard(p,r)).join('')}</details>`:'';
  }).join('');
  openDialog(p.name+' · Training records',p.role+' · '+p.contractor,`<p>Qualifications, VOCs and site authorisations are assessed separately. Each record retains its own scope, dates and source. Renewal dates from supplied filenames are shown separately from document expiry.</p>${sections}<details class="record-section"><summary>Source documents <span class="count">${1+(p.documents||[]).length}</span></summary><article class="evidence-record"><h3>${esc(p.source)}</h3>${sourceButton(p.sourceId,p.source,1,p.contractor)}</article>${(p.documents||[]).map(d=>`<article class="evidence-record"><h3>${esc(d.filename)}</h3><p>${esc(d.notes||'Supporting document')}</p>${sourceButton(d.sourceId,d.filename,1,p.contractor)}</article>`).join('')}</details>`);
}
function showEvidence(personId,columnId) {
  const p=state.people.find(p=>p.id===personId),c=state.columns.find(c=>c.id===columnId),e=evidence(p,c,today,horizon),req=requirement(state,p,c);
  openDialog(c.label,p.name+' · '+p.role,`<div class="panel-heading"><span class="pill evidence-${e.status}">${statusLabel[e.status]}</span><span class="pill">${req==='minimum'?'Minimum requirement':req==='na'?'Not applicable':'Optional / not configured'}</span></div>${c.evidenceType?`<p>Evidence required: <strong>${esc(evidenceTypes[c.evidenceType])}</strong></p>`:''}${c.note?`<p>${esc(c.note)}</p>`:''}<p>Current evidence is preferred over expired history. Each document keeps its own issue date, expiry and source. A qualification does not establish site authorisation.</p>${!e.records.length?`<div class="data-warning">${e.status==='unmapped'?'This column has no competency mapping. Select exact report names before assessing this requirement.':'No matching evidence of the required type was found. This does not prove that training was never completed.'}</div>`:''}${e.records.map((r,i)=>recordCard(p,r,i===0)).join('')}<div class="actions"><button class="button" data-person-records="${esc(p.id)}">All training records & documents</button><button class="button" id="evidence-mapping">Edit competency mapping</button></div>`);
  $('#evidence-mapping').onclick=()=>editColumn(c.id);
}
function renderRoles() {
  if(!Object.keys(state.roles).length){
    $('#roles-view').innerHTML='<div class="panel"><h2>No roles yet</h2><p>Add a role to define minimum and optional training requirements. All personnel and their evidence are retained.</p><button class="button primary" id="new-role">＋ Add role</button></div>';
    $('#new-role').onclick=showNewRole;return;
  }
  if(!state.roles[selectedRole])selectedRole=Object.keys(state.roles)[0];
  const values=state.roles[selectedRole]||{};
  $('#roles-view').innerHTML=`<div class="role-layout"><div><div class="section-label">Shared roles</div>${Object.entries(state.roles).map(([r,req])=>`<button class="role-choice ${r===selectedRole?'active':''}" data-role-choice="${esc(r)}"><strong>${esc(r)}</strong><small>${Object.values(req).filter(v=>v==='minimum').length} minimum · ${state.people.filter(p=>p.role===r).length} people here</small></button>`).join('')}<button class="button" id="new-role">＋ Add role</button></div><form id="role-form" class="panel"><div class="panel-heading"><div><h2>${esc(selectedRole)}</h2><p>These requirements apply to this role across all contractors.</p></div><div class="role-actions"><button class="button danger" type="button" id="remove-role">Remove role</button><button class="button primary" type="submit">Save requirements</button></div></div><p>Choose <strong>Minimum</strong>, <strong>Optional</strong> or <strong>Not applicable</strong> for each competency. Roles with no minimum requirements remain unconfigured.</p><table class="form-table"><thead><tr><th>TRAINING</th><th>REQUIREMENT</th></tr></thead><tbody>${orderedTrainingColumns(state).map(c=>`<tr><td>${esc(c.label)}<small>${esc(c.group)}${!c.aliases.length?' · mapping needed':''}</small></td><td><select name="${esc(c.id)}" aria-label="Requirement for ${esc(c.label)}">${[['optional','Optional'],['minimum','Minimum'],['na','Not applicable']].map(([v,l])=>`<option value="${v}" ${(values[c.id]||'optional')===v?'selected':''}>${l}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table><div class="actions"><button type="submit" class="button primary">Save requirements</button></div></form></div>`;
  $$('[data-role-choice]').forEach(b=>b.onclick=()=>{selectedRole=b.dataset.roleChoice;renderRoles();});
  $('#role-form').onsubmit=async event=>{event.preventDefault();const requirements=Object.fromEntries(new FormData(event.target));try{await api('role',{name:selectedRole,requirements});await refresh();notify(`Requirements saved for ${selectedRole} across all contractors.`);}catch(e){notify(e.message,true);}};
  $('#new-role').onclick=showNewRole;
  $('#remove-role').onclick=showRemoveRole;
}
function showNewRole(){
    openDialog('Add role','Create a shared role for all contractors, then define its training requirements.','<form id="new-role-form"><label class="field">Role name<input name="name" required maxlength="60" placeholder="e.g. Leading Hand"></label><div class="actions"><button class="button primary">Create role</button></div><p id="role-error" role="alert"></p></form>');
    $('#new-role-form').onsubmit=async event=>{event.preventDefault();const name=new FormData(event.target).get('name').trim();try{if(Object.keys(state.roles).some(r=>r.toLowerCase()===name.toLowerCase()))throw new Error('That role already exists.');await api('role',{name,requirements:{}});selectedRole=name;$('#dialog').close();await refresh();notify('Role created. Set its minimum requirements below.');}catch(e){$('#role-error').textContent=e.message;}};
}
function showRemoveRole(){
  const role=selectedRole;
  openDialog('Remove '+role+'?', 'Remove this role for all contractors.', `<p>Anyone assigned to this role across <strong>all contractors</strong> will move to <strong>Unassigned</strong>. Their training records and source PDFs will be kept.</p><div class="actions"><button class="button" id="cancel-remove-role">Keep role</button><button class="button danger" id="confirm-remove-role">Remove role</button></div><p id="remove-role-error" role="alert"></p>`);
  $('#cancel-remove-role').onclick=()=>$('#dialog').close();
  $('#confirm-remove-role').onclick=async event=>{
    const button=event.target;button.disabled=true;
    try{const result=await api('role',{name:role},'DELETE');$('#dialog').close();await refresh();notify(`Removed ${role} from all contractors. ${result.reassigned?`${result.reassigned} people moved to Unassigned.`:'Training records are unchanged.'}`);}
    catch(error){$('#remove-role-error').textContent=error.message;button.disabled=false;}
  };
}

function manageSections(expanded=[]) {
  if(!state)return;
  if(!Array.isArray(expanded))expanded=[];
  const sections=trainingSections(state);
  const arrows=(kind,index,label,first,last)=>`<div class="order-buttons"><button type="button" class="button" data-order-kind="${kind}" data-order-index="${index}" data-order-step="-1" aria-label="Move ${esc(label)} left" title="Move left" ${first?'disabled':''}>←</button><button type="button" class="button" data-order-kind="${kind}" data-order-index="${index}" data-order-step="1" aria-label="Move ${esc(label)} right" title="Move right" ${last?'disabled':''}>→</button></div>`;
  openDialog('Training sections','Shared across all contractors. Arrange the matrix from left to right.',`<div class="panel-heading"><p>Use the arrows to move sections. Expand a section to arrange its training columns or move them to another section. Changes save automatically.</p><button class="button primary" id="dialog-new-section">＋ Add section</button></div><p id="order-error" role="alert"></p><div class="section-list">${sections.map((s,i)=>{
    const columns=state.columns.filter(c=>c.group===s.name);
    return `<div class="section-list-row"><div><span class="section-label-chip" data-section-colour="${esc(s.colour)}">${i+1}. ${esc(s.name)}</span><small>${columns.length} training columns</small></div><div class="section-row-actions">${arrows('section',i,s.name+' section',i===0,i===sections.length-1)}<button class="button" data-edit-section="${i}" aria-label="Edit ${esc(s.name)} section">Edit</button></div></div><details class="section-training" data-section-details="${i}" ${expanded.includes(s.name)?'open':''}><summary>Arrange training in ${esc(s.name)}</summary>${columns.length?columns.map((c,j)=>`<div class="section-training-row"><div><strong>${j+1}. ${esc(c.label)}</strong><label>Section<select data-move-column="${esc(c.id)}" aria-label="Section for ${esc(c.label)}">${sections.map(target=>`<option value="${esc(target.name)}" ${target.name===s.name?'selected':''}>${esc(target.name)}</option>`).join('')}</select></label></div>${arrows('column',state.columns.indexOf(c),c.label+' training',j===0,j===columns.length-1)}</div>`).join(''):'<p>No training columns yet. Add training from the matrix or move a column here from another section.</p>'}</details>`;
  }).join('')}</div>`);
  $('#dialog-new-section').onclick=()=>editSection();
  $$('[data-edit-section]').forEach(b=>b.onclick=()=>editSection(trainingSections(state)[Number(b.dataset.editSection)].name));
  const openSections=()=>$$('[data-section-details][open]').map(el=>sections[Number(el.dataset.sectionDetails)].name);
  $$('[data-order-kind]').forEach(b=>b.onclick=async()=>{
    const names=sections.map(s=>s.name),ids=state.columns.map(c=>c.id),index=Number(b.dataset.orderIndex),step=Number(b.dataset.orderStep);
    if(b.dataset.orderKind==='section') [names[index],names[index+step]]=[names[index+step],names[index]];
    else {
      const peers=state.columns.map((c,i)=>c.group===state.columns[index].group?i:-1).filter(i=>i!==-1),other=peers[peers.indexOf(index)+step];
      [ids[index],ids[other]]=[ids[other],ids[index]];
    }
    await saveSectionArrangement('order',{sections:names,columns:ids},openSections(),b.getAttribute('aria-label'));
  });
  $$('[data-move-column]').forEach(select=>select.onchange=async()=>{
    const column=state.columns.find(c=>c.id===select.dataset.moveColumn),group=select.value;
    await saveSectionArrangement('column',{column:{...column,group}},[...openSections(),group],select.getAttribute('aria-label'));
  });
}
async function saveSectionArrangement(path,body,expanded,focusLabel) {
  const scroll=$('#dialog').scrollTop;
  $$('#dialog button,#dialog select').forEach(el=>el.disabled=true);
  try{await api(path,body);await refresh();manageSections(expanded);notify('Training layout saved across all contractors.');}
  catch(e){manageSections(expanded);$('#order-error').textContent=e.message;}
  $('#dialog').scrollTop=scroll;
  const control=$$('#dialog [aria-label]').find(el=>el.getAttribute('aria-label')===focusLabel);
  if(control&&!control.disabled)control.focus({preventScroll:true});
}
function editSection(previousName) {
  if(!state)return;
  const section=trainingSections(state).find(s=>s.name===previousName)||{name:'',colour:Object.keys(sectionColours)[groups().length%Object.keys(sectionColours).length]};
  openDialog(previousName?'Edit section':'Add training section','Sections and colours are shared across all contractors.',`<form id="section-form"><label class="field">Section name<input name="name" required maxlength="200" value="${esc(section.name)}" placeholder="e.g. Emergency response"></label><fieldset class="section-colours"><legend>Section colour</legend>${Object.entries(sectionColours).map(([value,label])=>`<label data-section-colour="${value}"><input type="radio" name="colour" value="${value}" ${section.colour===value?'checked':''}><span class="colour-swatch" aria-hidden="true"></span>${label}</label>`).join('')}</fieldset><p>${previousName?'Renaming this section moves its training columns with it.':'Your new section will appear beside the existing section buttons. You can add training afterwards.'}</p><div class="actions"><button class="button" type="button" id="section-back">Manage sections</button><button class="button primary" type="submit">${previousName?'Save section':'Create section'}</button></div><p id="section-error" role="alert"></p></form>`);
  $('#section-back').onclick=manageSections;
  $('#section-form').onsubmit=async event=>{
    event.preventDefault();const form=event.target,button=$('[type="submit"]',form),data=new FormData(form),name=data.get('name').trim();
    button.disabled=true;
    try{
      if(!name||name.toLowerCase()==='all training')throw new Error('Enter a section name other than All training.');
      if(groups().some(g=>g!==previousName&&g.toLowerCase()===name.toLowerCase()))throw new Error('A section with this name already exists.');
      await api('section',{name,colour:data.get('colour'),...(previousName?{previousName}:{})});
      category=name;$('#dialog').close();await refresh();notify(`Section “${name}” saved. Add training or edit a column’s section in the training library.`);
    }catch(e){$('#section-error').textContent=e.message;button.disabled=false;}
  };
}
function renderLibrary() {
  $('#library-view').innerHTML=`<div class="panel"><div class="panel-heading"><div><h2>${state.columns.length} training columns</h2><p>Exact name matching preserves the distinction between training, appointments and authorisations.</p></div><div class="role-actions"><button class="button" id="library-sections">Manage sections</button><button class="button primary" id="new-column">＋ Add training</button></div></div><p>Multiple mappings mean <strong>any one</strong> of those competencies can satisfy the column. Use separate columns when all competencies are required.</p><table class="form-table"><thead><tr><th>TRAINING</th><th>SECTION</th><th>MAPPING</th><th></th></tr></thead><tbody>${orderedTrainingColumns(state).map(c=>`<tr><td>${esc(c.label)}${c.evidenceType?`<small>${esc(evidenceTypes[c.evidenceType])}</small>`:''}</td><td>${esc(c.group)}</td><td><span class="pill ${c.aliases.length?'':'warn'}">${c.aliases.length?`${c.aliases.length} exact name${c.aliases.length===1?'':'s'}`:'Needs mapping'}</span></td><td><button class="button" data-library-column="${esc(c.id)}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  $('#new-column').onclick=()=>editColumn();
  $('#library-sections').onclick=manageSections;
  $$('[data-library-column]').forEach(b=>b.onclick=()=>editColumn(b.dataset.libraryColumn));
}
function editColumn(id) {
  const c=state.columns.find(c=>c.id===id)||{id:crypto.randomUUID(),label:'',group:category==='All training'?(groups()[0]||'Core / Site'):category,aliases:[]};
  const names=[...new Set(state.people.flatMap(p=>p.records.map(r=>r.name)))].sort();
  openDialog(id?'Edit training & mapping':'Add training column','Map to exact competency names from the imported reports.',`<form id="column-form"><label class="field">Training name<input name="label" required maxlength="200" value="${esc(c.label)}"></label><label class="field">Section<select name="group">${groups().map(g=>`<option value="${esc(g)}" ${g===c.group?'selected':''}>${esc(g)}</option>`).join('')}</select></label><label class="field">Evidence type<select name="evidenceType"><option value="">Any type (legacy mapping)</option>${Object.entries(evidenceTypes).map(([type,label])=>`<option value="${type}" ${c.evidenceType===type?'selected':''}>${esc(label)}</option>`).join('')}</select></label><label class="field">Find competencies<input id="mapping-search" type="search" placeholder="Search imported competency names…"></label><div class="mapping-list">${names.map((n,i)=>`<label class="mapping-option" data-mapping-name="${esc(n.toLowerCase())}"><input type="checkbox" data-mapping-index="${i}" ${c.aliases.includes(n)?'checked':''}><span>${esc(n)}</span></label>`).join('')}</div><label class="field">Exact mappings · one per line<textarea name="aliases" id="aliases">${esc(c.aliases.join('\n'))}</textarea></label><p>Only add alternatives that satisfy the same requirement. An empty mapping shows “Unmapped”; it cannot satisfy a minimum requirement.</p><div class="actions"><button class="button primary">Save training</button></div><p id="column-error" role="alert"></p></form>`);
  $('#mapping-search').oninput=event=>$$('[data-mapping-name]').forEach(l=>l.hidden=!l.dataset.mappingName.includes(event.target.value.toLowerCase()));
  $$('[data-mapping-index]').forEach(box=>box.onchange=()=>{
    const aliases=new Set($('#aliases').value.split('\n').map(s=>s.trim()).filter(Boolean));const name=names[Number(box.dataset.mappingIndex)];box.checked?aliases.add(name):aliases.delete(name);$('#aliases').value=[...aliases].join('\n');
  });
  $('#column-form').onsubmit=async event=>{event.preventDefault();const data=new FormData(event.target);try{await api('column',{column:{...c,label:data.get('label').trim(),group:data.get('group').trim(),evidenceType:data.get('evidenceType')||null,aliases:[...new Set(data.get('aliases').split('\n').map(s=>s.trim()).filter(Boolean))]}});$('#dialog').close();await refresh();notify('Training column saved.');}catch(e){$('#column-error').textContent=e.message;}};
}
function importMarkup() {if(contractor===ALL_CONTRACTORS)return '<p>Select a contractor in the sidebar before importing reports.</p>';return `<div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Choose PDF reports"><span class="drop-icon">↥</span><h3>Drop your cardholder PDFs here</h3><p>Or click to browse · multiple files supported · 20 MB per file</p><span class="button primary">Choose PDFs</span></div><input id="pdf-files" type="file" accept=".pdf,application/pdf" multiple hidden><p>Reports are saved securely in the selected DrillOps contractor workspace. Re-importing a cardholder replaces their report snapshot and keeps their role. Older dated reports are rejected.</p><div id="import-results" role="status" aria-live="polite"></div>`;}
function wireImport() {
  const zone=$('#dropzone'),input=$('#pdf-files');if(!zone)return;
  zone.onclick=()=>{if(!importing)input.click();};zone.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();zone.click();}};
  input.onchange=()=>runImports([...input.files]);
  zone.ondragover=e=>{e.preventDefault();zone.classList.add('drag');};zone.ondragleave=()=>zone.classList.remove('drag');
  zone.ondrop=e=>{e.preventDefault();zone.classList.remove('drag');if(!importing)runImports([...e.dataTransfer.files]);};
}
function renderImports() {
  $('#imports-view').innerHTML=`<div class="panel">${importMarkup()}</div><div class="panel"><div class="panel-heading"><div><h2>Imported reports</h2><p>Source documents and training records are stored behind administrator access in DrillOps.</p></div></div><table class="form-table"><thead><tr><th>PERSON</th><th>REPORT DATE</th><th>RECORDS</th><th>SOURCES</th></tr></thead><tbody>${state.people.map(p=>`<tr><td>${esc(p.name)}<small>${esc(p.company)}</small></td><td>${date(p.reportDate)}</td><td>${p.records.length}</td><td><button class="button" data-source-contractor="${esc(p.contractor)}" data-source-id="${esc(p.sourceId)}" data-source-page="1" data-source-name="${esc(p.source)}">Open PDF ↗</button> <button class="button" data-person-records="${esc(p.id)}">All records${p.documents?.length?` · ${p.documents.length} documents`: ""}</button></td></tr>`).join('')}</tbody></table>${!state.people.length?'<div class="empty">No reports imported yet.</div>':''}</div>`;wireImport();
}
function showImport() { if(!state)return; if(view==='imports'){ ($('#dropzone')||$('#contractor-select')).focus();return;} openDialog('Import or update reports','Populate the matrix directly from Cardholder Reports.',importMarkup());wireImport(); }
async function runImports(files) {
  if(importing||!files.length)return;importing=true;
  const results=$('#import-results'),zone=$('#dropzone');results.innerHTML='';zone.setAttribute('aria-disabled','true');
  const messages=[];let successful=0;
  try{
    for(const file of files) {
      const row=document.createElement('div');row.className='import-result';row.textContent=`Reading ${file.name}…`;results.append(row);
      try{
        if(file.size>20*1024*1024)throw new Error('File exceeds 20 MB.');
        if(!file.name.toLowerCase().endsWith('.pdf'))throw new Error('Choose a PDF file.');
        const form=new FormData();form.append('file',file);
        const response=await fetch(endpoint('import'),{method:'POST',body:form});
        const result=await response.json();
        if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:'Could not import this report.');
        successful++;row.textContent=`✓ ${result.name} · ${result.records} records · ${result.replaced?'updated':'imported'}`;
      }catch(e){row.textContent=`Unable to import ${file.name}: ${e.message}`;row.style.color='var(--red)';}
      messages.push(row.textContent);
    }
    await refresh();
    // renderImports rebuilds its panel; preserve the completed batch summary.
    if(view==='imports')$('#import-results').innerHTML=messages.map(m=>`<div class="import-result">${esc(m)}</div>`).join('');
    notify(`${successful} of ${files.length} reports imported.`,successful!==files.length);
  }catch(e){notify(e.message,true);}finally{importing=false;zone.removeAttribute('aria-disabled');}
}
function preparePDF() {
  if(!state)return;
  const columns=orderedTrainingColumns(state).filter(c=>category==='All training'||c.group===category);
  const people=filteredPeople();
  const filters=[contractor,category,$('#role-filter').selectedOptions[0]?.textContent,$('#status-filter').selectedOptions[0]?.textContent,$('#search').value?`Search: ${$('#search').value}`:''].filter(Boolean).join(' · ');
  let output='';
  // Six training columns per sheet keeps even the full matrix readable on A4.
  for(let offset=0;offset<Math.max(columns.length,1);offset+=6){
    const batch=columns.slice(offset,offset+6);
    output+=`<section class="pdf-sheet"><table><colgroup><col style="width:22%">${batch.map(()=>'<col>').join('')}</colgroup><thead><tr><td colspan="${batch.length+1}" class="pdf-title"><h1>DrillOps · Training matrix</h1><p>${esc(filters)}</p><p>As of ${date(today)} · ${people.length} people · Due soon within ${horizon} days · Column group ${Math.floor(offset/6)+1} of ${Math.max(1,Math.ceil(columns.length/6))}</p><p>Red box / ⚑ = minimum unmet. Qualification, VOC and site authorisation are assessed separately.</p></td></tr><tr><th>Personnel / contractor</th>${batch.map(c=>`<th ${sectionAttrs(c.group)}><small>${esc(c.group)}</small>${esc(c.label)}<small>${esc(kindLabel[c.evidenceType]||'')}</small></th>`).join('')}</tr></thead><tbody>${people.map(p=>{
      const r=readiness(state,p,today,horizon);
      return `<tr><th>${esc(p.name)}<small>${esc(p.contractor)} · ${esc(p.role)}</small><small>${esc(r.label)}</small></th>${batch.map(c=>{
        const e=evidence(p,c,today,horizon),req=requirement(state,p,c),status=req==='na'?'na':e.status,gap=r.gaps.some(g=>g.id===c.id);
        return `<td class="pdf-${status}${gap?' pdf-gap':''}">${gap?'<strong>⚑ Minimum unmet</strong>':''}${esc(statusLabel[status])}<small>${req==='minimum'?'Minimum':req==='na'?'Not applicable':'Optional'}</small>${req!=='na'&&e.best?`<small>${shortDate(recordDueDate(e.best))}</small>`:''}</td>`;
      }).join('')}</tr>`;
    }).join('')||`<tr><td colspan="${batch.length+1}">No people match the selected filters.</td></tr>`}</tbody></table>${!columns.length?'<p>No training columns in this section.</p>':''}</section>`;
  }
  $('#pdf-output').innerHTML=output;
}
window.addEventListener('beforeprint',preparePDF);
function exportPDF(){if(!state)return;preparePDF();window.print();}
function exportCSV() {
  if(!state)return;
  const columns=orderedTrainingColumns(state).filter(c=>category==='All training'||c.group===category);
  const rows=[['Person','Contractor','Role','Report date','Minimum status',...columns.flatMap(c=>[c.label+' | requirement',c.label+' | status',c.label+' | expiry / renewal due'])]];
  for(const p of filteredPeople())rows.push([p.name,p.contractor,p.role,p.reportDate||'',readiness(state,p,today,horizon).label,...columns.flatMap(c=>{const e=evidence(p,c,today,horizon),req=requirement(state,p,c);return[req,statusLabel[req==='na'?'na':e.status],recordDueDate(e.best||{})||''];})]);
  const quote=value=>{let v=String(value);if(/^[=+@\-\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};
  const blob=new Blob(['\ufeff'+rows.map(r=>r.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`training-matrix-${today}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$$('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
$('#new-section').onclick=()=>editSection();
$('#manage-sections').onclick=manageSections;
$('#empty-section-add').onclick=()=>editColumn();
$('#empty-section-move').onclick=()=>switchView('library');
$('#text-size').onchange=e=>{document.body.dataset.textSize=e.target.value;};
$('#expand-table').onclick=()=>{const expanded=document.body.classList.toggle('matrix-expanded');$('#expand-table').textContent=expanded?'Exit expanded view':'Expand table';$('#expand-table').setAttribute('aria-pressed',String(expanded));};
$('#search').oninput=renderMatrix;$('#role-filter').onchange=renderMatrix;$('#status-filter').onchange=renderMatrix;
$('#horizon').onchange=e=>{horizon=Number(e.target.value);renderMatrix();};
$('#import-open').onclick=showImport;$('#export').onclick=exportCSV;
$('#export-pdf').onclick=exportPDF;
$('#dialog').addEventListener('click',e=>{if(e.target===$('#dialog')){const r=$('#dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('#dialog').close();}});
try{await refresh();}catch(e){notify('Could not load the workspace: '+e.message,true);}

document.addEventListener('click',async event=>{
  const personButton=event.target.closest('[data-person-records]');if(personButton){showPersonRecords(personButton.dataset.personRecords);return;}
  const button=event.target.closest('[data-source-id]');if(!button)return;
  button.disabled=true;
  try{
    const response=await fetch(endpoint('sources/'+encodeURIComponent(button.dataset.sourceId),button.dataset.sourceContractor||workspaceContractor),{cache:'no-store'});
    if(!response.ok){const error=await response.json();throw new Error(error.detail||'Could not open source PDF.');}
    if(sourceBlobUrl)URL.revokeObjectURL(sourceBlobUrl);
    sourceBlobUrl=URL.createObjectURL(await response.blob());
    openDialog('Source report',button.dataset.sourceName,`<p><a href="${sourceBlobUrl}" download="${esc(button.dataset.sourceName)}">Download source PDF</a> · If your browser does not show a preview, open the downloaded file.</p><iframe title="Source Cardholder Report" src="${sourceBlobUrl}#page=${Number(button.dataset.sourcePage)||1}" style="width:100%;height:65vh;border:0"></iframe>`);
  }catch(error){notify(error.message,true);}finally{button.disabled=false;}
});
$('#dialog').addEventListener('close',()=>{if(sourceBlobUrl){URL.revokeObjectURL(sourceBlobUrl);sourceBlobUrl=null;}});
