import {labelStyle,labelFields,labelText} from './label-style.js';
import {LABEL_FONT,labelPlacement,createLabelIndex} from './label-layout.js';
export {labelsOverlap} from './label-layout.js';
const labelledLayers=new WeakSet(),signatures=new WeakMap(),contexts=new WeakMap(),indexes=new WeakMap();
function measure(document,text,size,weight){
 if(!contexts.has(document)){let context=null;if(document.defaultView?.CanvasRenderingContext2D)context=document.createElement('canvas').getContext('2d');contexts.set(document,{context,cache:new Map()});}
 const {context,cache}=contexts.get(document),key=JSON.stringify([text,size,weight]);if(cache.has(key))return cache.get(key);
 if(context)context.font=`${weight} ${size}px ${LABEL_FONT}`;
 const lines=text.split('\n'),dimensions={width:Math.ceil(Math.max(...lines.map(line=>context?context.measureText(line).width:line.length*size*.65)))+2,height:Math.ceil(lines.length*size*1.25)};
 if(cache.size>=4000)cache.clear();cache.set(key,dimensions);return dimensions;
}
function clearTooltip(marker){const el=marker.getTooltip?.()?.getElement?.();if(el?.style)el.style.visibility='hidden';marker.unbindTooltip?.();}
export function pointLabels(layer,item,bounds,document,limit=500,{map=layer?._map,occupied=[]}={}){
 if(!layer)return 0;
 const field=labelFields(item).length||item.metadata?.style?.pinLabels,style=labelStyle(item);let count=0;
 if(!indexes.has(occupied))indexes.set(occupied,createLabelIndex(occupied));const index=indexes.get(occupied);
 if(!field&&!labelledLayers.has(layer))return 0;
 if(field)labelledLayers.add(layer);else labelledLayers.delete(layer);
 const directions=style.placement==='auto'?['right','left','top','bottom']:[style.placement];
 const visit=marker=>{
  if(marker.eachLayer){marker.eachLayer(visit);return;}
  const position=marker.getLatLng?.()??marker.getBounds?.().getCenter();if(position==null)return;
  const properties=marker.feature?.properties||{},value=field?labelText(item,properties):null;
  if(value==null||String(value)===''||!bounds.contains(position)||count>=limit||(map?.getZoom?.()??24)<style.minZoom){clearTooltip(marker);signatures.delete(marker);return;}
  const point=map?.latLngToContainerPoint?.(position),size=measure(document,value,style.size,style.weight);
  const radius=marker.getRadius?.()??Number(marker.options?.icon?.options?.iconSize?.[0]||12)/2;
  const gap=Math.max(10,Math.min(32,radius+6)),anchor=marker.options?.icon?.options?.tooltipAnchor||[0,0];let accepted=false;
  for(const direction of directions){
   const placement=labelPlacement(point||{x:0,y:0},size,direction,gap,anchor,style.haloWidth),box=point?placement.box:null;
   if(style.avoidOverlap&&box&&index.overlaps(box))continue;
   const offset=placement.offset;
   const signature=JSON.stringify([value,style,direction,item._pane,size,offset]);
   if(signatures.get(marker)!==signature||!marker.getTooltip?.()){
    const text=document.createElement('span');text.textContent=value;
    Object.assign(text.style,{display:'block',whiteSpace:'pre',width:size.width+'px',height:size.height+'px',fontFamily:LABEL_FONT,fontSize:style.size+'px',fontWeight:style.weight,lineHeight:'1.25',color:style.color,
     textShadow:style.haloWidth?[[1,1],[-1,-1],[1,-1],[-1,1]].map(([x,y])=>`${x*style.haloWidth}px ${y*style.haloWidth}px 0 ${style.halo}`).join(','):'none'});
    clearTooltip(marker);marker.bindTooltip(text,{permanent:true,direction,offset,className:'point-label',...(item._pane?{pane:item._pane}:{}),opacity:1});signatures.set(marker,signature);
   }
   if(box)index.add(box);count++;accepted=true;break;
  }
  if(!accepted){clearTooltip(marker);signatures.delete(marker);}
 };
 layer.eachLayer?.(visit);return count;
}
