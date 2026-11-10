import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
import './compact-toolbar.css';
export const shortcutGuide=[
 ['Quick actions','⌘ K','Ctrl K'],['Find location','⌘ F or /','Ctrl F or /'],['Save draft','⌘ S','Ctrl S'],['Publish / sync','⌘ Shift S','Ctrl Shift S'],['Upload files','⌘ U','Ctrl U'],['Print','⌘ P','Ctrl P'],['Export image','⌘ Shift E','Ctrl Shift E'],['Photo locations / saved pins','P','P'],['Layers panel','L','L'],['My location','G','G'],['Fit all layers','F or 0','F or 0'],['Attribute table','T','T'],['Filter features','X','X'],['Measure distance','M','M'],['Compare layers','C','C'],['Switch satellite','B','B'],['Select features','V','V'],['Draw and edit','Shift E','Shift E'],['Zoom in / out','+ / −','+ / −'],['Home','⌘ Shift H','Ctrl Shift H'],['Hide / show interface','⌘ .','Ctrl .'],['Shortcut guide','? or ⌘ /','? or Ctrl /'],['Group selection','⌘ G','Ctrl G'],['Duplicate selection','⌘ D','Ctrl D'],['Undo feature deletion','⌘ Z','Ctrl Z'],['Delete selected features','Delete / Backspace','Delete / Backspace']
];
export function openShortcutGuide(){const d=toolDialog('Keyboard shortcuts',`<p>Shortcuts work while the map is active. Typing in fields keeps normal text editing. Save and Sync require editing access; selection actions require selected features.</p><div class="shortcut-table"><table><thead><tr><th>Action</th><th>Mac</th><th>Windows</th></tr></thead><tbody>${shortcutGuide.map(([name,mac,win])=>`<tr><td>${esc(name)}</td><td><kbd>${esc(mac)}</kbd></td><td><kbd>${esc(win)}</kbd></td></tr>`).join('')}</tbody></table></div>`);d.querySelector('[type=submit]').remove();return d;}
export function streamlineToolbar(){
 const tools=document.querySelector('.toolbar-menus');if(!tools)return;
 tools.classList.add('compact-toolbar');
 const more=document.createElement('details');more.className='tool-menu toolbar-more';const summary=document.createElement('summary');summary.textContent='Tools';summary.title='More map tools';summary.setAttribute('aria-label','More map tools');const content=document.createElement('div');content.className='tool-menu-content';more.append(summary,content);
 const moveButton=(el,label)=>{if(!el)return;el.classList.remove('square');if(label)el.textContent=label;content.append(el);};
 for(const [id,label] of [['open-table','Attribute table · T'],['open-filter','Filter features · X'],['open-measure','Measure · M'],['open-compare','Compare layers · C'],['copy-map-data',null]])moveButton(document.getElementById(id),label);
 for(const menu of [...tools.querySelectorAll(':scope > .tool-menu')]){
  const title=menu.querySelector('summary')?.getAttribute('aria-label');
  if(['Annotations','Upload'].includes(title)){menu.querySelector('summary').append(document.createTextNode(title==='Annotations'?'Draw':'Add data'));continue;}
  const inner=menu.querySelector('.tool-menu-content');if(!inner)continue;
  const group=document.createElement('details');group.className='app-submenu';const heading=document.createElement('summary');heading.textContent=title||'More';group.append(heading);inner.classList.remove('tool-menu-content');inner.classList.add('app-submenu-items');group.append(inner);content.append(group);menu.remove();
 }
 const settings=tools.querySelector('[aria-label="Map settings"]');moveButton(settings,'Map settings');
 const help=document.createElement('button');help.type='button';help.textContent='Keyboard shortcuts · ?';help.onclick=openShortcutGuide;content.append(help);
 more.addEventListener('toggle',()=>{if(more.open)document.querySelectorAll('.tool-menu').forEach(d=>{if(d!==more)d.open=false;});});
 content.addEventListener('click',e=>{if(e.target.closest('button,a'))more.open=false;});tools.append(more);
 const search=document.getElementById('open-search');if(search){search.textContent='Search';search.classList.add('toolbar-labelled');search.setAttribute('aria-label','Find location');search.title='Find location · ⌘/Ctrl+F or /';search.setAttribute('aria-keyshortcuts','Meta+f Control+f /');}
 const photo=tools.querySelector('[aria-label="Photo locations and saved pins"]');if(photo){photo.textContent='Photos';photo.classList.add('toolbar-labelled');photo.title='Photo locations and saved pins · P';photo.setAttribute('aria-keyshortcuts','p');}
 for(const [id,shortcut] of [['save-draft','Meta+s Control+s'],['sync-project','Meta+Shift+s Control+Shift+s']])document.getElementById(id)?.setAttribute('aria-keyshortcuts',shortcut);
}
