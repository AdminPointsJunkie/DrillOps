import {registerUpload} from './upload-meter.js';
export const SUPPORTING_LIMIT=50*1024*1024;
export const SUPPORTING_ACCEPT='.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.rtf,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif';
export function validateSupportingFiles(files){
 if(!files.length)throw Error('Choose a supporting file.');
 if(files.length>20)throw Error('Upload up to 20 files at a time.');
 for(const f of files){if(!/\.(pdf|docx?|xlsx?|pptx?|txt|rtf|jpe?g|png|gif|webp|heic|heif)$/i.test(f.name))throw Error(`${f.name}: choose a PDF, Office document, text file or image. Use Upload for GIS data.`);if(!f.size||f.size>SUPPORTING_LIMIT)throw Error(`${f.name}: files must be non-empty and no larger than 50 MB.`);if(f.name.length>240)throw Error('Shorten the file name to 240 characters or fewer.');}
 if(files.reduce((n,f)=>n+f.size,0)>300*1024*1024)throw Error('Upload up to 300 MB at a time.');
}
export async function uploadSupportingFiles({db,project,userId,files,local=false,onSaved=()=>{},progress=()=>{}}){
 validateSupportingFiles(files);
 if((project.supporting_files?.length||0)+files.length>200)throw Error('Use up to 200 supporting files per project.');
 for(const file of files){
  const path=`${userId}/${project.id}/supporting/${crypto.randomUUID()}/${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  progress(`Uploading ${file.name}…`);
  if(!local)await registerUpload(db,project.id,path);
  const uploaded=await db.storage.from('gis-files').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});if(uploaded.error)throw uploaded.error;
  const entry={path,name:file.name,size:file.size,type:file.type||'application/octet-stream',uploaded_at:new Date().toISOString()};
  // Do not remove bytes on an uncertain response: registration may have committed.
  const result=await db.rpc('maps_supporting_file',{p_map:project.id,p_action:'add',p_file:entry});if(result.error)throw result.error;
  project.supporting_files=result.data;onSaved(result.data);
 }
}
export function installSupportingFiles({db,getProject,getUser,canEdit,local=false,onChanged=()=>{},setBusy=()=>{},onResize=()=>{}}){
 const panel=document.createElement('aside');panel.className='supporting-panel';panel.setAttribute('aria-label','Supporting Files');
 panel.innerHTML=`<div class="supporting-heading"><h2>Supporting Files</h2><button type="button" data-close aria-label="Close supporting files">×</button></div><p data-project></p><p class="field-note">Documents and images · 50 MB per file.<br>Use Sync to publish changes to the app.</p><label class="supporting-upload">＋ Upload supporting files<input type="file" multiple accept="${SUPPORTING_ACCEPT}" aria-label="Upload supporting files"></label><input type="search" placeholder="Find a file…" aria-label="Find a supporting file"><div data-list></div><p role="status" aria-live="polite"></p>`;
 document.querySelector('#app>main').append(panel);
 const button=document.createElement('button');button.className='square';button.type='button';button.title='Supporting Files';button.setAttribute('aria-label','Supporting Files');button.innerHTML='<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 3h10l6 6v12H4zM14 3v6h6M8 13h8M8 17h8"/></svg>';
 (document.querySelector('.map-navigation')||document.querySelector('.map-tools')).append(button);
 let working=false,opened=(document.defaultView?.innerWidth||1280)>1100;const q=s=>panel.querySelector(s),status=q('[role=status]');
 function toggle(value){opened=value;panel.hidden=!getProject()||!opened;button.setAttribute('aria-expanded',String(!panel.hidden));onResize();}
 button.onclick=()=>toggle(!opened);q('[data-close]').onclick=()=>toggle(false);
 function draw(){const project=getProject();panel.hidden=!project||!opened;button.hidden=!project;button.setAttribute('aria-expanded',String(!panel.hidden));q('[data-project]').textContent=project?.name||'';q('.supporting-upload').hidden=!canEdit();q('input[type=file]').disabled=working;
  const list=q('[data-list]');list.replaceChildren();const files=project?.supporting_files||[],term=q('input[type=search]').value.trim().toLowerCase();
  for(const file of files.filter(f=>f.name.toLowerCase().includes(term))){const row=document.createElement('div');row.className='supporting-file';const name=document.createElement('strong');name.textContent=file.name;const small=document.createElement('small');small.textContent=file.size>=1048576?(file.size/1048576).toFixed(1)+' MB':Math.max(1,Math.ceil(file.size/1024))+' KB';row.append(name,small);
   const download=document.createElement('button');download.type='button';download.textContent='↓ Download';download.setAttribute('aria-label',`Download ${file.name}`);download.disabled=working;download.onclick=()=>run(async()=>{const r=await db.storage.from('gis-files').download(file.path);if(r.error)throw r.error;const url=URL.createObjectURL(r.data),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);},false);row.append(download);
   if(canEdit()){const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Remove from project';remove.setAttribute('aria-label',`Remove ${file.name}`);remove.disabled=working;remove.onclick=()=>run(async()=>{if(!document.defaultView.confirm(`Remove “${file.name}” from this project? The phone copy changes after Sync.`))return;const r=await db.rpc('maps_supporting_file',{p_map:project.id,p_action:'remove',p_file:{path:file.path}});if(r.error)throw r.error;project.supporting_files=r.data;onChanged();});row.append(remove);}list.append(row);
  }
  if(!list.children.length){const p=document.createElement('p');p.className='field-note';p.textContent=term?'No matching files.':'No supporting files yet.';list.append(p);}onResize();
 }
 async function run(action,editing=true){if(working)return;if(editing&&!canEdit())return;working=true;setBusy(true,'Working on supporting files…');status.textContent='';draw();try{await action();status.textContent=editing?'Saved. Use Sync to publish changes to the app.':'Download ready.';}catch(e){status.textContent=e.message||'Could not complete the file operation.';}finally{working=false;setBusy(false);draw();}}
 const upload=files=>run(()=>uploadSupportingFiles({db,project:getProject(),userId:getUser()?.id||'local',files:[...files],local,onSaved:()=>onChanged(),progress:text=>status.textContent=text}));
 q('input[type=file]').onchange=async e=>{await upload(e.target.files);e.target.value='';};q('input[type=search]').oninput=draw;
 panel.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();});panel.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();if(e.dataTransfer.files.length)void upload(e.dataTransfer.files);});draw();return {refresh:draw};
}
