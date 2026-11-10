import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
import './compact-toolbar.css';
import {workspaceIcon} from './workspace-layout.js';
export const shortcutGuide=[
 ['Quick actions','⌘ K','Ctrl K'],['Find location','⌘ F or /','Ctrl F or /'],['Save draft','⌘ S','Ctrl S'],['Publish / sync','⌘ Shift S','Ctrl Shift S'],['Upload files','⌘ U','Ctrl U'],['Print','⌘ P','Ctrl P'],['Export image','⌘ Shift E','Ctrl Shift E'],['Photo locations / saved pins','P','P'],['Layers panel','L','L'],['My location','G','G'],['Fit all layers','F or 0','F or 0'],['Attribute table','T','T'],['Filter features','X','X'],['Measure distance','M','M'],['Compare layers','C','C'],['Switch satellite','B','B'],['Select features','V','V'],['Draw and edit','Shift E','Shift E'],['Zoom in / out','+ / −','+ / −'],['Home','⌘ Shift H','Ctrl Shift H'],['Hide / show interface','⌘ .','Ctrl .'],['Shortcut guide','? or ⌘ /','? or Ctrl /'],['Group selection','⌘ G','Ctrl G'],['Duplicate selection','⌘ D','Ctrl D'],['Undo feature deletion','⌘ Z','Ctrl Z'],['Delete selected features','Delete / Backspace','Delete / Backspace']
];
export function openShortcutGuide(){const d=toolDialog('Keyboard shortcuts',`<p>Shortcuts work while the map is active. Typing in fields keeps normal text editing. Save and Sync require editing access; selection actions require selected features.</p><div class="shortcut-table"><table><thead><tr><th>Action</th><th>Mac</th><th>Windows</th></tr></thead><tbody>${shortcutGuide.map(([name,mac,win])=>`<tr><td>${esc(name)}</td><td><kbd>${esc(mac)}</kbd></td><td><kbd>${esc(win)}</kbd></td></tr>`).join('')}</tbody></table></div>`);d.querySelector('[type=submit]').remove();return d;}
// Preserve the original toolbar categories and button order. Only decorate actions.
export function configureToolbarIcons(){
 const tools=document.querySelector('.toolbar-menus');if(!tools)return;
 const iconButton=(button,icon,label,shortcut,hint)=>{
  if(!button)return;
  button.classList.add('square');
  button.innerHTML=icon;
  button.setAttribute('aria-label',label);
  button.title=hint||label;
  if(shortcut)button.setAttribute('aria-keyshortcuts',shortcut);
 };
 for(const [id,icon,label,shortcut,hint] of [
  ['open-search','search','Find location','Meta+f Control+f /','Find location · ⌘/Ctrl+F or /'],
  ['open-table','table','Attribute table','t','Attribute table · T'],
  ['open-filter','filter','Filter features','x','Filter features · X'],
  ['open-measure','measure','Measure distance or area','m','Measure distance or area · M'],
  ['copy-map-data','download','Download map data']
 ])iconButton(document.getElementById(id),workspaceIcon(icon),label,shortcut,hint);
 iconButton(tools.querySelector('[aria-label="Map settings"]'),workspaceIcon('settings'),'Map settings');
 const photoIcon='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/></svg>';
 iconButton(tools.querySelector('[aria-label="Photo locations and saved pins"]'),photoIcon,'Photo locations and saved pins','p','Photo locations and saved pins · P');
 for(const [id,shortcut] of [['save-draft','Meta+s Control+s'],['sync-project','Meta+Shift+s Control+Shift+s']])document.getElementById(id)?.setAttribute('aria-keyshortcuts',shortcut);
}
