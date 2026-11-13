// One shared window order for floating map panels. Native popovers escape
// ancestor stacking/clipping without moving nodes or breaking delegated events.
const installed=new WeakMap();
const panels='.tool-menu-content,#sidebar,#sidebar-resizer,.attribute-table,[data-layer-panel],.layer-context-menu,.map-floating-panel,.supporting-panel,.feature-info,.feature-search,.field-tools-panel,.geometry-editor,.map-compare-panel,dialog.attribute-dialog,dialog.analysis-dialog,dialog.route-panel,dialog.lidar-panel,dialog.explore-dialog';
export function installPanelStack(doc=document){
 if(installed.has(doc))return installed.get(doc);
 const win=doc.defaultView,supported=typeof win.HTMLElement.prototype.showPopover==='function',states=new Map();let order=[],front=null,refreshing=false,bringing=false;
 const modal=()=>{try{return doc.querySelector('dialog:modal');}catch{return null;}};
 const isModal=p=>{try{return p.matches(':modal');}catch{return false;}};
 const visible=p=>p.isConnected&&!p.closest('[hidden]')&&(!p.matches('dialog')||p.open)&&win.getComputedStyle(p).display!=='none';
 function opened(p){return supported&&p.matches(':popover-open');}
 function register(p){if(states.has(p)||isModal(p))return;states.set(p,{positioned:false});order.push(p);p.dataset.panelStack='';if(supported)p.setAttribute('popover','manual');}
 function position(p){const state=states.get(p);if(state.positioned)return;
  // Remove the closed-popover display rule briefly to measure the original box.
  if(supported)p.removeAttribute('popover');
  let rect=p.getBoundingClientRect();const css=win.getComputedStyle(p);
  if(p.matches('dialog')){Object.assign(p.style,{position:'fixed',margin:'0',transform:'none',maxHeight:'calc(100dvh - 8px)',boxSizing:'border-box',overflow:'auto'});p.style.top=Math.max(4,Math.min(rect.top,win.innerHeight-rect.height-4))+'px';p.style.left=Math.max(4,Math.min(rect.left,win.innerWidth-rect.width-4))+'px';p.style.right='auto';p.style.bottom='auto';rect=p.getBoundingClientRect();}
  if(css.position==='absolute'||css.position==='fixed'||p.matches('dialog')){
   const bottom=p.matches('.attribute-table');
   Object.assign(p.style,{position:'fixed',margin:'0',top:bottom?'auto':rect.top+'px',bottom:bottom?Math.max(0,win.innerHeight-rect.bottom)+'px':'auto'});
   if(p.matches('.attribute-table')){p.style.left=rect.left+'px';p.style.right=Math.max(0,win.innerWidth-rect.right)+'px';p.style.width='auto';}
   else if(p.id!=='sidebar'&&p.id!=='sidebar-resizer'&&!p.matches('.layer-context-menu')&&!p.style.left){p.style.left='auto';p.style.right=Math.max(0,win.innerWidth-rect.right)+'px';}
   else{p.style.left=rect.left+'px';p.style.right='auto';}
   if(/^\d+(\.\d+)?%$/.test(css.maxHeight)){const parent=p.parentElement?.getBoundingClientRect(),offset=Math.max(0,win.innerHeight-(parent?.height||win.innerHeight));p.style.maxHeight=`calc((100dvh - ${offset}px) * ${parseFloat(css.maxHeight)/100})`;}
  }
  if(p.matches('.tool-menu-content')){const anchor=p.closest('.tool-menu')?.querySelector('summary')?.getBoundingClientRect();if(anchor){const width=p.getBoundingClientRect().width;Object.assign(p.style,{position:'fixed',left:Math.max(4,Math.min(anchor.left,win.innerWidth-width-4))+'px',right:'auto',top:Math.min(anchor.bottom+6,win.innerHeight-60)+'px',bottom:'auto',maxHeight:Math.max(40,win.innerHeight-anchor.bottom-10)+'px',overflowY:'auto'});}}
  if(supported)p.setAttribute('popover','manual');state.positioned=true;
 }
 function eligible(p){
  // A closed popover's UA display:none must not be mistaken for app visibility.
  if(p.matches('.tool-menu-content')&&!p.closest('.tool-menu')?.open)return false;
  // Full-screen workspaces make the map inert. Its top-layer popovers must
  // disappear too, otherwise they cover the workspace with unusable controls.
  if(!p.isConnected||p.closest('[hidden],[inert]')||p.matches('dialog')&&!p.open)return false;
  if(supported&&!opened(p)){p.removeAttribute('popover');const shown=win.getComputedStyle(p).display!=='none';p.setAttribute('popover','manual');return shown;}
  return visible(p);
 }
 function show(p){position(p);if(supported){if(!opened(p))p.showPopover();}else p.style.zIndex=String(700+order.indexOf(p));}
 function hide(p){if(opened(p))p.hidePopover();if(p.matches('.tool-menu-content'))states.get(p).positioned=false;}
 function bringToFront(p){
  if(bringing||!p||modal()||doc.body.classList.contains('project-home-open'))return;register(p);if(!eligible(p)||front===p)return;
  order=order.filter(item=>item!==p);order.push(p);if(!supported)for(const item of order)item.style.zIndex=String(700+order.indexOf(item));
  const focused=doc.activeElement,restore=p.contains(focused);bringing=true;front=p;hide(p);show(p);
  if(p.id==='sidebar'){const handle=doc.getElementById('sidebar-resizer');if(handle){register(handle);if(eligible(handle)){hide(handle);show(handle);}}}
  if(restore&&doc.activeElement!==focused)focused.focus({preventScroll:true});bringing=false;
 }
 function refresh(){if(refreshing)return;refreshing=true;try{
  for(const p of doc.querySelectorAll(panels))register(p);
  const suspended=doc.body.classList.contains('project-home-open');
  for(const p of [...order]){if(!p.isConnected){states.delete(p);order=order.filter(item=>item!==p);if(front===p)front=null;continue;}
   if(isModal(p))continue;
   if(suspended||!eligible(p)){hide(p);if(front===p)front=null;continue;}
   if(modal())continue;
   if(!supported||!opened(p)){show(p);if(p.id!=='sidebar-resizer')front=p;}
  }
 }finally{refreshing=false;}}
 const activate=e=>{const p=e.target.closest?.('[data-panel-stack]');if(p)bringToFront(p.id==='sidebar-resizer'?doc.getElementById('sidebar'):p);};
 doc.addEventListener('pointerdown',activate,true);doc.addEventListener('focusin',activate,true);
 doc.addEventListener('click',activate,true);
 const observer=new win.MutationObserver(refresh);observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','open','inert']});
 const bodyObserver=new win.MutationObserver(refresh);bodyObserver.observe(doc.body,{attributes:true,attributeFilter:['class']});
 win.addEventListener('resize',()=>{for(const p of order){if(!eligible(p))continue;const r=p.getBoundingClientRect();if(r.left<4||r.right>win.innerWidth-4){p.style.left=Math.max(4,Math.min(r.left,win.innerWidth-r.width-4))+'px';p.style.right='auto';}if(r.top<4||r.top>win.innerHeight-40){p.style.top=Math.max(4,Math.min(r.top,win.innerHeight-40))+'px';p.style.bottom='auto';}}});
 const api={refresh,bringToFront,register(p){register(p);refresh();}};installed.set(doc,api);refresh();return api;
}
