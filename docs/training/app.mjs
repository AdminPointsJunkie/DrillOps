import {evidence, readiness, requirement, recordStatus, todayISO} from './logic.mjs?v=20260909';
const $ = (s,root=document)=>root.querySelector(s);
const $$ = (s,root=document)=>[...root.querySelectorAll(s)];
const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = s => s ? new Date(s+'T00:00:00').toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'}) : 'Not recorded';
const shortDate = s => s ? new Date(s+'T00:00:00').toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'2-digit'}) : 'No expiry date';
const statusLabel = {current:'Current',soon:'Due soon',expired:'Expired',missing:'No record',unmapped:'Unmapped',review:'Review',na:'Not applicable'};
const groupColours = {'Core / Site':['#718faf','#edf3fa','#516d8a'],'Drilling':['#73a784','#eef6ec','#55794b'],'Supervisor':['#d8a45c','#fcf3e7','#9a713b'],'Driving':['#9483bb','#f2eef9','#807198'],'Gas Testing':['#8599a3','#eff3f5','#687d88'],'Lifting':['#c38c73','#fbefe9','#a57761'],'Loading Crane':['#66a5b1','#eaf6f8','#538e98']};
let state, view='matrix', category='All training', selectedRole='Driller', horizon=90, today=todayISO();
let importing=false;
const API = ['localhost','127.0.0.1'].includes(location.hostname) ? 'http://localhost:8000' : 'https://api.drillops.com.au';
const contractor = new URLSearchParams(location.search).get('contractor') || sessionStorage.getItem('drillops_contractor') || 'DEPCO Drilling';
const endpoint = path => API+'/training/'+path+'?contractor='+encodeURIComponent(contractor);
let sourceBlobUrl;


async function api(path, body) {
  const response=await fetch(endpoint(path),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,revision:state?.revision})}:{cache:'no-store'});
  const data=await response.json();
  if(!response.ok) throw new Error((typeof data.detail==='string'?data.detail:data.error)||'Request failed');
  return data;
}
function notify(message,error=false) { $('#notice').innerHTML=`<div class="notice ${error?'error':''}">${esc(message)}</div>`; }
async function refresh() { state=await api('state'); render(); }
function openDialog(title,subtitle,body) {
  $('#dialog-body').innerHTML=`<div class="dialog-header"><div><div class="eyebrow">TRAINING WORKSPACE</div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="close" aria-label="Close dialog">×</button></div><div class="dialog-content">${body}</div>`;
  $('.close',$('#dialog')).onclick=()=>$('#dialog').close();
  if(!$('#dialog').open) $('#dialog').showModal();
  $('#dialog').scrollTop=0;
}
function roleOptions(value,all=false) { return `${all?'<option value="all">All roles</option>':''}${['Unassigned',...Object.keys(state.roles)].map(r=>`<option ${r===value?'selected':''}>${esc(r)}</option>`).join('')}`; }
function groups() { return [...new Set(state.columns.map(c=>c.group))]; }
function render() {
  $('#report-count').textContent=state.people.length;
  $('#contractor-select').innerHTML=state.contractors.map(c=>`<option ${c===contractor?'selected':''}>${esc(c)}</option>`).join('');
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
  const titles={matrix:['Training matrix','One view of your people, their training and what comes next.'],roles:['Role requirements','Define the minimum training and optional skills for each role.'],library:['Training library','Connect matrix columns to the exact competencies in your reports.'],imports:['PDF reports','Import cardholder reports to keep your training evidence up to date.']};
  $('#page-title').textContent=titles[view][0];$('#breadcrumb').textContent=titles[view][0];$('#page-description').textContent=titles[view][1];
  for(const v of ['matrix','roles','library','imports']) $('#'+v+'-view').hidden=v!==view;
  $$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  render();
}
function filteredPeople() {
  const term=$('#search').value.toLowerCase(), role=$('#role-filter').value, attention=$('#status-filter').value;
  return state.people.filter(p=>p.name.toLowerCase().includes(term)&&(role==='all'||p.role===role)&&
    (attention==='all'||(attention==='unassigned'&&p.role==='Unassigned')||(attention==='gaps'&&readiness(state,p,today,horizon).gaps.length)||(attention==='soon'&&state.columns.some(c=>evidence(p,c,today,horizon).status==='soon'))));
}
function renderMatrix() {
  const recordCount=state.people.reduce((n,p)=>n+p.records.length,0);
  const due=state.people.reduce((n,p)=>n+state.columns.filter(c=>evidence(p,c,today,horizon).status==='soon').length,0);
  const ready=state.people.filter(p=>{const r=readiness(state,p,today,horizon);return r.total&&r.met===r.total;}).length;
  const configured=Object.values(state.roles).filter(r=>Object.values(r).includes('minimum')).length;
  $('#stats').innerHTML=[['Personnel',state.people.length,'Across your imported reports','♙'],['Training records',recordCount,'Including historical evidence','▤'],['Expiring soon',due,`Mapped credentials · next ${horizon} days`,'◷'],['Minimum met',configured?ready:'—',`${configured} of ${Object.keys(state.roles).length} roles configured`,'✓']].map(([label,n,note,icon])=>`<div class="stat"><div class="stat-label">${label}</div><span class="stat-icon">${icon}</span><div class="stat-number">${n}</div><div class="stat-note">${note}</div></div>`).join('');
  const unassigned=state.people.filter(p=>p.role==='Unassigned').length;
  $('#setup-note').innerHTML=`<strong>${configured?'Role setup':'Ready for your requirements.'}</strong> ${configured?`${configured} roles have minimum requirements.`:'Minimum requirements have not been set. Training evidence is shown for review.'} ${unassigned?`${unassigned} people need a role.`:''}<button id="setup-roles">Configure roles →</button>`;
  $('#setup-roles').onclick=()=>switchView('roles');
  $('#categories').innerHTML=['All training',...groups()].map(g=>`<button class="chip ${category===g?'active':''}" data-category="${esc(g)}">${esc(g)}</button>`).join('');
  $$('#categories button').forEach(b=>b.onclick=()=>{category=b.dataset.category;renderMatrix();});
  const columns=state.columns.filter(c=>category==='All training'||c.group===category);
  const people=filteredPeople();$('#people-count').textContent=people.length;
  let groupHeaders='';
  for(let i=0;i<columns.length;) {
    const group=columns[i].group;let count=1;while(columns[i+count]?.group===group)count++;
    const colours=groupColours[group]||['#8d9b94','#f0f5f2','#61726b'];
    groupHeaders+=`<th class="group-head" colspan="${count}" scope="colgroup" style="--group-color:${colours[0]};--group-bg:${colours[1]};--group-ink:${colours[2]}">${esc(group)}</th>`;i+=count;
  }
  const head=`<thead><tr><th class="person-head" rowspan="2" scope="col">Personnel <p style="font-size:10px;font-weight:400;margin:8px 0 0">Role & minimum requirements</p></th>${groupHeaders}</tr><tr>${columns.map(c=>`<th class="course-head" scope="col"><button data-edit-column="${esc(c.id)}" title="Edit mapping: ${esc(c.label)}">${esc(c.label)}${!c.aliases.length?' ◇':''}</button></th>`).join('')}</tr></thead>`;
  let body='';
  for(const role of [...Object.keys(state.roles),'Unassigned']) {
    const list=people.filter(p=>p.role===role);if(!list.length)continue;
    body+=`<tr class="role-row"><th colspan="${columns.length+1}"><span>${esc(role)} <small> / ${list.length} ${list.length===1?'person':'people'}</small></span></th></tr>`;
    body+=list.map(p=>{
      const r=readiness(state,p,today,horizon);
      return `<tr class="person-row"><td class="person-cell"><div class="person-name"><span class="avatar">${esc(p.name.split(' ').map(s=>s[0]).slice(0,2).join(''))}</span>${esc(p.name)}</div><div class="person-meta"><select data-person="${esc(p.id)}" aria-label="Role for ${esc(p.name)}">${roleOptions(p.role)}</select><small title="${esc(r.label)}">${r.total?`${r.met}/${r.total} minimum`:'Setup needed'}</small></div></td>${columns.map(c=>{
        const e=evidence(p,c,today,horizon), req=requirement(state,p,c), status=req==='na'?'na':e.status;
        const icon={current:'✓',soon:'◷',expired:'!',missing:'—',unmapped:'◇',review:'?',na:'·'}[status];
        return `<td class="matrix-cell"><button class="cell-button ${status}" data-person-cell="${esc(p.id)}" data-column="${esc(c.id)}" title="${esc(p.name+' · '+c.label+' · '+statusLabel[status]+' · '+(req==='minimum'?'Minimum':req==='na'?'Not applicable':'Optional / not configured'))}" aria-label="${esc(p.name+', '+c.label+', '+statusLabel[status])}">${req==='minimum'?'<b class="required-dot">●</b>':''}<span>${icon}</span>${e.best&&status!=='na'?`<small>${esc(shortDate(e.best.expires))}</small>`:''}</button></td>`;
      }).join('')}</tr>`;
    }).join('');
  }
  if(!people.length) body=`<tr><td colspan="${columns.length+1}" class="empty">${state.people.length?'No people match these filters.':'Import your first Cardholder Report to populate the matrix.'}</td></tr>`;
  $('#matrix').innerHTML=head+`<tbody>${body}</tbody>`;
  $$('[data-person]').forEach(s=>s.onchange=async()=>{try{await api('person',{id:s.dataset.person,role:s.value});await refresh();notify('Role assignment saved.');}catch(e){notify(e.message,true);await refresh();}});
  $$('[data-person-cell]').forEach(b=>b.onclick=()=>showEvidence(b.dataset.personCell,b.dataset.column));
  $$('[data-edit-column]').forEach(b=>b.onclick=()=>editColumn(b.dataset.editColumn));
}
function showEvidence(personId,columnId) {
  const p=state.people.find(p=>p.id===personId),c=state.columns.find(c=>c.id===columnId),e=evidence(p,c,today,horizon),req=requirement(state,p,c);
  openDialog(c.label,p.name+' · '+p.role,`<div class="panel-heading"><span class="pill ${e.status==='current'?'':'warn'}">${statusLabel[e.status]}</span><span class="pill">${req==='minimum'?'Minimum requirement':req==='na'?'Not applicable':'Optional / not configured'}</span></div>${c.note?`<p>${esc(c.note)}</p>`:''}<p>Report dated <strong>${date(p.reportDate)}</strong>. All matching records are retained; current evidence is preferred over expired history. Blank expiry dates do not establish a lifetime qualification.</p>${!e.records.length?`<div class="data-warning">${e.status==='unmapped'?'This column has no competency mapping. Select exact report names before assessing this requirement.':'No matching competency was found in this report. This means no evidence in this source, not proof that training was never completed.'}</div>`:''}${e.records.map((r,i)=>`<article class="evidence-record"><h3>${esc(r.name)}</h3><span class="pill ${recordStatus(r,today,horizon)==='current'?'':'warn'}">${statusLabel[recordStatus(r,today,horizon)]}${i===0?' · used in matrix':''}</span><div class="evidence-grid"><div><small>Issue date</small>${date(r.issued)}</div><div><small>Expiry date</small>${date(r.expires)}</div><div><small>Report status</small>${esc(r.reportedStatus)}</div><div><small>Assignment</small>${esc(r.assignment)}</div><div><small>Location</small>${esc(r.location)}</div><div><small>Issuer</small>${esc(r.issuer)}</div></div><button class="button" data-source-id="${esc(p.sourceId)}" data-source-page="${r.page}" data-source-name="${esc(p.source)}">Open source PDF · page ${r.page} ↗</button></article>`).join('')}<div class="actions"><button class="button" id="evidence-mapping">Edit competency mapping</button></div>`);
  $('#evidence-mapping').onclick=()=>editColumn(c.id);
}
function renderRoles() {
  if(!state.roles[selectedRole])selectedRole=Object.keys(state.roles)[0];
  const values=state.roles[selectedRole]||{};
  $('#roles-view').innerHTML=`<div class="role-layout"><div><div class="section-label">Your roles</div>${Object.entries(state.roles).map(([r,req])=>`<button class="role-choice ${r===selectedRole?'active':''}" data-role-choice="${esc(r)}"><strong>${esc(r)}</strong><small>${Object.values(req).filter(v=>v==='minimum').length} minimum · ${state.people.filter(p=>p.role===r).length} people</small></button>`).join('')}<button class="button" id="new-role">＋ Add role</button></div><form id="role-form" class="panel"><div class="panel-heading"><div><h2>${esc(selectedRole)}</h2><p>Optional training does not create a minimum training gap.</p></div><button class="button primary" type="submit">Save requirements</button></div><p>Choose <strong>Minimum</strong>, <strong>Optional</strong> or <strong>Not applicable</strong> for each competency. Roles with no minimum requirements remain unconfigured.</p><table class="form-table"><thead><tr><th>TRAINING</th><th>REQUIREMENT</th></tr></thead><tbody>${state.columns.map(c=>`<tr><td>${esc(c.label)}<small>${esc(c.group)}${!c.aliases.length?' · mapping needed':''}</small></td><td><select name="${esc(c.id)}" aria-label="Requirement for ${esc(c.label)}">${[['optional','Optional'],['minimum','Minimum'],['na','Not applicable']].map(([v,l])=>`<option value="${v}" ${(values[c.id]||'optional')===v?'selected':''}>${l}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table><div class="actions"><button type="submit" class="button primary">Save requirements</button></div></form></div>`;
  $$('[data-role-choice]').forEach(b=>b.onclick=()=>{selectedRole=b.dataset.roleChoice;renderRoles();});
  $('#role-form').onsubmit=async event=>{event.preventDefault();const requirements=Object.fromEntries(new FormData(event.target));try{await api('role',{name:selectedRole,requirements});await refresh();notify(`Requirements saved for ${selectedRole}.`);}catch(e){notify(e.message,true);}};
  $('#new-role').onclick=()=>{
    openDialog('Add role','Create a role, then define its training requirements.','<form id="new-role-form"><label class="field">Role name<input name="name" required maxlength="60" placeholder="e.g. Leading Hand"></label><div class="actions"><button class="button primary">Create role</button></div><p id="role-error" role="alert"></p></form>');
    $('#new-role-form').onsubmit=async event=>{event.preventDefault();const name=new FormData(event.target).get('name').trim();try{if(Object.keys(state.roles).some(r=>r.toLowerCase()===name.toLowerCase()))throw new Error('That role already exists.');await api('role',{name,requirements:{}});selectedRole=name;$('#dialog').close();await refresh();notify('Role created. Set its minimum requirements below.');}catch(e){$('#role-error').textContent=e.message;}};
  };
}
function renderLibrary() {
  $('#library-view').innerHTML=`<div class="panel"><div class="panel-heading"><div><h2>${state.columns.length} training columns</h2><p>Exact name matching preserves the distinction between training, appointments and authorisations.</p></div><button class="button primary" id="new-column">＋ Add training</button></div><p>Multiple mappings mean <strong>any one</strong> of those competencies can satisfy the column. Use separate columns when all competencies are required.</p><table class="form-table"><thead><tr><th>TRAINING</th><th>CATEGORY</th><th>MAPPING</th><th></th></tr></thead><tbody>${state.columns.map(c=>`<tr><td>${esc(c.label)}</td><td>${esc(c.group)}</td><td><span class="pill ${c.aliases.length?'':'warn'}">${c.aliases.length?`${c.aliases.length} exact name${c.aliases.length===1?'':'s'}`:'Needs mapping'}</span></td><td><button class="button" data-library-column="${esc(c.id)}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  $('#new-column').onclick=()=>editColumn();
  $$('[data-library-column]').forEach(b=>b.onclick=()=>editColumn(b.dataset.libraryColumn));
}
function editColumn(id) {
  const c=state.columns.find(c=>c.id===id)||{id:crypto.randomUUID(),label:'',group:'Core / Site',aliases:[]};
  const names=[...new Set(state.people.flatMap(p=>p.records.map(r=>r.name)))].sort();
  openDialog(id?'Edit training & mapping':'Add training column','Map to exact competency names from the imported reports.',`<form id="column-form"><label class="field">Training name<input name="label" required maxlength="200" value="${esc(c.label)}"></label><label class="field">Category<input name="group" required maxlength="200" list="group-names" value="${esc(c.group)}"><datalist id="group-names">${groups().map(g=>`<option value="${esc(g)}">`).join('')}</datalist></label><label class="field">Find competencies<input id="mapping-search" type="search" placeholder="Search imported competency names…"></label><div class="mapping-list">${names.map((n,i)=>`<label class="mapping-option" data-mapping-name="${esc(n.toLowerCase())}"><input type="checkbox" data-mapping-index="${i}" ${c.aliases.includes(n)?'checked':''}><span>${esc(n)}</span></label>`).join('')}</div><label class="field">Exact mappings · one per line<textarea name="aliases" id="aliases">${esc(c.aliases.join('\n'))}</textarea></label><p>Only add alternatives that satisfy the same requirement. An empty mapping shows “Unmapped”; it cannot satisfy a minimum requirement.</p><div class="actions"><button class="button primary">Save training</button></div><p id="column-error" role="alert"></p></form>`);
  $('#mapping-search').oninput=event=>$$('[data-mapping-name]').forEach(l=>l.hidden=!l.dataset.mappingName.includes(event.target.value.toLowerCase()));
  $$('[data-mapping-index]').forEach(box=>box.onchange=()=>{
    const aliases=new Set($('#aliases').value.split('\n').map(s=>s.trim()).filter(Boolean));const name=names[Number(box.dataset.mappingIndex)];box.checked?aliases.add(name):aliases.delete(name);$('#aliases').value=[...aliases].join('\n');
  });
  $('#column-form').onsubmit=async event=>{event.preventDefault();const data=new FormData(event.target);try{await api('column',{column:{...c,label:data.get('label').trim(),group:data.get('group').trim(),aliases:[...new Set(data.get('aliases').split('\n').map(s=>s.trim()).filter(Boolean))]}});$('#dialog').close();await refresh();notify('Training column saved.');}catch(e){$('#column-error').textContent=e.message;}};
}
function importMarkup() {return `<div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Choose PDF reports"><span class="drop-icon">↥</span><h3>Drop your cardholder PDFs here</h3><p>Or click to browse · multiple files supported · 20 MB per file</p><span class="button primary">Choose PDFs</span></div><input id="pdf-files" type="file" accept=".pdf,application/pdf" multiple hidden><p>Reports are saved securely in the selected DrillOps contractor workspace. Re-importing a cardholder replaces their report snapshot and keeps their role. Older dated reports are rejected.</p><div id="import-results" role="status" aria-live="polite"></div>`;}
function wireImport() {
  const zone=$('#dropzone'),input=$('#pdf-files');
  zone.onclick=()=>{if(!importing)input.click();};zone.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();zone.click();}};
  input.onchange=()=>runImports([...input.files]);
  zone.ondragover=e=>{e.preventDefault();zone.classList.add('drag');};zone.ondragleave=()=>zone.classList.remove('drag');
  zone.ondrop=e=>{e.preventDefault();zone.classList.remove('drag');if(!importing)runImports([...e.dataTransfer.files]);};
}
function renderImports() {
  $('#imports-view').innerHTML=`<div class="panel">${importMarkup()}</div><div class="panel"><div class="panel-heading"><div><h2>Imported reports</h2><p>Source documents and training records are stored behind administrator access in DrillOps.</p></div></div><table class="form-table"><thead><tr><th>PERSON</th><th>REPORT DATE</th><th>RECORDS</th><th>SOURCE</th></tr></thead><tbody>${state.people.map(p=>`<tr><td>${esc(p.name)}<small>${esc(p.company)}</small></td><td>${date(p.reportDate)}</td><td>${p.records.length}</td><td><button class="button" data-source-id="${esc(p.sourceId)}" data-source-page="1" data-source-name="${esc(p.source)}">Open PDF ↗</button></td></tr>`).join('')}</tbody></table>${!state.people.length?'<div class="empty">No reports imported yet.</div>':''}</div>`;wireImport();
}
function showImport() { if(!state)return; if(view==='imports'){ $('#dropzone').focus();return;} openDialog('Import or update reports','Populate the matrix directly from Cardholder Reports.',importMarkup());wireImport(); }
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
      }catch(e){row.textContent=`Unable to import ${file.name}: ${e.message}`;row.style.color='#a45244';}
      messages.push(row.textContent);
    }
    state=await api('state');render();
    // renderImports rebuilds its panel; preserve the completed batch summary.
    if(view==='imports')$('#import-results').innerHTML=messages.map(m=>`<div class="import-result">${esc(m)}</div>`).join('');
    notify(`${successful} of ${files.length} reports imported.`,successful!==files.length);
  }catch(e){notify(e.message,true);}finally{importing=false;zone.removeAttribute('aria-disabled');}
}
function exportCSV() {
  if(!state)return;
  const columns=state.columns.filter(c=>category==='All training'||c.group===category);
  const rows=[['Person','Role','Report date','Minimum status',...columns.flatMap(c=>[c.label+' | requirement',c.label+' | status',c.label+' | expiry'])]];
  for(const p of filteredPeople())rows.push([p.name,p.role,p.reportDate||'',readiness(state,p,today,horizon).label,...columns.flatMap(c=>{const e=evidence(p,c,today,horizon),req=requirement(state,p,c);return[req,statusLabel[req==='na'?'na':e.status],e.best?.expires||''];})]);
  const quote=value=>{let v=String(value);if(/^[=+@\-\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};
  const blob=new Blob(['\ufeff'+rows.map(r=>r.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`training-matrix-${today}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Exported the currently filtered training matrix.');
}
$$('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
$('#search').oninput=renderMatrix;$('#role-filter').onchange=renderMatrix;$('#status-filter').onchange=renderMatrix;
$('#horizon').onchange=e=>{horizon=Number(e.target.value);renderMatrix();};
$('#import-open').onclick=showImport;$('#export').onclick=exportCSV;
$('#dialog').addEventListener('click',e=>{if(e.target===$('#dialog')){const r=$('#dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('#dialog').close();}});
try{await refresh();}catch(e){notify('Could not load the workspace: '+e.message,true);}

document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-source-id]');if(!button)return;
  button.disabled=true;
  try{
    const response=await fetch(endpoint('sources/'+encodeURIComponent(button.dataset.sourceId)),{cache:'no-store'});
    if(!response.ok){const error=await response.json();throw new Error(error.detail||'Could not open source PDF.');}
    if(sourceBlobUrl)URL.revokeObjectURL(sourceBlobUrl);
    sourceBlobUrl=URL.createObjectURL(await response.blob());
    openDialog('Source report',button.dataset.sourceName,`<p><a href="${sourceBlobUrl}" download="${esc(button.dataset.sourceName)}">Download source PDF</a> · If your browser does not show a preview, open the downloaded file.</p><iframe title="Source Cardholder Report" src="${sourceBlobUrl}#page=${Number(button.dataset.sourcePage)||1}" style="width:100%;height:65vh;border:0"></iframe>`);
  }catch(error){notify(error.message,true);}finally{button.disabled=false;}
});
$('#dialog').addEventListener('close',()=>{if(sourceBlobUrl){URL.revokeObjectURL(sourceBlobUrl);sourceBlobUrl=null;}});
