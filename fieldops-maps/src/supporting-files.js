import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
import {installSupportingActions} from './supporting-actions.js';
import {openSupportingPreview} from './supporting-preview.js';
import {registerUpload} from './upload-meter.js';
export const SUPPORTING_LIMIT=50*1024*1024;
export const SUPPORTING_ACCEPT='.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.rtf,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif';
export function normaliseSupportingGroup(value=''){const group=String(value??'').trim();if(group.length>80)throw Error('Keep headings to 80 characters or fewer.');return group;}
export function groupSupportingFiles(files,term=''){
 const groups=new Map();term=term.trim().toLowerCase();
 for(const file of files){const group=normaliseSupportingGroup(file.group);if(term&&!`${file.name} ${group}`.toLowerCase().includes(term))continue;if(!groups.has(group))groups.set(group,[]);groups.get(group).push(file);}
 return [...groups].sort(([a],[b])=>!a?1:!b?-1:a.localeCompare(b));
}
export function validateSupportingFiles(files){
 if(!files.length)throw Error('Choose a supporting file.');
 if(files.length>20)throw Error('Upload up to 20 files at a time.');
 for(const f of files){if(!/\.(pdf|docx?|xlsx?|pptx?|txt|rtf|jpe?g|png|gif|webp|heic|heif)$/i.test(f.name))throw Error(`${f.name}: choose a PDF, Office document, text file or image. Use Upload for GIS data.`);if(!f.size||f.size>SUPPORTING_LIMIT)throw Error(`${f.name}: files must be non-empty and no larger than 50 MB.`);if(f.name.length>240)throw Error('Shorten the file name to 240 characters or fewer.');}
 if(files.reduce((n,f)=>n+f.size,0)>300*1024*1024)throw Error('Upload up to 300 MB at a time.');
}
export async function uploadSupportingFiles({db,project,userId,files,group='',local=false,onSaved=()=>{},progress=()=>{}}){
 validateSupportingFiles(files);group=normaliseSupportingGroup(group);
 if((project.supporting_files?.length||0)+files.length>200)throw Error('Use up to 200 supporting files per map.');
 for(const file of files){
  const path=`${userId}/${project.id}/supporting/${crypto.randomUUID()}/${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  progress(`Uploading ${file.name}…`);
  if(!local)await registerUpload(db,project.id,path);
  const uploaded=await db.storage.from('gis-files').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});if(uploaded.error)throw uploaded.error;
  const entry={...(group?{group}:{}),path,name:file.name,size:file.size,type:file.type||'application/octet-stream',uploaded_at:new Date().toISOString()};
  // Do not remove bytes on an uncertain response: registration may have committed.
  const result=await db.rpc('maps_supporting_file',{p_map:project.id,p_action:'add',p_file:entry});if(result.error)throw result.error;
  project.supporting_files=result.data;onSaved(result.data);
 }
}
export function installSupportingFiles({db,getProject,getUser,canEdit,local=false,onChanged=()=>{},setBusy=()=>{},onResize=()=>{}}){
 const panel=document.createElement('aside');panel.className='supporting-panel';panel.id='supporting-files-panel';panel.hidden=true;panel.setAttribute('aria-label','Supporting Files');
 panel.innerHTML=`<div class="supporting-heading" data-panel-drag title="Drag to move supporting files"><h2>Supporting Files</h2><button type="button" class="panel-drag-handle" data-panel-drag aria-label="Move supporting files panel (drag or use arrow keys)">⠿</button><button type="button" data-close aria-label="Close supporting files">×</button></div><input type="search" placeholder="Find a file…" aria-label="Find a supporting file"><details class="supporting-upload-options"><summary>＋ Add files</summary><p data-project></p><p class="field-note">Documents and images · 50 MB per file. Sync to publish changes.</p><label class="supporting-group-upload">Heading for uploads<input data-upload-group maxlength="80" list="supporting-group-names" placeholder="No group (optional)" aria-label="Heading for uploads"></label><datalist id="supporting-group-names"></datalist><label class="supporting-upload">Choose files<input type="file" multiple accept="${SUPPORTING_ACCEPT}" aria-label="Upload supporting files"></label></details><div data-list></div><p role="status" aria-live="polite"></p>`;
 document.querySelector('#app>main').append(panel);
 const win=document.defaultView,widthKey='fieldops-maps-supporting-width';
 try{const width=Number(win.localStorage.getItem(widthKey));if(width>=240&&width<=600)panel.style.width=width+'px';}catch{}
 function fitPanel(){if(panel.hidden)return;const r=panel.getBoundingClientRect();if(!r.width)return;const top=Math.max(4,r.top),value=top+'px';if(panel.style.getPropertyValue('--supporting-top')!==value)panel.style.setProperty('--supporting-top',value);if(r.right>win.innerWidth-8){panel.style.left=Math.max(8,win.innerWidth-r.width-8)+'px';panel.style.right='auto';}try{win.localStorage.setItem(widthKey,String(Math.round(r.width)));}catch{}}
 if(win.ResizeObserver)new win.ResizeObserver(fitPanel).observe(panel);
 if(win.MutationObserver)new win.MutationObserver(fitPanel).observe(panel,{attributes:true,attributeFilter:['style','hidden']});
 win.addEventListener('resize',fitPanel);
 const button=document.createElement('button');button.className='square';button.type='button';button.title='Supporting Files';button.setAttribute('aria-label','Supporting Files');button.innerHTML='<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 3h10l6 6v12H4zM14 3v6h6M8 13h8M8 17h8"/></svg>';
 (document.querySelector('.map-navigation')||document.querySelector('.map-tools')).append(button);
 let working=false,opened=false,projectId=null;const collapsed=new Set();const q=s=>panel.querySelector(s),status=q('[role=status]');
 const actionsUI=installSupportingActions({panel,getProject,canEdit,isBusy:()=>working,run,onChanged,db,editGroup,view:file=>openSupportingPreview(db,file)});
 function toggle(value){actionsUI.close();opened=value;panel.hidden=!getProject()||!opened;button.setAttribute('aria-expanded',String(!panel.hidden));onResize();}
 button.onclick=()=>toggle(!opened);q('[data-close]').onclick=()=>toggle(false);
 function draw(){actionsUI.close();const project=getProject();if((project?.id||null)!==projectId){projectId=project?.id||null;opened=false;collapsed.clear();q('[data-upload-group]').value='';q('input[type=search]').value='';}panel.hidden=!project||!opened;button.hidden=!project;button.setAttribute('aria-expanded',String(!panel.hidden));q('[data-project]').textContent=project?.name||'';q('.supporting-upload-options').hidden=!canEdit();q('.supporting-upload').hidden=!canEdit();q('.supporting-group-upload').hidden=!canEdit();q('[data-upload-group]').disabled=working;q('input[type=file]').disabled=working;
  const list=q('[data-list]');list.replaceChildren();const files=project?.supporting_files||[],term=q('input[type=search]').value.trim().toLowerCase();
  q('datalist').replaceChildren(...[...new Set(files.map(f=>normaliseSupportingGroup(f.group)).filter(Boolean))].map(group=>{const option=document.createElement('option');option.value=group;return option;}));
  for(const [group,items] of groupSupportingFiles(files,term)){
   const section=group?document.createElement('details'):document.createDocumentFragment();if(group){section.className='supporting-group';section.open=!!term||!collapsed.has(group);
   section.ontoggle=()=>{if(!term){if(section.open)collapsed.delete(group);else collapsed.add(group);}};
   const heading=document.createElement('summary');heading.textContent=`${group} (${items.length})`;section.append(heading);actionsUI.bindGroup(heading,project,group);}
   if(group&&canEdit()){const rename=document.createElement('button');rename.type='button';rename.className='supporting-rename';rename.textContent='⋯';rename.title='Rename heading';rename.setAttribute('aria-label',`Rename ${group}`);rename.disabled=working;rename.onclick=e=>section.querySelector('summary').oncontextmenu(e);section.append(rename);}
   for(const file of items){const row=document.createElement('div');row.className='supporting-file';row.tabIndex=0;row.title='Double-click to view';row.ondblclick=e=>{if(!e.target.closest('button'))void openSupportingPreview(db,file);};row.onkeydown=e=>{if(e.key==='Enter'&&e.target===row){e.preventDefault();void openSupportingPreview(db,file);}};const name=document.createElement('strong');name.textContent=file.name;const small=document.createElement('small');small.textContent=file.size>=1048576?(file.size/1048576).toFixed(1)+' MB':Math.max(1,Math.ceil(file.size/1024))+' KB';const icon=document.createElement('span');icon.className='supporting-file-icon';icon.textContent='▤';icon.setAttribute('aria-hidden','true');const copy=document.createElement('div');copy.className='supporting-file-copy';name.title=file.name;copy.append(name,small);const actions=document.createElement('div');actions.className='supporting-file-actions';row.append(icon,copy,actions);
   const download=document.createElement('button');download.type='button';download.textContent='↓';download.title='Download';download.setAttribute('aria-label',`Download ${file.name}`);download.disabled=working;download.onclick=()=>run(async()=>{const r=await db.storage.from('gis-files').download(file.path);if(r.error)throw r.error;const url=URL.createObjectURL(r.data),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);},false);actions.append(download);
   if(canEdit()){const move=document.createElement('button');move.type='button';move.textContent='⋯';move.title='File options';move.setAttribute('aria-label',`Group ${file.name}`);move.disabled=working;move.onclick=e=>row.oncontextmenu(e);actions.append(move);const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Remove from map';remove.setAttribute('aria-label',`Remove ${file.name}`);remove.disabled=working;remove.onclick=()=>run(async()=>{if(!document.defaultView.confirm(`Remove “${file.name}” from this map? The phone copy changes after Sync.`))return;const r=await db.rpc('maps_supporting_file',{p_map:project.id,p_action:'remove',p_file:{path:file.path}});if(r.error)throw r.error;project.supporting_files=r.data;onChanged();});actions.append(remove);}actionsUI.bindFile(row,project,file);section.append(row);
   }list.append(section);
  }
  if(!list.children.length){const p=document.createElement('p');p.className='field-note';p.textContent=term?'No matching files.':'No supporting files yet.';list.append(p);}onResize();
 }
 function editGroup(project,file,previous=''){
  if(working||!canEdit())return;
  const dialog=toolDialog(file?'Group file':'Rename heading',`<label>Heading<input name="group" maxlength="80" list="supporting-group-names" value="${esc(file?.group||previous)}" placeholder="No group (optional)"></label><p class="field-note">Leave blank to move ${file?'this file':'these files'} out of its group.</p>`);
  dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();if(project!==getProject()||!canEdit()){dialog.querySelector('.error').textContent='Map access changed.';return;}
   const group=normaliseSupportingGroup(dialog.querySelector('[name=group]').value);dialog.close();
   await run(async()=>{const r=await db.rpc('maps_supporting_file',{p_map:project.id,p_action:file?'group':'rename_group',p_file:file?{path:file.path,group}:{previous,group}});if(r.error)throw r.error;project.supporting_files=r.data;onChanged();});
  };
 }
 async function run(action,editing=true){if(working)return;if(editing&&!canEdit())return;working=true;setBusy(true,'Working on supporting files…');status.textContent='';draw();try{await action();status.textContent=editing?'Saved. Use Sync to publish changes to the app.':'Download ready.';}catch(e){status.textContent=e.message||'Could not complete the file operation.';}finally{working=false;setBusy(false);draw();}}
 const upload=files=>{const group=q('[data-upload-group]').value;return run(()=>uploadSupportingFiles({group,db,project:getProject(),userId:getUser()?.id||'local',files:[...files],local,onSaved:()=>onChanged(),progress:text=>status.textContent=text}));};
 q('input[type=file]').onchange=async e=>{await upload(e.target.files);e.target.value='';};q('input[type=search]').oninput=draw;
 panel.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();});panel.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();if(e.dataTransfer.files.length)void upload(e.dataTransfer.files);});draw();return {refresh:draw};
}
