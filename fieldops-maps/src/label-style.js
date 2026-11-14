import {formatField} from './number-format.js';
const number=(v,d,min,max)=>v!=null&&Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):d;
const color=(v,d)=>/^#[0-9a-f]{6}$/i.test(v)?v:d;
export function labelStyle(item){const s=item.metadata?.style||{};return {
 size:number(s.labelSize,11,8,32),color:color(s.labelColor,'#262626'),halo:color(s.labelHaloColor,'#ffffff'),haloWidth:number(s.labelHaloWidth,1,0,4),
 weight:s.labelWeight==='normal'?'400':'600',placement:['auto','right','left','top','bottom','center'].includes(s.labelPlacement)?s.labelPlacement:'auto',
 minZoom:number(s.labelMinZoom,0,0,24),avoidOverlap:s.labelAvoidOverlap!==false
};}
export function labelControls(item){const s=labelStyle(item);return `<details class="label-options label-field"><summary>Label appearance and placement</summary>
<label>Text size<input type="number" min="8" max="32" data-action="labelSize" aria-label="Label text size" value="${s.size}"></label>
<label>Text colour<input type="color" data-action="labelColor" aria-label="Label text colour" value="${s.color}"></label>
<label>Text weight<select data-action="labelWeight" aria-label="Label text weight"><option value="normal" ${s.weight==='400'?'selected':''}>Normal</option><option value="bold" ${s.weight==='600'?'selected':''}>Bold</option></select></label>
<label>Halo colour<input type="color" data-action="labelHaloColor" aria-label="Label halo colour" value="${s.halo}"></label>
<label>Halo width<input type="number" min="0" max="4" step="0.5" data-action="labelHaloWidth" aria-label="Label halo width" value="${s.haloWidth}"></label>
<label>Placement<select data-action="labelPlacement" aria-label="Label placement">${['auto','right','left','top','bottom','center'].map(v=>`<option value="${v}" ${s.placement===v?'selected':''}>${v==='auto'?'Automatic':v[0].toUpperCase()+v.slice(1)}</option>`).join('')}</select></label>
<label>Show from zoom<input type="number" min="0" max="24" data-action="labelMinZoom" aria-label="Minimum label zoom" value="${s.minZoom}"></label>
<label>Avoid overlaps<input type="checkbox" data-action="labelAvoidOverlap" aria-label="Avoid overlapping labels" ${s.avoidOverlap?'checked':''}></label>
<small>Automatic placement tries each side of a feature. Labels without room stay hidden until you zoom in. Zero zoom shows labels at every scale.</small></details>`;}

export function labelFields(item){const s=item.metadata?.style||{};return [...new Set((Array.isArray(s.labelFields)?s.labelFields:[s.labelField]).filter(v=>typeof v==='string'&&v))];}
export function labelText(item,properties={}){if(typeof properties._fieldmaps_pin_label==='string'&&properties._fieldmaps_pin_label.trim())return properties._fieldmaps_pin_label_visible===false?'':properties._fieldmaps_pin_label;return labelFields(item).filter(field=>Object.hasOwn(properties,field)&&properties[field]!=null&&String(properties[field])!=='').map(field=>formatField(item,field,properties[field])).join('\n');}
