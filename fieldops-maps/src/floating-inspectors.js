// Keep editor nodes in their layer cards for delegated events, but render them
// above scrolling ancestors. Safari otherwise clips fixed editors to the sidebar.
export function installFloatingInspectors(root,menu,doc=document){
 const supported=typeof doc.defaultView.HTMLElement.prototype.showPopover==='function';
 if(!supported)return {refresh(){}};
 function sync(element){
  if(!element.hasAttribute('popover'))element.setAttribute('popover','manual');
  const open=element.matches(':popover-open');
  if(element.hidden){if(open)element.hidePopover();}
  else if(element.isConnected&&!open)element.showPopover();
 }
 function refresh(){for(const panel of root.querySelectorAll('[data-layer-panel]'))sync(panel);sync(menu);}
 const observer=new doc.defaultView.MutationObserver(refresh);
 observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});
 observer.observe(menu,{attributes:true,attributeFilter:['hidden']});
 refresh();return {refresh};
}
