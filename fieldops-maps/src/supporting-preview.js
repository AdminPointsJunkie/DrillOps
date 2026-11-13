import {toolDialog} from './explore-dialogs.js';
export async function openSupportingPreview(db,file){
 const d=toolDialog(file.name,'<div class="supporting-preview-body" role="status">Loading preview…</div>');d.classList.add('supporting-preview');const body=d.querySelector('.supporting-preview-body'),download=d.querySelector('[type=submit]');download.type='button';download.textContent='Download';download.disabled=true;d.querySelector('.dialog-actions [data-dismiss]').textContent='Close';let url=null,closed=false;
 d.addEventListener('close',()=>{closed=true;if(url)URL.revokeObjectURL(url);},{once:true});
 try{const result=await db.storage.from('gis-files').download(file.path);if(result.error)throw result.error;if(closed)return d;
  const ext=file.name.split('.').pop().toLowerCase(),mime={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',txt:'text/plain'}[ext];
  const blob=mime?new Blob([result.data],{type:mime}):result.data;url=URL.createObjectURL(blob);
  download.disabled=false;download.onclick=()=>{const a=document.createElement('a');a.href=url;a.download=file.name;a.click();};body.replaceChildren();
  if(ext==='pdf'){const frame=document.createElement('iframe');frame.title=file.name;frame.src=url;body.append(frame);}
  else if(['png','jpg','jpeg','gif','webp'].includes(ext)){const img=document.createElement('img');img.alt=file.name;img.src=url;img.onerror=()=>{body.textContent='This image could not be displayed. Download it to view.';};body.append(img);}
  else if(ext==='txt'){const pre=document.createElement('pre');pre.textContent=await blob.text();if(!closed)body.append(pre);}
  else body.textContent='Preview is not available for this file type. Download it to open in its usual application.';
 }catch(error){if(!closed){body.textContent='Could not load the preview.';d.querySelector('.error').textContent=error.message;}}
 return d;
}
