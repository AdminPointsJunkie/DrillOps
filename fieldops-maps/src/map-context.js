import {locationLinks} from './map-coordinates.js';
import './map-context.css';
export function installMapContext({map,coordinates,canEdit,comment,measure,compare,paste,notify}){
 const menu=document.createElement('section');menu.className='map-context';menu.hidden=true;menu.setAttribute('aria-label','Map location actions');document.body.append(menu);
 menu.innerHTML=`<button class="context-coordinate" data-copy disabled>Loading coordinates…</button><small data-crs></small><button data-comment>Add comment…</button><details><summary>Measure <span>›</span></summary><div class="context-submenu"><button data-measure="distance">Distance</button><button data-measure="area">Area</button></div></details><button data-compare>Compare…</button><hr><details><summary>Open in <span>›</span></summary><div class="context-submenu" data-links></div></details><hr><button data-paste>Paste here <kbd>⌘ V</kbd></button>`;
 let point=null,text='',revision=0;
 const close=()=>{menu.hidden=true;revision++;menu.querySelectorAll('details').forEach(d=>d.open=false);};
 async function open(e){close();point={lat:e.latlng.lat,lng:e.latlng.lng};const current=revision;menu.hidden=false;text='';const copy=menu.querySelector('[data-copy]');copy.disabled=true;copy.textContent='Loading coordinates…';menu.querySelector('[data-crs]').textContent='';
  for(const name of ['comment','paste'])menu.querySelector(`[data-${name}]`).disabled=!canEdit();
  const links=menu.querySelector('[data-links]');links.replaceChildren();for(const [name,url] of locationLinks(point,map.getZoom())){const a=document.createElement('a');a.textContent=name;a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.onclick=close;links.append(a);}
  const rect=map.getContainer().getBoundingClientRect(),x=e.originalEvent?.clientX??rect.left+e.containerPoint.x,y=e.originalEvent?.clientY??rect.top+e.containerPoint.y;
  menu.style.left=Math.max(8,Math.min(x,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-menu.offsetHeight-8))+'px';menu.classList.toggle('open-left',x+menu.offsetWidth+202>innerWidth);menu.querySelector('[data-compare]').focus();
  try{const result=await coordinates(point);if(current!==revision)return;text=result.text;copy.textContent=text;copy.disabled=false;menu.querySelector('[data-crs]').textContent=result.label+' · '+result.axes;}catch(error){if(current===revision){copy.textContent='Coordinates unavailable';menu.querySelector('[data-crs]').textContent=error.message;}}
 }
 const action=(selector,fn)=>menu.querySelector(selector).onclick=async()=>{const at={...point};close();try{await fn(at);}catch(e){notify(e.message);}};
 action('[data-copy]',async()=>{await navigator.clipboard.writeText(text);notify('Coordinates copied.');});action('[data-comment]',comment);action('[data-compare]',compare);
 action('[data-paste]',async at=>{try{await paste(await navigator.clipboard.readText(),at);}catch(e){if(e.name==='NotAllowedError')notify('Clipboard access was blocked. Right-click again and press ⌘V / Ctrl+V to paste.');else throw e;}});
 menu.querySelectorAll('[data-measure]').forEach(b=>b.onclick=()=>{const at={...point};close();measure(b.dataset.measure,at);});
 menu.querySelectorAll(':scope > button').forEach(b=>b.addEventListener('mouseenter',()=>menu.querySelectorAll('details').forEach(d=>d.open=false)));
 menu.querySelectorAll('details').forEach(d=>{d.querySelector('summary').onclick=e=>{e.preventDefault();d.open=true;};d.addEventListener('mouseenter',()=>{menu.querySelectorAll('details').forEach(other=>other.open=other===d);});});
 document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))close();});document.addEventListener('keydown',e=>{if(menu.hidden)return;if(e.key==='Escape'){close();map.getContainer().focus();}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const items=[...menu.querySelectorAll('button:not(:disabled),summary,a')].filter(x=>x.getClientRects().length),i=items.indexOf(document.activeElement);items[(i+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}});
 document.addEventListener('paste',e=>{if(menu.hidden||!canEdit()||/INPUT|TEXTAREA/.test(e.target.tagName)||e.target.isContentEditable)return;const value=e.clipboardData?.getData('text/plain');if(!value)return;e.preventDefault();const at={...point};close();Promise.resolve(paste(value,at)).catch(error=>notify(error.message));});
 map.on('contextmenu',open);map.on('movestart',close);window.addEventListener('resize',close);return {close};
}
