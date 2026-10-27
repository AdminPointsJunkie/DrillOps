export function pointLabels(layer,item,bounds,document,limit=500){
 const field=item.metadata?.style?.labelField;let count=0;
 const visit=marker=>{
  if(marker.eachLayer){marker.eachLayer(visit);return;}
  if(!marker.getLatLng)return;
  const properties=marker.feature?.properties||{},value=field&&Object.hasOwn(properties,field)?properties[field]:null;
  if(value==null||String(value)===''||!bounds.contains(marker.getLatLng())||count>=limit){marker.unbindTooltip?.();return;}
  count++;
  if(!marker.getTooltip?.()){
   const text=document.createElement('span');text.textContent=typeof value==='object'?JSON.stringify(value):String(value);
   marker.bindTooltip(text,{permanent:true,direction:'right',offset:[7,0],className:'point-label',pane:item._pane,opacity:1});
  }
 };
 layer.eachLayer?.(visit);return count;
}
