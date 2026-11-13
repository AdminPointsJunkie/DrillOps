export function installFileDropOverlay(doc=document){
 const win=doc.defaultView,zone=doc.querySelector('#dropzone'),area=doc.querySelector('.map-area');let depth=0,timer;
 function clear(){depth=0;win.clearTimeout(timer);zone?.classList.remove('dragging');area?.classList.remove('photo-drop-active');}
 function show(e){if(!Array.from(e.dataTransfer?.types||[]).includes('Files'))return;e.preventDefault();zone?.classList.add('dragging');area?.classList.add('photo-drop-active');win.clearTimeout(timer);timer=win.setTimeout(clear,2000);}
 doc.addEventListener('dragenter',e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files')){depth++;show(e);}},true);
 doc.addEventListener('dragover',show,true);
 doc.addEventListener('dragleave',e=>{depth=Math.max(0,depth-1);if(!depth||e.relatedTarget===null&&(e.clientX<=0||e.clientY<=0||e.clientX>=win.innerWidth||e.clientY>=win.innerHeight))clear();},true);
 // Capture runs even when a panel handles the drop and stops propagation.
 for(const type of ['drop','dragend','pointerdown'])doc.addEventListener(type,clear,true);
 doc.addEventListener('keydown',e=>{if(e.key==='Escape')clear();},true);
 win.addEventListener('blur',clear);doc.addEventListener('visibilitychange',()=>{if(doc.hidden)clear();});
 return {clear};
}
