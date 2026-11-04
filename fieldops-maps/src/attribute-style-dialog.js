import {attributeFields,attributeSymbols,attributeEvaluator,classifyFeatures} from './attribute-style.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function openAttributeStyle(layer,onApply,{onPreview=()=>()=>{}}={}){
 let clearMapPreview=()=>{};
 const fields=attributeFields(layer.fc),saved=layer.metadata?.style?.rules;
 let classes=structuredClone(saved?.classes||[]);
 const dialog=document.createElement('dialog');dialog.className='attribute-dialog';
 dialog.innerHTML=`<form><div class="dialog-heading"><h2>Style by value</h2><button type="button" data-close aria-label="Close">×</button></div><p>${esc(layer.name)} · Choose classes or enter formulas for each feature.</p>
 <label>Style method<select name="mode"><option value="single">Single style</option><option value="categorized">Categorized — unique values</option><option value="graduated">Graduated — numeric ranges</option><option value="expression">Formulas</option></select></label>
 <section data-classify><div class="classification-options"><label>Column<select name="field">${fields.map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select></label><label data-count>Classes<input name="count" type="number" min="2" max="12" value="5"></label><label data-method>Breaks<select name="breaks"><option value="equal">Equal intervals</option><option value="quantile">Quantiles</option><option value="jenks">Natural breaks (Jenks)</option><option value="manual">Manual limits</option></select></label><label data-manual>Manual limits<input name="limits" placeholder="0, 10, 25, 50, 100"></label><label>Colour palette<select name="palette"><option value="categorical">Distinct colours</option><option value="green">Green · light to dark</option><option value="blue">Blue · light to dark</option><option value="heat">Yellow to red</option></select></label><button type="button" data-classify-button>Classify</button></div><p class="field-note">Edit the colour, symbol and size of each class. Numeric ranges include their lower limit; the last range includes its upper limit. Quantiles balance feature counts where possible; tied values stay together.</p><div class="class-table-scroll"><table><thead><tr><th>Value / range</th><th>Colour</th><th>Symbol</th><th>Size (px)</th></tr></thead><tbody></tbody></table></div></section>
 <section data-formulas><p>Use <code>[Column name]</code> for a cell value and quotes for text. Leave a formula blank to use the normal layer style.</p><label>Insert column<select name="insert"><option value="">Choose a column…</option>${fields.map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select></label>
 <label>Colour formula<input name="colorExpression" placeholder="if([Status] = 'Complete', '#147d72', '#ce6359')"></label><label>Symbol formula<input name="symbolExpression" placeholder="if([Depth] > 100, 'triangle', 'circle')"></label><label>Size formula (4–48 px)<input name="pointSizeExpression" placeholder="min(30, 6 + [Depth] / 10)"></label><small>Symbols: circle, square, triangle, diamond, cross. Colours: #RRGGBB. Functions: if, min, max, abs, round, sqrt, coalesce. Arithmetic, comparisons, and/or/not are supported. This is a simple formula language, not the full QGIS expression syntax.</small></section>
 <p class="field-note">Missing, unmatched or invalid results use the normal layer style. Layer opacity still applies.</p><p data-message role="status" aria-live="polite"></p><div data-preview class="attribute-preview"></div><div class="attribute-actions"><button type="button" data-preview-button>Preview</button><button type="button" data-close>Cancel</button><button class="primary" type="submit">Apply style</button></div></form>`;
 document.body.append(dialog);const form=dialog.querySelector('form'),get=name=>form.elements.namedItem(name),q=s=>dialog.querySelector(s),message=q('[data-message]');
 get('breaks').value=saved?.method||'equal';get('limits').value=saved?.limits||'';get('palette').value=saved?.palette||'categorical';
 get('mode').value=saved?.mode||'single';get('field').value=fields.includes(saved?.field)?saved.field:fields[0]||'';
 for(const key of ['color','symbol','pointSize'])get(key+'Expression').value=saved?.expressions?.[key]||'';
 function drawClasses(){q('tbody').innerHTML=classes.map((c,i)=>`<tr data-row="${i}"><td>${esc(c.label??`${Number(Number(c.min).toPrecision(8))} – ${Number(Number(c.max).toPrecision(8))}`)}</td><td><input data-key="color" type="color" value="${esc(c.color)}" aria-label="Colour for class ${i+1}"></td><td><select data-key="symbol" aria-label="Symbol for class ${i+1}">${attributeSymbols.map(s=>`<option ${s===c.symbol?'selected':''}>${s}</option>`).join('')}</select></td><td><input data-key="pointSize" type="number" min="4" max="48" value="${esc(c.pointSize)}" aria-label="Size for class ${i+1}"></td></tr>`).join('');}
 function clearPreview(){clearMapPreview();clearMapPreview=()=>{};message.textContent='';q('[data-preview]').replaceChildren();}
 function modeChanged(){const mode=get('mode').value;q('[data-classify]').hidden=!['categorized','graduated'].includes(mode);q('[data-formulas]').hidden=mode!=='expression';q('[data-count]').hidden=mode!=='graduated';q('[data-method]').hidden=mode!=='graduated';q('[data-manual]').hidden=mode!=='graduated'||get('breaks').value!=='manual';clearPreview();}
 get('mode').onchange=()=>{classes=[];drawClasses();modeChanged();};
 get('field').onchange=get('count').onchange=get('limits').onchange=get('breaks').onchange=get('palette').onchange=()=>{classes=[];drawClasses();modeChanged();};
 form.addEventListener('input',e=>{const row=e.target.closest('[data-row]');if(row){classes[Number(row.dataset.row)][e.target.dataset.key]=e.target.dataset.key==='pointSize'?Number(e.target.value):e.target.value;}clearPreview();});
 let lastFormula=get('colorExpression');for(const key of ['color','symbol','pointSize'])get(key+'Expression').onfocus=()=>{lastFormula=get(key+'Expression');};
 get('insert').onchange=()=>{if(!get('insert').value)return;lastFormula.setRangeText(`[${get('insert').value}]`,lastFormula.selectionStart,lastFormula.selectionEnd,'end');lastFormula.focus();get('insert').value='';clearPreview();};
 q('[data-classify-button]').onclick=()=>{try{classes=classifyFeatures(layer.fc,get('field').value,get('mode').value,get('count').value,get('breaks').value,get('palette').value,get('limits').value);drawClasses();preview();}catch(e){message.textContent=e.message;}};
 function config(){
  const mode=get('mode').value;if(mode==='single')return null;
  if(mode==='expression')return {mode,expressions:Object.fromEntries(['color','symbol','pointSize'].map(k=>[k,get(k+'Expression').value.trim()]))};
  if(!classes.length)throw new Error('Click Classify to generate classes for this column.');
  return {mode,limits:get('limits').value,method:get('breaks').value,palette:get('palette').value,field:get('field').value,classes:structuredClone(classes)};
 }
 function preview(){
  if(!form.reportValidity())return;
  try{const rules=config(),evaluate=attributeEvaluator(rules,fields),features=layer.fc?.features||[];let styled=0;const samples=[];
   for(const f of features){const s=evaluate(f.properties||{});if(Object.keys(s).length)styled++;if(samples.length<5)samples.push(s);}
   message.textContent=rules?`${styled.toLocaleString()} of ${features.length.toLocaleString()} features receive value-based styling. Other values use the normal layer style.`:'All features use the normal layer style.';
   clearMapPreview();clearMapPreview=onPreview(rules)||(()=>{});
   q('[data-preview]').innerHTML=samples.map(s=>`<span><i style="background:${esc(s.color||layer.color)}"></i>${esc(s.symbol||layer.metadata?.style?.symbol||'circle')} · ${s.pointSize||layer.metadata?.style?.pointSize||12}px</span>`).join('');return rules;
  }catch(e){message.textContent=e.message;q('[data-preview]').replaceChildren();return undefined;}
 }
 q('[data-preview-button]').onclick=preview;
 form.onsubmit=async e=>{e.preventDefault();const rules=preview();if(rules===undefined)return;const button=form.querySelector('[type=submit]');button.disabled=true;try{await onApply(rules);dialog.close();}catch(error){message.textContent=error.message;}finally{button.disabled=false;}};
 dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dialog.close());dialog.addEventListener('close',()=>{clearMapPreview();dialog.remove();},{once:true});drawClasses();modeChanged();dialog.showModal();
 return dialog;
}
