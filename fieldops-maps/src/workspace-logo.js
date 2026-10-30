import {readPrintLayout,writePrintLayout} from './print-storage.js';
export const logoKey=(userId,workspaceId)=>`logo:${userId||'guest'}:${workspaceId||'personal'}`;
export async function mountWorkspaceLogo(host,userId,workspaceId){
 const document=host.ownerDocument,key=logoKey(userId,workspaceId),box=document.createElement('section');
 box.innerHTML='<h3>Workspace logo</h3><p>Use your logo on exported maps and print layouts. Saved for this workspace on this device.</p><img alt="Workspace logo" hidden style="max-width:180px;max-height:90px;object-fit:contain"><label>Upload logo (PNG, JPG or WebP, up to 5 MB)<input type="file" accept="image/png,image/jpeg,image/webp"></label><button type="button">Remove logo</button><p role="status"></p>';host.append(box);
 const image=box.querySelector('img'),input=box.querySelector('input'),status=box.querySelector('[role=status]'),remove=box.querySelector('button');
 const show=src=>{image.hidden=!src;if(src)image.src=src;else image.removeAttribute('src');remove.disabled=!src;};
 try{show(await readPrintLayout(key));}catch(e){status.textContent=e.message;}
 input.onchange=async()=>{const file=input.files[0];if(!file)return;input.disabled=true;remove.disabled=true;try{
  if(file.size>5*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose a PNG, JPG or WebP logo up to 5 MB.');
  const bitmap=await createImageBitmap(file),scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const src=canvas.toDataURL('image/png');await writePrintLayout(key,src);show(src);status.textContent='Logo saved. Add it from Workspace logo in the export editor.';
 }catch(e){status.textContent=e.message;remove.disabled=image.hidden;}finally{input.disabled=false;input.value='';}};
 remove.onclick=async()=>{try{await writePrintLayout(key,null);show(null);status.textContent='Logo removed. Existing layouts keep their placed images.';}catch(e){status.textContent=e.message;}};
}
