/* Collapsing changes presentation only; tables still require explicit loading in Settings. */
function setEosSectionExpanded(section,expanded){
 section.classList.toggle('is-collapsed',!expanded);
 section.querySelector(':scope > .eos-section-content').hidden=!expanded;
 section.querySelector('.eos-section-toggle').setAttribute('aria-expanded',String(expanded));
}
for(const page of document.querySelectorAll('#page-app-home,#page-production,#page-reports')){
 const sections=[...page.querySelectorAll('.eos-panel,.production-panel,.eos-document-section')];
 sections.forEach((section,index)=>{
  const heading=section.querySelector(':scope > h3,:scope > .eos-panel-heading h2,:scope > .production-panel-heading h2');if(!heading)return;
  const headingRow=heading.parentElement===section?heading:heading.parentElement,button=document.createElement('button'),content=document.createElement('div');
  button.type='button';button.className='eos-section-toggle';button.setAttribute('aria-expanded','true');
  content.className='eos-section-content';content.id=page.id+'-section-'+index;button.setAttribute('aria-controls',content.id);
  while(heading.firstChild)button.append(heading.firstChild);heading.append(button);
  let after=headingRow.nextSibling;while(after){const next=after.nextSibling;content.append(after);after=next;}
  section.append(content);section.classList.add('eos-collapsible');button.addEventListener('click',()=>setEosSectionExpanded(section,section.classList.contains('is-collapsed')));
 });
 if(!sections.length)continue;
 const toolbar=document.createElement('div');toolbar.className='eos-section-controls';
 for(const expanded of [true,false]){
  const button=document.createElement('button');button.type='button';button.className='btn-ghost';button.textContent=expanded?'Expand all':'Collapse all';
  button.addEventListener('click',()=>sections.filter(s=>s.classList.contains('eos-collapsible')).forEach(s=>setEosSectionExpanded(s,expanded)));toolbar.append(button);
 }
 if(page.id!=='page-app-home'){const note=document.createElement('small');note.textContent='Print includes expanded sections.';toolbar.append(note);}
 const anchor=page.id==='page-reports'?page.querySelector('#eos-period-document'):page.id==='page-app-home'?page.querySelector('.eos-workspace-grid'):page.querySelector('.production-panel');
 anchor.before(toolbar);
}
