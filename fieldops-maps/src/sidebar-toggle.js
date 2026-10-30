export function installSidebarToggle({sidebar,toggle,collapse,reopen,onResize,win=window}){
 const body=sidebar.ownerDocument.body,compact=win.matchMedia('(max-width: 760px)');
 let open=!compact.matches;
 function setOpen(value){
  open=value;body.classList.toggle('layers-collapsed',!open);sidebar.classList.toggle('mobile-open',open&&compact.matches);
  toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-controls',sidebar.id);
  reopen.hidden=open;reopen.setAttribute('aria-expanded',String(open));reopen.setAttribute('aria-controls',sidebar.id);
  win.requestAnimationFrame(()=>onResize());
 }
 toggle.onclick=()=>setOpen(!open);collapse.onclick=()=>setOpen(false);reopen.onclick=()=>setOpen(true);
 compact.addEventListener('change',()=>setOpen(open));setOpen(open);
 return {setOpen};
}
