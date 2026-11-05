import {imageryLayer} from './imagery.js';
import {installBasemapPanel} from './basemap-panel.js';
import {xyzSettings} from './xyz.js';
export function installBasemaps(L,map,select,label){
 const esri='https://services.arcgisonline.com/ArcGIS/rest/services/';
 const tile=service=>L.tileLayer(esri+service+'/MapServer/tile/{z}/{y}/{x}',{maxZoom:22,maxNativeZoom:16,attribution:'Tiles © Esri, HERE, Garmin, OpenStreetMap contributors'});
 const views={street:L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:22,maxNativeZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}),satellite:imageryLayer(L),light:tile('Canvas/World_Light_Gray_Base'),dark:tile('Canvas/World_Dark_Gray_Base')};
 const labels={satellite:L.layerGroup([tile('Reference/World_Transportation'),tile('Reference/World_Boundaries_and_Places')]),light:tile('Canvas/World_Light_Gray_Reference'),dark:tile('Canvas/World_Dark_Gray_Reference')};
 let state={type:'street',labels:true},active=views.street,reference=null,onChange=()=>{};active.addTo(map);
 for(const [value,text] of [['light','Light'],['dark','Dark'],['custom','Custom'],['solid','Solid color']])if(!select.querySelector(`option[value="${value}"]`)){const o=select.ownerDocument.createElement('option');o.value=value;o.textContent=text;select.append(o);}
 function apply(value,notify=true){
  const next={...value};if(next.type==='hybrid'){next.type='satellite';next.labels=true;}
  if(!['street','satellite','light','dark','custom','solid'].includes(next.type))next.type='street';
  if(next.custom)next.custom={...xyzSettings(next.custom),name:String(next.custom.name||'Custom basemap').slice(0,80)};
  if(next.type==='custom'&&!next.custom)next.type='street';if(next.type==='solid'&&!/^#[\da-f]{6}$/i.test(next.color||''))next.color='#e8e8e8';
  next.labels=next.type==='solid'?false:['street','custom'].includes(next.type)?true:next.labels!==false;
  if(active)map.removeLayer(active);if(reference)map.removeLayer(reference);reference=null;state=next;
  active=state.type==='custom'?L.tileLayer(state.custom.url,{maxZoom:22,maxNativeZoom:state.custom.maxZoom,attribution:state.custom.attribution.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]))}):views[state.type];
  const container=map.getContainer?.();if(container)container.style.background=state.type==='solid'?state.color:'';
  active?.addTo(map);if(state.labels&&labels[state.type]){reference=labels[state.type];reference.addTo(map);}
  select.value=state.type;label.textContent={street:'OpenStreetMap',satellite:'Esri Satellite',light:'Esri Light Gray',dark:'Esri Dark Gray',solid:'Solid color',custom:state.custom?.name}[state.type];
  panel?.refresh();if(notify)onChange(structuredClone(state));
 }
 let panel=null;
 select.onchange=()=>apply({...state,type:select.value,labels:select.value==='satellite'?false:select.value==='hybrid'?true:state.labels});
 if(select.ownerDocument?.body)panel=installBasemapPanel({doc:select.ownerDocument,select,getState:()=>state,setState:apply,thumbnail:type=>{if(!views[type])return null;const center=map.getCenter?.()||{lat:-25,lng:134},z=Math.min(12,Math.max(0,Math.round(map.getZoom?.()||5))),n=2**z,lat=Math.max(-85,Math.min(85,center.lat))*Math.PI/180,x=Math.floor((center.lng+180)/360*n),y=Math.floor((1-Math.asinh(Math.tan(lat))/Math.PI)/2*n);return type==='street'?`https://tile.openstreetmap.org/${z}/${x}/${y}.png`:esri+({satellite:'World_Imagery',light:'Canvas/World_Light_Gray_Base',dark:'Canvas/World_Dark_Gray_Base'}[type])+`/MapServer/tile/${z}/${y}/${x}`;}});
 return {open:()=>panel?.open(),get:()=>structuredClone(state),apply:value=>apply(value||{type:'street',labels:true},false),onChange:fn=>onChange=fn};
}
