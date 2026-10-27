export function installSidebarResize(handle,sidebar,onResize,win=handle.ownerDocument.defaultView){
 const key='fieldops-maps-sidebar-width',defaultWidth=285,min=240;
 let preferred=defaultWidth,drag=null,frame=null;
 try{const saved=Number.parseInt(win.localStorage.getItem(key),10);if(Number.isFinite(saved))preferred=saved;}catch{}
 const max=()=>Math.max(min,Math.min(600,win.innerWidth-320));
 const clamp=value=>Math.max(min,Math.min(max(),value));
 function apply(value){
  const width=clamp(value);sidebar.style.setProperty('--sidebar-width',`${width}px`);
  handle.setAttribute('aria-valuenow',String(width));handle.setAttribute('aria-valuemin',String(min));handle.setAttribute('aria-valuemax',String(max()));
  if(frame!==null)win.cancelAnimationFrame(frame);
  frame=win.requestAnimationFrame(()=>{frame=null;onResize();});return width;
 }
 function persist(){try{win.localStorage.setItem(key,String(preferred));}catch{}}
 handle.addEventListener('pointerdown',e=>{
  if(e.button!==0||win.innerWidth<=760)return;e.preventDefault();
  drag={id:e.pointerId,x:e.clientX,width:clamp(preferred)};handle.setPointerCapture(e.pointerId);win.document.body.classList.add('sidebar-resizing');
 });
 handle.addEventListener('pointermove',e=>{if(drag&&drag.id===e.pointerId)apply(drag.width+e.clientX-drag.x);});
 function finish(e){
  if(!drag||drag.id!==e.pointerId)return;const previous=drag;drag=null;
  preferred=apply(e.type==='pointercancel'?previous.width:previous.width+e.clientX-previous.x);persist();
  win.document.body.classList.remove('sidebar-resizing');if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);
 }
 handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);
 handle.addEventListener('lostpointercapture',()=>{if(drag){drag=null;win.document.body.classList.remove('sidebar-resizing');apply(preferred);}});
 handle.addEventListener('keydown',e=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();
  const step=e.shiftKey?50:10;
  preferred=apply(e.key==='Home'?min:e.key==='End'?max():clamp(preferred)+(e.key==='ArrowLeft'?-step:step));persist();
 });
 handle.addEventListener('dblclick',()=>{preferred=apply(defaultWidth);persist();});
 win.addEventListener('resize',()=>apply(preferred));apply(preferred);
}
