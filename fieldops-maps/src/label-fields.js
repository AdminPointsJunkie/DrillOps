export function readLabelFields(card){return [...new Set([...card.querySelectorAll('[data-action=labelFields]')].map(el=>el.value).filter(Boolean))];}
export function installLabelFieldControls(root,canEdit){
 root.addEventListener('click',e=>{
  const button=e.target.closest('[data-label-add],[data-label-remove]');if(!button)return;
  const card=button.closest('[data-id]');if(!card||!canEdit(card))return;
  const list=button.closest('.label-field-list');
  if(button.hasAttribute('data-label-add')){const row=list.querySelector('.label-field-row').cloneNode(true);row.querySelector('select').value='';button.before(row);row.querySelector('select').focus();}
  else{const row=button.closest('.label-field-row');if(list.querySelectorAll('.label-field-row').length>1)row.remove();else row.querySelector('select').value='';const select=list.querySelector('select');select.dispatchEvent(new root.ownerDocument.defaultView.Event('change',{bubbles:true}));select.focus();}
  [...list.querySelectorAll('select')].forEach((select,i)=>select.setAttribute('aria-label','Label field '+(i+1)));
 });
}
