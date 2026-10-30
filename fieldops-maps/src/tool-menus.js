import {installAppMenu} from './app-menu.js';
import {workspaceIcon} from './workspace-layout.js';
import {analysisTools} from './analysis-ui.js';
import {componentTools} from './map-components.js';
export function installToolMenus({analyse,component,draw,uploadURL,canCreate,home,annotate,canAnnotate=canCreate}){
 const header=document.querySelector('header'),tools=document.querySelector('.map-tools');header.append(tools);tools.classList.add('toolbar-menus');
 function menu(label,icon,items){const details=document.createElement('details');details.className='tool-menu';const summary=document.createElement('summary');summary.title=label;summary.setAttribute('aria-label',label);summary.innerHTML=workspaceIcon(icon);details.append(summary);const content=document.createElement('div');content.className='tool-menu-content';const title=document.createElement('small');title.textContent=label.toUpperCase();content.append(title);for(const item of items){if(item.id){const button=document.getElementById(item.id);if(button){button.classList.remove('square');content.append(button);button.addEventListener('click',()=>details.open=false);}}else{const b=document.createElement('button');b.type='button';b.textContent=item.label;b.setAttribute('aria-label',item.label);b.onclick=()=>{details.open=false;item.action();};if(item.edit)b.dataset.editTool='true';content.append(b);}}details.append(content);details.addEventListener('toggle',()=>{if(details.open)for(const other of document.querySelectorAll('.tool-menu'))if(other!==details)other.open=false;});tools.append(details);return content;}
 const drawMenu=menu('Draw and annotate','draw',[{id:'open-drawing'},...['point','line','polygon','rectangle','circle'].map(mode=>({label:({point:'Pin',line:'Line / manual route',polygon:'Polygon',rectangle:'Rectangle',circle:'Circle'})[mode],action:()=>draw(mode),edit:true})),{id:'open-annotation'},{id:'open-measure'}]);
 drawMenu.classList.add('draw-tool-content');
 const more=document.createElement('details');more.className='app-submenu annotation-more';more.dataset.annotationTool='true';
 more.innerHTML='<summary>More</summary><div class="app-submenu-items"></div>';
 const symbols={marker:'✎',highlighter:'▰',text:'T',note:'▤',link:'↗',image:'▧',video:'▶'};
 for(const [type,label] of Object.entries({marker:'Marker',highlighter:'Highlighter',text:'Text',note:'Note',link:'Link',image:'Image',video:'Video'})){
  const b=document.createElement('button');b.type='button';b.setAttribute('aria-label',label);b.innerHTML=`<span aria-hidden="true">${symbols[type]}</span><span>${label}</span>`;
  b.onclick=()=>{drawMenu.closest('.tool-menu').open=false;if(!canAnnotate())return;if(type==='image')document.getElementById('files').click();else annotate?.(type);};more.querySelector('div').append(b);
 }
 drawMenu.append(more);
 document.addEventListener('keydown',e=>{if(!e.shiftKey||e.metaKey||e.ctrlKey||e.altKey||e.repeat||!canAnnotate()||document.querySelector('dialog[open]')||document.body.classList.contains('project-home-open')||e.target.closest?.('input,textarea,select,[contenteditable=true]'))return;const type={M:'marker',H:'highlighter',T:'text',N:'note'}[e.key.toUpperCase()];if(type){e.preventDefault();annotate?.(type);}});
 const uploadMenu=menu('Upload','upload',[{label:'Upload files',action:()=>document.getElementById('files').click(),edit:true},{label:'From URL',action:uploadURL,edit:true},{label:'Add tile service',action:()=>document.getElementById('add-xyz').click(),edit:true},{label:'Supported file types',action:()=>window.open('./file-types.html','_blank','noopener')}]);
 for(const id of ['dropzone','add-xyz','files'])uploadMenu.append(document.getElementById(id));
 menu('Analysis','layers',[...Object.entries(analysisTools).map(([id,label])=>({label,action:()=>analyse(id),edit:true})),{label:'Tool guide and limits',action:()=>window.open('./tools.html','_blank','noopener')}]);
 menu('Components','dashboard',[{label:'Show components',action:()=>component('show')},...Object.entries(componentTools).map(([id,label])=>({label,action:()=>component(id)}))]);
 for(const id of ['open-search','open-filter','open-table']){const b=document.getElementById(id);b.title=b.textContent.trim();b.setAttribute('aria-label',b.title);tools.append(b);}
 const exports=menu('Export and print','download',[]);
 const accountContent=menu('Workspace and account','settings',['people','platform-admin','workspace-invitations','storage-usage-button','set-password','account'].map(id=>({id})));
 const appMenu=installAppMenu({accountContent,canCreate,home});
 // Account controls remain the original buttons and retain their access checks.
 document.addEventListener('click',e=>{if(!e.target.closest('.tool-menu'))document.querySelectorAll('.tool-menu').forEach(d=>d.open=false);});
 tools.addEventListener('keydown',e=>{if(e.key==='Escape'){const d=e.target.closest('.tool-menu');if(d){d.open=false;d.querySelector('summary').focus();}}});
 return {openQuick:()=>appMenu.openQuick(),addAction:(...args)=>appMenu.addAction(...args),addExport(button){exports.append(button);appMenu.addExport(button);},refresh(){appMenu.refresh();more.hidden=!canAnnotate();tools.querySelectorAll('[data-edit-tool]').forEach(b=>b.hidden=!canCreate());}};
}
