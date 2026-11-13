// Shared dragging for floating map windows and dialogs.
export function installPanelDragging(doc=document){
 const selectors='#sidebar,[data-layer-panel],.layer-context-menu,.supporting-panel,.map-floating-panel,.attribute-table,.feature-info,.feature-search,.field-tools-panel,.geometry-editor,.map-compare-panel,dialog';
 const win=doc.defaultView,positions=new Map();let drag=null;
 const key=p=>p.id||p.dataset.layerPanel;
 function place(panel,left,top){let r=panel.getBoundingClientRect();if(panel.matches('.attribute-table')){panel.style.boxSizing='border-box';panel.style.width=Math.min(r.width,win.innerWidth-8)+'px';panel.style.maxWidth='calc(100vw - 8px)';r=panel.getBoundingClientRect();}const x=Math.max(4,Math.min(left,win.innerWidth-r.width-4)),y=Math.max(4,Math.min(top,win.innerHeight-Math.min(r.height,win.innerHeight-8)-4));Object.assign(panel.style,{position:'fixed',margin:'0',transform:'none',left:x+'px',top:y+'px',right:'auto',bottom:'auto',maxHeight:Math.max(100,win.innerHeight-y-4)+'px'});if(panel.id==='sidebar'){panel.style.setProperty('--sidebar-top',y+'px');panel.style.removeProperty('max-height');}if(key(panel))positions.set(key(panel),{left:x,top:y});}
 doc.addEventListener('pointerdown',e=>{const handle=e.target.closest('[data-panel-drag]');if(!handle||e.button!==0||e.target.closest('input,select,textarea,a')||(e.target.closest('button')&&!e.target.closest('.panel-drag-handle')))return;const panel=handle.closest(selectors);if(!panel)return;const r=panel.getBoundingClientRect();drag={panel,handle,id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top};handle.setPointerCapture?.(e.pointerId);e.preventDefault();e.stopPropagation();});
 doc.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<4)return;place(drag.panel,drag.left+e.clientX-drag.x,drag.top+e.clientY-drag.y);e.preventDefault();});
 const finish=e=>{if(!drag||drag.id!==e.pointerId)return;const current=drag;drag=null;if(current.handle.hasPointerCapture?.(e.pointerId))current.handle.releasePointerCapture(e.pointerId);};
 doc.addEventListener('pointerup',finish);doc.addEventListener('pointercancel',finish);
 doc.addEventListener('keydown',e=>{const handle=e.target.closest('.panel-drag-handle');if(!handle||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;const panel=handle.closest(selectors),r=panel.getBoundingClientRect(),step=e.shiftKey?40:10;e.preventDefault();place(panel,r.left+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),r.top+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0));});
 win.addEventListener('resize',()=>{for(const panel of doc.querySelectorAll(selectors))if(panel.style.left&&!panel.hidden){const r=panel.getBoundingClientRect();place(panel,r.left,r.top);}});
 function refresh(){for(const panel of doc.querySelectorAll(selectors)){
 const saved=positions.get(key(panel));if(saved&&!panel.style.left)Object.assign(panel.style,{position:'fixed',left:saved.left+'px',top:saved.top+'px',right:'auto'});
 const heading=panel.querySelector('[data-panel-drag],.inspector-heading,.dialog-heading,.info-heading,.tools-heading,header,.table-toolbar,h2,h3');
 if(heading&&!heading.hasAttribute('data-panel-drag')){heading.dataset.panelDrag='';heading.title='Drag to move panel';}
 if(!heading){const b=doc.createElement('button');b.type='button';b.className='panel-drag-handle';b.dataset.panelDrag='';b.textContent='\u283f';b.setAttribute('aria-label','Move panel (drag or use arrow keys)');panel.prepend(b);}
 if(panel.matches('dialog[open]')&&!panel.dataset.dragPositioned){panel.dataset.dragPositioned='';const r=panel.getBoundingClientRect();place(panel,r.left,r.top);}
 }}
 const observer=new win.MutationObserver(refresh);observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});refresh();return {refresh};
}
