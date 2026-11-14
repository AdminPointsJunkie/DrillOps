import {labelStyle,labelFields,labelText} from './label-style.js';
const labelledLayers=new WeakSet(),signatures=new WeakMap(),contexts=new WeakMap();
function measure(document,text,size,weight){
 if(!contexts.has(document)){let context=null;if(document.defaultView?.CanvasRenderingContext2D)context=document.createElement('canvas').getContext('2d');contexts.set(document,context);}
 const context=contexts.get(document);if(context)context.font=`${weight} ${size}px sans-serif`;
 const lines=text.split('\n');return {width:Math.max(...lines.map(line=>context?context.measureText(line).width:line.length*size*.65)),height:lines.length*size*1.25};
}
function labelBox(point,size,direction,halo){const gap=16;let left=point.x-size.width/2,top=point.y-size.height/2;
 if(direction==='right')left=point.x+gap;if(direction==='left')left=point.x-gap-size.width;
 if(direction==='top')top=point.y-gap-size.height;if(direction==='bottom')top=point.y+gap;
 return {left:left-halo,top:top-halo,right:left+size.width+halo,bottom:top+size.height+halo};
}
export function labelsOverlap(a,b,padding=3){return a.left<b.right+padding&&a.right+padding>b.left&&a.top<b.bottom+padding&&a.bottom+padding>b.top;}
export function pointLabels(layer,item,bounds,document,limit=500,{map=layer?._map,occupied=[]}={}){
 if(!layer)return 0;
 const field=labelFields(item).length,style=labelStyle(item);let count=0;
 if(!field&&!labelledLayers.has(layer))return 0;
 if(field)labelledLayers.add(layer);else labelledLayers.delete(layer);
 const directions=style.placement==='auto'?['right','left','top','bottom']:[style.placement];
 const visit=marker=>{
  if(marker.eachLayer){marker.eachLayer(visit);return;}
  const position=marker.getLatLng?.()??marker.getBounds?.().getCenter();if(position==null)return;
  const properties=marker.feature?.properties||{},value=field?labelText(item,properties):null;
  if(value==null||String(value)===''||!bounds.contains(position)||count>=limit||(map?.getZoom?.()??24)<style.minZoom){marker.unbindTooltip?.();signatures.delete(marker);return;}
  const text=document.createElement('span');text.textContent=value;
  Object.assign(text.style,{display:'block',whiteSpace:'pre',fontSize:style.size+'px',fontWeight:style.weight,lineHeight:'1.25',color:style.color,
   textShadow:style.haloWidth?[[1,1],[-1,-1],[1,-1],[-1,1],[0,1],[0,-1],[1,0],[-1,0]].map(([x,y])=>`${x*style.haloWidth}px ${y*style.haloWidth}px 0 ${style.halo}`).join(','):'none'});
  const point=map?.latLngToContainerPoint?.(position),size=measure(document,value,style.size,style.weight);let accepted=false;
  for(const direction of directions){
   const box=point?labelBox(point,size,direction,style.haloWidth):null;
   if(style.avoidOverlap&&box&&occupied.some(other=>labelsOverlap(box,other)))continue;
   const offset=({right:[7,0],left:[-7,0],top:[0,-7],bottom:[0,7],center:[0,0]})[direction];
   const signature=JSON.stringify([value,style,direction,item._pane]);
   if(signatures.get(marker)!==signature||!marker.getTooltip?.()){
    marker.unbindTooltip?.();marker.bindTooltip(text,{permanent:true,direction,offset,className:'point-label',...(item._pane?{pane:item._pane}:{}),opacity:1});signatures.set(marker,signature);
   }
   if(box)occupied.push(box);count++;accepted=true;break;
  }
  if(!accepted){marker.unbindTooltip?.();signatures.delete(marker);}
 };
 layer.eachLayer?.(visit);return count;
}
