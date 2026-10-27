export const symbols=['circle','square','triangle','diamond','cross'];
export const lineStyles={solid:null,dashed:'8 6',dotted:'2 5'};
export function visibilityIcon(visible){
 return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>${visible?'':'<path d="M3 3l18 18"/>'}</svg>`;
}
const number=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
export function geometryKinds(fc){
 const kinds=new Set();
 function visit(g){if(!g)return;if(g.type==='GeometryCollection')return g.geometries.forEach(visit);
  if(/Point$/.test(g.type))kinds.add('point');else if(/LineString$/.test(g.type))kinds.add('line');else if(/Polygon$/.test(g.type))kinds.add('shape');}
 fc?.features?.forEach(f=>visit(f.geometry));return kinds;
}
export function layerStyle(layer){
 const s=layer.metadata?.style||{}, colour=/^#[0-9a-f]{6}$/i;
 return {symbol:symbols.includes(s.symbol)?s.symbol:'circle',pointSize:number(s.pointSize,12,4,48),
  lineWidth:number(s.lineWidth,2,0,12),lineStyle:Object.hasOwn(lineStyles,s.lineStyle)?s.lineStyle:'solid',
  fillColor:colour.test(s.fillColor)?s.fillColor:layer.color,
  fillOpacity:number(s.fillOpacity,.2,0,1),opacity:number(layer.opacity,.85,0,1)};
}
export function vectorStyle(layer){
 const s=layerStyle(layer);
 return {color:layer.color,weight:s.lineWidth,dashArray:lineStyles[s.lineStyle],opacity:s.opacity,fillColor:s.fillColor,fillOpacity:s.fillOpacity*s.opacity};
}
export function pointMarker(L,layer,ll){
 const s=layerStyle(layer),color=/^#[0-9a-f]{6}$/i.test(layer.color)?layer.color:'#147d72';
 if(s.symbol==='circle')return L.circleMarker(ll,{radius:s.pointSize/2,color:'#fff',weight:1.5,opacity:s.opacity,fillColor:color,fillOpacity:s.opacity});
 const shapes={square:'<rect x="2" y="2" width="20" height="20"/>',triangle:'<path d="M12 2 L22 22 H2 Z"/>',diamond:'<path d="M12 1 L23 12 L12 23 L1 12 Z"/>',cross:'<path d="M8 2 H16 V8 H22 V16 H16 V22 H8 V16 H2 V8 H8 Z"/>'};
 return L.marker(ll,{opacity:s.opacity,icon:L.divIcon({className:'layer-point-symbol',iconSize:[s.pointSize,s.pointSize],iconAnchor:[s.pointSize/2,s.pointSize/2],
  html:`<svg xmlns="http://www.w3.org/2000/svg" width="${s.pointSize}" height="${s.pointSize}" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="1.5">${shapes[s.symbol]}</svg>`})});
}
export function styleControls(layer){
 const s=layerStyle(layer),kinds=geometryKinds(layer.fc);
 const options=(values,current)=>values.map(v=>`<option value="${v}" ${v===current?'selected':''}>${v[0].toUpperCase()+v.slice(1)}</option>`).join('');
 return `<details class="layer-style-controls"><summary>Style layer</summary><div class="style-fields">
 <label>${kinds.has('shape')?'Outline / line colour':'Colour'}<input type="color" value="${/^#[0-9a-f]{6}$/i.test(layer.color)?layer.color:'#147d72'}" data-action="color" aria-label="Layer colour"></label>
 <label>Layer opacity <output>${Math.round(s.opacity*100)}%</output><input type="range" min="0" max="1" step="0.05" value="${s.opacity}" data-action="opacity" aria-label="Layer opacity"></label>
 ${kinds.has('point')?`<label>Point symbol<select data-action="symbol" aria-label="Point symbol">${options(symbols,s.symbol)}</select></label><label>Point size<input type="number" min="4" max="48" value="${s.pointSize}" data-action="pointSize" aria-label="Point size"></label>`:''}
 ${kinds.has('line')||kinds.has('shape')?`<label>${kinds.has('shape')?'Outline':'Line'} style<select data-action="lineStyle" aria-label="Line style">${options(Object.keys(lineStyles),s.lineStyle)}</select></label><label>${kinds.has('shape')?'Outline':'Line'} width<input type="number" min="0" max="12" step="0.5" value="${s.lineWidth}" data-action="lineWidth" aria-label="Line width"></label>`:''}
 ${kinds.has('shape')?`<label>Fill colour<input type="color" value="${s.fillColor}" data-action="fillColor" aria-label="Fill colour"></label><label>Fill opacity <output>${Math.round(s.fillOpacity*100)}%</output><input type="range" min="0" max="1" step="0.05" value="${s.fillOpacity}" data-action="fillOpacity" aria-label="Fill opacity"></label>`:''}
 </div></details>`;
}
