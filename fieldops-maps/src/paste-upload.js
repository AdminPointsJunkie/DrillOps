import Papa from 'papaparse';
import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
export function preparePastedData(text,name='Pasted data'){
 if(!text.trim())throw Error('Paste spreadsheet rows, CSV or GeoJSON first.');
 if(new Blob([text]).size>5*1024*1024)throw Error('Pasted data is limited to 5 MB. Upload a file for larger imports.');
 name=name.trim().replace(/[\\/]/g,'-')||'Pasted data';
 if(/^[\s]*[\[{]/.test(text)){
  let value;try{value=JSON.parse(text);}catch{throw Error('This looks like JSON but is not valid. Check brackets and commas.');}
  const fc=value.type==='FeatureCollection'?value:value.type==='Feature'?{type:'FeatureCollection',features:[value]}:value.coordinates?{type:'FeatureCollection',features:[{type:'Feature',geometry:value,properties:{}}]}:null;
  if(!fc||!Array.isArray(fc.features)||!fc.features.length||fc.features.some(f=>f?.type!=='Feature'||!f.geometry))throw Error('Paste GeoJSON containing features with geometry.');
  if(fc.features.length>20000)throw Error('Use up to 20,000 features per layer.');
  const columns=[...new Set(fc.features.flatMap(f=>Object.keys(f.properties||{})))];
  return {file:new File([JSON.stringify(fc)],name+'.geojson',{type:'application/geo+json'}),count:fc.features.length,columns,rows:fc.features.slice(0,5).map(f=>columns.map(c=>f.properties?.[c]??'')),kind:'features'};
 }
 const parsed=Papa.parse(text.replace(/^\uFEFF/,''),{skipEmptyLines:'greedy'});if(parsed.errors.some(e=>e.code!=='UndetectableDelimiter'))throw Error('Could not read the table. Check quotes and column separators.');
 const [raw,...rows]=parsed.data,columns=raw?.map(v=>String(v).trim());
 if(!columns?.length||columns.some(c=>!c)||new Set(columns).size!==columns.length)throw Error('The first row must contain unique, non-empty column names.');
 if(!rows.length)throw Error('Include a header row and at least one data row.');
 if(rows.length>20000)throw Error('Use up to 20,000 rows per layer.');
 if(rows.some(r=>r.length!==columns.length))throw Error('Every row needs the same number of columns as the header.');
 return {file:new File([Papa.unparse([columns,...rows])],name+'.csv',{type:'text/csv'}),count:rows.length,columns,rows:rows.slice(0,5),kind:'rows'};
}
export function openPasteUpload({handleFiles,canCreate}){
 if(!canCreate())return;
 const d=toolDialog('Paste data','<p>Paste a table, CSV or GeoJSON with column headings.</p><label>Layer name<input name="name" required maxlength="160" value="Pasted data"></label><label>Data<textarea name="data" rows="8" spellcheck="false" placeholder="Name\tLongitude\tLatitude&#10;Site A\t151.21\t-33.86" required></textarea></label><button type="button" data-preview>Preview data</button><div data-table-preview></div>');d.classList.add('paste-data-dialog');const q=s=>d.querySelector(s);q('[type=submit]').textContent='Review import';
 function preview(){const data=preparePastedData(q('[name=data]').value,q('[name=name]').value);q('[data-table-preview]').innerHTML=`<p>${data.count.toLocaleString()} ${data.kind} · ${data.columns.length} columns</p><div class="paste-table"><table><thead><tr>${data.columns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${data.rows.map(row=>`<tr>${row.map(v=>`<td>${esc(typeof v==='object'?JSON.stringify(v):v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><small>First ${data.rows.length} records shown.</small>`;return data;}
 q('[data-preview]').onclick=()=>{q('.error').textContent='';try{preview();}catch(e){q('.error').textContent=e.message;}};
 q('[name=data]').oninput=()=>q('[data-table-preview]').replaceChildren();
 q('form').onsubmit=async e=>{e.preventDefault();const button=q('[type=submit]');button.disabled=true;q('.error').textContent='';try{if(!canCreate())throw Error('Project access changed. Reopen Paste data.');const data=preview();await handleFiles([data.file]);d.close();}catch(error){q('.error').textContent=error.message;}finally{button.disabled=false;}};return d;
}
