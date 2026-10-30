const paths={
 layers:'M3 7l9-5 9 5-9 5zM3 12l9 5 9-5M3 17l9 5 9-5',
 draw:'M14 4l6 6-10 10H4v-6zM12 6l6 6M16 2l6 6',
 table:'M3 4h18v16H3zM3 9h18M9 9v11M15 9v11',
 search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6',
 filter:'M3 4h18l-7 8v7l-4 2v-9z',
 measure:'M3 15L15 3l6 6L9 21zM12 6l3 3M8 10l3 3M4 14l3 3',
 note:'M5 3h14v13l-5 5H5zM14 21v-5h5M8 7h8M8 11h6',
 fit:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 8h8v8H8z',
 locate:'M12 2v3M12 19v3M2 12h3M19 12h3M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
 info:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v6M12 7v.5',
 help:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 16v1',
 plus:'M12 5v14M5 12h14',upload:'M12 16V3M7 8l5-5 5 5M4 15v6h16v-6',
 link:'M10 14l4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
 refresh:'M20 7V2M20 7h-5M4 17v5M4 17h5M4 9a8 8 0 0 1 14-5l2 3M20 15a8 8 0 0 1-14 5l-2-3',
 close:'M6 6l12 12M18 6L6 18',download:'M12 3v13M7 11l5 5 5-5M4 17v4h16v-4',
 settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8'
};
export function workspaceIcon(name){return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(paths[name]||paths.layers).split(/(?=M)/).filter(Boolean).map(d=>`<path d="${d}"/>`).join('')}</svg>`;}
export function installWorkspaceLayout(doc=document){
 const $=s=>doc.querySelector(s),header=$('header'),tools=$('.map-tools');
 const sync=$('.sync-controls');header.append(sync);
 const nav=doc.createElement('nav');nav.className='map-navigation';nav.setAttribute('aria-label','Map navigation');$('.map-area').append(nav);
 for(const id of ['mobile-layers','fit','locate','identify','help'])nav.append($('#'+id));
 tools.setAttribute('role','toolbar');tools.setAttribute('aria-label','Map tools');
 const names={'open-drawing':['draw','Draw'],'open-annotation':['note','Note'],'open-measure':['measure','Measure'],'open-table':['table','Table'],'open-search':['search','Search'],'open-filter':['filter','Filter']};
 for(const id of ['open-drawing','open-annotation','open-measure','open-search','open-filter','open-table']){const b=$('#'+id);b.innerHTML=workspaceIcon(names[id][0])+`<span>${names[id][1]}</span>`;tools.append(b);}
 for(const [id,name] of Object.entries({'mobile-layers':'layers',fit:'fit',locate:'locate',identify:'info',help:'help','new-map':'plus',refresh:'refresh','new-group':'plus'})){
  const b=$('#'+id);b.innerHTML=workspaceIcon(name);if(!b.getAttribute('aria-label'))b.setAttribute('aria-label',b.title||id);}
 $('#dropzone').innerHTML=workspaceIcon('upload')+'<div><strong>Add data</strong><span>Drop files here or browse</span></div>';
 $('#add-xyz').innerHTML=workspaceIcon('layers')+'<span>Add tile layer</span>';
 $('.workspace-label').textContent='PROJECT';$('.sidebar-bottom').innerHTML='<span class="workspace-footer-dot"></span><span>DrillOps FieldMaps</span><button type="button" class="workspace-help" aria-label="Open help">Help</button>';
 $('.workspace-help').onclick=()=>$('#help').click();

 // Keep the layer rail dedicated to layers; move project and import controls out.
 const picker=$('.map-picker');picker.classList.add('header-project');header.insertBefore(picker,header.children[1]);
 $('.workspace-label').remove();$('.sidebar-bottom').remove();
 $('#project-crs').closest('form').append($('#project-default'));
 const imports=doc.createElement('section');imports.className='map-import-status';imports.setAttribute('aria-label','Import queue');imports.append($('#import-job'),$('#queue'));$('.map-area').append(imports);
 const collapse=doc.createElement('button');collapse.type='button';collapse.id='collapse-layers';collapse.title='Collapse layers';collapse.setAttribute('aria-label','Collapse layers');collapse.innerHTML='‹';collapse.onclick=()=>$('#mobile-layers').click();$('#sidebar .tabs').append(collapse);
 $('.map-title').setAttribute('aria-live','polite');
 function refresh(){
  for(const card of doc.querySelectorAll('.layer-card')){
   const title=card.querySelector('.layer-top strong')?.textContent||'Layer';
   const status=card.querySelector('.layer-top small');if(status)status.title=status.textContent;
   const name=card.querySelector('.layer-top strong');if(name)name.title=title+' · '+(card.querySelector('.crs-tag')?.textContent||'');
   for(const [action,name] of Object.entries({geometry:'draw',settings:'settings',export:'download',remove:'close'})){const b=card.querySelector(`[data-action="${action}"]`);if(b)b.innerHTML=workspaceIcon(name);}
   for(const panel of card.querySelectorAll('[data-layer-panel]'))if(!panel.querySelector('.inspector-heading')){
    const heading=doc.createElement('div');heading.className='inspector-heading';const label=doc.createElement('div'),small=doc.createElement('small'),strong=doc.createElement('strong');
    small.textContent=panel.dataset.layerPanel==='style'?'LAYER STYLE':'ORGANISE LAYER';strong.textContent=title;label.append(small,strong);
    const close=doc.createElement('button');close.type='button';close.dataset.action='close-panel';close.setAttribute('aria-label','Close layer options');close.innerHTML=workspaceIcon('close');heading.append(label,close);panel.prepend(heading);
   }
  }
 }
 refresh();return {refresh};
}
