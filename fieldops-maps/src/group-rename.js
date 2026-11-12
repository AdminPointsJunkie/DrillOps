export function renameGroupInline({root,group,onSave,canEdit=()=>true}){
 const row=[...root.querySelectorAll('[data-group]')].find(el=>el.dataset.group===group.id);
 const title=row?.querySelector('.group-collapse');if(!title||!canEdit())return;
 const input=root.ownerDocument.createElement('input');input.className='group-name-input';input.setAttribute('aria-label','Group name');input.maxLength=100;input.value=group.name;title.hidden=true;title.after(input);let done=false;
 function finish(save){if(done)return;done=true;const name=input.value.trim();input.remove();title.hidden=false;if(save&&name&&name!==group.name&&canEdit()){group.name=name;onSave();}else title.focus();}
 input.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();finish(true);}else if(e.key==='Escape'){e.preventDefault();finish(false);}});input.addEventListener('blur',()=>finish(true));input.focus();input.select();return input;
}
