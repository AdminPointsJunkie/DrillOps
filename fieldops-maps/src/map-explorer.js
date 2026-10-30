import {attributeFields,matchesView,legendItems,tableRows,textValue,featureTitle,featureInfo,featureBounds} from './explore-data.js';
import {escapeHTML as esc,filterDialog,popupDialog} from './explore-dialogs.js';
export function installMapExplorer({L,map,getLayers,isVisible,canEdit,redraw,saveStyle,showInfo,renderInfo=(l,f)=>featureInfo(l,f,document)}){
 let componentFilter=()=>true;const views=new Map();let current='',sortField='',direction=1,page=0,selected=null,selection=null,searchTimer,tableTimer;
 const root=document.querySelector('.map-area');
 root.insertAdjacentHTML('beforeend',`<section class="attribute-table" hidden aria-label="Attribute table"><div class="table-toolbar"><strong>Table</strong><select data-table-layer aria-label="Table layer"></select><input data-table-search type="search" placeholder="Find in this layer…" aria-label="Filter table and map"><button data-filter title="Filter layer">⏷ Filters</button><button data-reset title="Reset this view">Reset</button><button data-save-view title="Save filters and legend choices as the project default">Save default</button><button data-info-settings title="Configure feature information">⚙ Fields</button><button data-close-table aria-label="Close table">×</button></div><div class="table-summary"><span data-table-count></span><label><input type="checkbox" data-extent> Table: current map extent only</label><span data-view-note></span></div><div class="table-scroll"><table><thead></thead><tbody></tbody></table></div><div class="table-pagination"><button data-page="-1">Previous</button><span data-page-label></span><button data-page="1">Next</button></div></section><section class="feature-search" hidden aria-label="Search features"><div class="info-heading"><strong>Find a hole or asset</strong><button data-close-search aria-label="Close search">×</button></div><input type="search" data-global-search placeholder="Search visible layers…" aria-label="Search visible features"><p class="field-note">Searches features matching your current filters and legend choices.</p><div class="feature-results" role="status"></div></section>`);
 const table=root.querySelector('.attribute-table'),search=root.querySelector('.feature-search'),q=s=>table.querySelector(s);
 const vectors=()=>getLayers().filter(l=>l.kind==='vector');
 const layer=()=>vectors().find(l=>l.id===current);
 const view=l=>{if(!views.has(l.id))views.set(l.id,structuredClone(l.metadata?.style?.view||{}));return views.get(l.id);};
 function acceptFeature(l,f){return matchesView(l,f,view(l))&&componentFilter(l,f);}
 function clearSelection(){if(selection){map.removeLayer(selection);selection=null;}selected=null;}
 function select(l,index,zoom=true){
  const feature=l.fc?.features[index];if(!feature)return;clearSelection();selected={id:l.id,index};
  selection=L.geoJSON(feature,{style:{color:'#f5b700',weight:5,fillOpacity:.15},pointToLayer:(_f,ll)=>L.circleMarker(ll,{radius:12,color:'#f5b700',weight:3,fillOpacity:.1,interactive:false}),interactive:false});selection.addTo(map);
  const b=featureBounds(feature);if(zoom&&b)map.fitBounds([[b[1],b[0]],[b[3],b[2]]],{padding:[60,60],maxZoom:19});
  showInfo(featureTitle(l,feature,index),renderInfo(l,feature));current=l.id;search.hidden=true;
  if(!table.hidden){const rows=currentRows(),position=rows.findIndex(r=>r.index===index);if(position>=0)page=Math.floor(position/100);renderTable();}
 }
 function currentRows(){const l=layer();if(!l)return [];let bounds=null;if(q('[data-extent]').checked){const b=map.getBounds();bounds=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];}return tableRows(l,view(l),{field:sortField,direction,bounds}).filter(r=>componentFilter(l,r.feature));}
 function renderTable(){
  if(table.hidden)return;
  const list=vectors();if(!list.some(l=>l.id===current)){current=list[0]?.id||'';sortField='';page=0;}
  q('[data-table-layer]').innerHTML=list.map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');q('[data-table-layer]').value=current;
  const l=layer(),fields=l?attributeFields(l.fc):[],rows=currentRows();page=Math.min(page,Math.max(0,Math.ceil(rows.length/100)-1));
  if(document.activeElement!==q('[data-table-search]'))q('[data-table-search]').value=l?view(l).search||'':'';
  q('thead').innerHTML=`<tr><th>Show</th>${fields.map(f=>`<th><button data-sort="${esc(f)}">${esc(f)}${sortField===f?(direction===1?' ↑':' ↓'):''}</button></th>`).join('')}</tr>`;
  q('tbody').innerHTML=rows.slice(page*100,page*100+100).map(({feature,index})=>`<tr data-feature="${index}" class="${selected?.id===current&&selected.index===index?'selected':''}" tabindex="0" aria-label="Show ${esc(featureTitle(l,feature,index))}"><td><button data-show="${index}" aria-label="Show feature on map">◎</button></td>${fields.map(f=>`<td>${esc(textValue(feature.properties?.[f]))}</td>`).join('')}</tr>`).join('');
  q('[data-table-count]').textContent=l?`${rows.length.toLocaleString()} of ${l.fc.features.length.toLocaleString()} features${isVisible(l)?'':' · layer hidden'}`:'No vector layers';
  q('[data-page-label]').textContent=`Page ${page+1} of ${Math.max(1,Math.ceil(rows.length/100))}`;
  q('[data-page="-1"]').disabled=page===0;q('[data-page="1"]').disabled=(page+1)*100>=rows.length;
  for(const selector of ['[data-save-view]','[data-info-settings]'])q(selector).hidden=!l||!canEdit(l);
  q('[data-view-note]').textContent='View changes are personal until saved as a default.';
 }
 function renderLegends(){
  for(const l of vectors()){
   const card=[...document.querySelectorAll('.layer-card')].find(c=>c.dataset.id===l.id);if(!card)continue;
   let legend=card.querySelector('.layer-legend');if(!legend){legend=document.createElement('details');legend.className='layer-legend';legend.open=Boolean(l.metadata?.style?.rules);card.append(legend);}
   const entries=legendItems({...l,fc:{...l.fc,features:l.fc.features.filter(f=>componentFilter(l,f))}},view(l));legend.innerHTML=`<summary>Legend <small>${(view(l).filter?.conditions?.length||view(l).search)?'· filtered':''}</small></summary>${entries.map(c=>`<label><input type="checkbox" data-legend-key="${esc(c.key)}" ${c.visible?'checked':''}><span class="legend-swatch" style="color:${/^#[\da-f]{6}$/i.test(c.color)?c.color:'#147d72'}">${({circle:'●',square:'■',triangle:'▲',diamond:'◆',cross:'✚'})[c.symbol]||'●'}</span><span>${esc(c.label)}</span><small>${c.count}</small></label>`).join('')}<div class="legend-actions"><button type="button" data-open-table>▦ Table</button><button type="button" data-open-filter>⏷ Filter</button>${canEdit(l)?'<button type="button" data-save-default>Save default</button>':''}</div>`;
  }
 }
 function refreshSearch(){
  if(search.hidden)return;const text=search.querySelector('input').value.trim().toLowerCase(),results=[];let count=0;
  if(text)for(const l of vectors().filter(isVisible))for(const [index,f] of l.fc.features.entries())if(acceptFeature(l,f)&&Object.values(f.properties||{}).some(v=>textValue(v).toLowerCase().includes(text))){count++;if(results.length<50)results.push({l,index,f});}
  search.querySelector('.feature-results').innerHTML=(text?`<small>${count} matches${count>50?' · first 50 shown; refine your search':''}</small>`:'')+results.map(({l,index,f})=>`<button data-result-layer="${esc(l.id)}" data-result-index="${index}"><strong>${esc(featureTitle(l,f,index))}</strong><small>${esc(l.name)}</small></button>`).join('');
 }
 function refresh(){renderLegends();renderTable();refreshSearch();if(selected){const l=getLayers().find(l=>l.id===selected.id),f=l?.fc?.features[selected.index];if(!l||!f||!isVisible(l)||!acceptFeature(l,f))clearSelection();}}
 function changed(l){clearSelection();redraw(l);page=0;refresh();document.dispatchEvent(new document.defaultView.Event('fieldmaps-view-change'));}
 function openTable(id){current=id||current;table.hidden=false;root.classList.add('table-open');renderTable();}
 function openFilter(l){if(!l)return;filterDialog(l,view(l),filter=>{view(l).filter=filter;changed(l);});}
 async function saveDefault(l){if(!l||!canEdit(l))return;await saveStyle(l,'view',structuredClone(view(l)));}
 function resetView(l){if(!l)return;views.set(l.id,structuredClone(l.metadata?.style?.view||{}));changed(l);}
 q('[data-table-layer]').onchange=e=>{current=e.target.value;sortField='';page=0;renderTable();};
 q('[data-table-search]').oninput=e=>{const l=layer();if(!l)return;const value=e.target.value;clearTimeout(tableTimer);tableTimer=setTimeout(()=>{view(l).search=value;changed(l);},180);};
 q('[data-filter]').onclick=()=>openFilter(layer());q('[data-reset]').onclick=()=>resetView(layer());
 q('[data-save-view]').onclick=()=>saveDefault(layer()).catch(error=>showMessage(error.message));
 q('[data-info-settings]').onclick=()=>{const l=layer();if(l&&canEdit(l))popupDialog(l,config=>saveStyle(l,'popup',config));};
 q('[data-extent]').onchange=()=>{page=0;renderTable();};
 q('[data-close-table]').onclick=()=>{table.hidden=true;root.classList.remove('table-open');};
 table.onclick=e=>{const sort=e.target.closest('[data-sort]'),row=e.target.closest('[data-feature]'),paging=e.target.closest('[data-page]');if(sort){direction=sortField===sort.dataset.sort?-direction:1;sortField=sort.dataset.sort;page=0;renderTable();}else if(row){select(layer(),Number(row.dataset.feature));}else if(paging){page+=Number(paging.dataset.page);renderTable();}};
 table.onkeydown=e=>{const row=e.target.closest('[data-feature]');if(row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();select(layer(),Number(row.dataset.feature));}};
 function showMessage(message){q('[data-view-note]').textContent=message;}
 document.querySelector('#layers').addEventListener('change',e=>{if(e.target.dataset.legendKey===undefined)return;const l=getLayers().find(l=>l.id===e.target.closest('[data-id]')?.dataset.id);if(!l)return;const hidden=new Set(view(l).hiddenClasses||[]);if(e.target.checked)hidden.delete(e.target.dataset.legendKey);else hidden.add(e.target.dataset.legendKey);view(l).hiddenClasses=[...hidden];changed(l);});
 document.querySelector('#layers').addEventListener('click',e=>{const l=getLayers().find(l=>l.id===e.target.closest('[data-id]')?.dataset.id);if(!l)return;if(e.target.closest('[data-open-table]'))openTable(l.id);if(e.target.closest('[data-open-filter]'))openFilter(l);if(e.target.closest('[data-save-default]'))saveDefault(l).catch(error=>{openTable(l.id);showMessage(error.message);});});
 search.querySelector('[data-global-search]').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(refreshSearch,150);};
 search.querySelector('[data-close-search]').onclick=()=>search.hidden=true;
 search.onclick=e=>{const b=e.target.closest('[data-result-layer]');if(b){const l=getLayers().find(l=>l.id===b.dataset.resultLayer);if(l)select(l,Number(b.dataset.resultIndex));}};
 map.on('moveend',()=>{if(q('[data-extent]').checked)renderTable();});
 return {selectedFeature(){const l=getLayers().find(l=>l.id===selected?.id);return l?.fc?.features[selected?.index]||null;},acceptFeature,refresh,select,openTable,setComponentFilter(predicate){componentFilter=predicate;for(const l of vectors())redraw(l);refresh();},rekey(oldID,newID){if(views.has(oldID)){views.set(newID,views.get(oldID));views.delete(oldID);}if(current===oldID)current=newID;},openFilter:()=>{openTable();openFilter(layer());},openSearch(){search.hidden=!search.hidden;if(!search.hidden){refreshSearch();search.querySelector('input').focus();}},reset(){views.clear();current='';page=0;clearSelection();clearTimeout(tableTimer);clearTimeout(searchTimer);search.querySelector('input').value='';search.hidden=true;table.hidden=true;root.classList.remove('table-open');}};
}
