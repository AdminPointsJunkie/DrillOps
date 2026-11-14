import {formatField} from './number-format.js';
import {labelStyle} from './label-style.js';
const labelledLayers=new WeakSet();
export function labelsOverlap(a,b,padding=3){return a.left<b.right+padding&&a.right+padding>b.left&&a.top<b.bottom+padding&&a.bottom+padding>b.top;}
export function pointLabels(layer,item,bounds,document,limit=500,{map=layer?._map,occupied=[]}={}){
 if(!layer)return 0;
 const field=item.metadata?.style?.labelField,style=labelStyle(item);let count=0;
 if(!field&&!labelledLayers.has(layer))return 0;
 if(field)labelledLayers.add(layer);else labelledLayers.delete(layer);
 const directions=style.placement==='auto'?['right','left','top','bottom']:[style.placement];
 const visit=marker=>{
  if(marker.eachLayer){marker.eachLayer(visit);return;}
  const position=marker.getLatLng?.()??marker.getBounds?.().getCenter();if(position==null)return;
  const properties=marker.feature?.properties||{},value=field&&Object.hasOwn(properties,field)?properties[field]:null;
  marker.unbindTooltip?.();
  if(value==null||String(value)===''||!bounds.contains(position)||count>=limit||(map?.getZoom?.()??24)<style.minZoom)return;
  const text=document.createElement('span');text.textContent=formatField(item,field,value);
  Object.assign(text.style,{display:'block',fontSize:style.size+'px',fontWeight:style.weight,lineHeight:'1.25',color:style.color,
   textShadow:style.haloWidth?[[1,1],[-1,-1],[1,-1],[-1,1],[0,1],[0,-1],[1,0],[-1,0]].map(([x,y])=>`${x*style.haloWidth}px ${y*style.haloWidth}px 0 ${style.halo}`).join(','):'none'});
  for(const direction of directions){
   const offset=({right:[7,0],left:[-7,0],top:[0,-7],bottom:[0,7],center:[0,0]})[direction];
   marker.bindTooltip(text,{permanent:true,direction,offset,className:'point-label',...(item._pane?{pane:item._pane}:{}),opacity:1});
   const rect=marker.getTooltip?.()?.getElement?.()?.getBoundingClientRect();
   const box=rect&&rect.width>0?{left:rect.left-style.haloWidth,top:rect.top-style.haloWidth,right:rect.right+style.haloWidth,bottom:rect.bottom+style.haloWidth}:null;
   if(style.avoidOverlap&&box&&occupied.some(other=>labelsOverlap(box,other))){marker.unbindTooltip?.();continue;}
   if(box)occupied.push(box);count++;break;
  }
 };
 layer.eachLayer?.(visit);return count;
}
