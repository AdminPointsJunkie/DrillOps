import {workspaceIcon} from './workspace-layout.js';
import {analysisTools} from './analysis-ui.js';
import {componentTools} from './map-components.js';
export function installToolMenus({analyse,component,draw,uploadURL,canCreate}){
 const header=document.querySelector('header'),tools=document.querySelector('.map-tools');header.append(tools);tools.classList.add('toolbar-menus');
 function menu(label,icon,items){const details=document.createElement('details');details.className='tool-menu';const summary=document.createElement('summary');summary.title=label;summary.setAttribute('aria-label',label);summary.innerHTML=workspaceIcon(icon);details.append(summary);const content=document.createElement('div');content.className='tool-menu-content';const title=document.createElement('small');title.textContent=label.toUpperCase();content.append(title);for(const item of items){if(item.id){const button=document.getElementById(item.id);if(button){button.classList.remove('square');content.append(button);button.addEventListener('click',()=>details.open=false);}}else{const b=document.createElement('button');b.type='button';b.textContent=item.label;b.setAttribute('aria-label',item.label);b.onclick=()=>{details.open=false;item.action();};if(item.edit)b.dataset.editTool='true';content.append(b);}}details.append(content);details.addEventListener('toggle',()=>{if(details.open)for(const other of document.querySelectorAll('.tool-menu'))if(other!==details)other.open=false;});tools.append(details);return content;}
 menu('Draw and annotate','draw',[{id:'open-drawing'},...['point','line','polygon','rectangle','circle'].map(mode=>({label:({point:'Pin',line:'Line / manual route',polygon:'Polygon',rectangle:'Rectangle',circle:'Circle'})[mode],action:()=>draw(mode),edit:true})),{id:'open-annotation'},{id:'open-measure'}]);
 menu('Upload','upload',[{label:'Upload files',action:()=>document.getElementById('files').click(),edit:true},{label:'From URL',action:uploadURL,edit:true},{label:'Add tile service',action:()=>document.getElementById('add-xyz').click(),edit:true},{label:'Supported file types',action:()=>window.open('./file-types.html','_blank','noopener')}]);
 menu('Analysis','layers',[...Object.entries(analysisTools).map(([id,label])=>({label,action:()=>analyse(id),edit:true})),{label:'Tool guide and limits',action:()=>window.open('./tools.html','_blank','noopener')}]);
 menu('Components','table',[{label:'Show components',action:()=>component('show')},...Object.entries(componentTools).map(([id,label])=>({label,action:()=>component(id)}))]);
 for(const id of ['open-search','open-filter','open-table']){const b=document.getElementById(id);b.title=b.textContent.trim();b.setAttribute('aria-label',b.title);tools.append(b);}
 const exports=menu('Export and print','download',[]);
 menu('Workspace and account','settings',['people','platform-admin','workspace-invitations','storage-usage-button','set-password','account'].map(id=>({id})));
 // Account controls remain the original buttons and retain their access checks.
 document.addEventListener('click',e=>{if(!e.target.closest('.tool-menu'))document.querySelectorAll('.tool-menu').forEach(d=>d.open=false);});
 tools.addEventListener('keydown',e=>{if(e.key==='Escape'){const d=e.target.closest('.tool-menu');if(d){d.open=false;d.querySelector('summary').focus();}}});
 return {addExport(button){exports.append(button);},refresh(){tools.querySelectorAll('[data-edit-tool]').forEach(b=>b.hidden=!canCreate());}};
}
