import {featureBounds} from './explore-data.js';

// Each layer save is atomic. Keep successful changes undoable if another layer fails.
export function createSelectionDeletion({getLayers,getScope,canEdit,replace,remove,restore}){
 const history=[];let working=false;
 const available=entry=>canEdit(entry.layer)&&(entry.removed?!getLayers().some(l=>l.id===entry.layer.id):getLayers().includes(entry.layer)&&entry.layer.fc===entry.after);
 function extent(features){const bounds=[Infinity,Infinity,-Infinity,-Infinity];for(const feature of features){const b=featureBounds(feature);if(b){bounds[0]=Math.min(bounds[0],b[0]);bounds[1]=Math.min(bounds[1],b[1]);bounds[2]=Math.max(bounds[2],b[2]);bounds[3]=Math.max(bounds[3],b[3]);}}return bounds;}
 return {
  get canUndo(){const last=history.at(-1);return !working&&last?.scope===getScope()&&last.entries.every(available);},
  async delete(selected){
   if(working)throw Error('Wait for the current edit to finish.');
   const scope=getScope(),plans=new Map();
   for(const {layer,index} of selected){
    if(!getLayers().includes(layer)||!canEdit(layer)||layer.kind!=='vector'||!Number.isInteger(index)||!layer.fc?.features[index])throw Error('Select editable map features first.');
    if(!plans.has(layer))plans.set(layer,{layer,before:layer.fc,bounds:layer.bounds,ids:new Set()});plans.get(layer).ids.add(index);
   }
   const result={count:0,errors:[]},record={scope,entries:[]};working=true;
   try{
    for(const entry of plans.values())try{
     const {layer,before,ids}=entry;
     if(scope!==getScope()||!getLayers().includes(layer)||!canEdit(layer)||layer.fc!==before)throw Error('The project or layer changed. Select the features again.');
     const fc={...before,features:before.features.filter((_,i)=>!ids.has(i))};delete fc.bbox;
     entry.count=ids.size;entry.removed=fc.features.length===0;
     if(entry.removed)entry.location=await remove(layer);
     else{await replace(layer,{fc,bounds:extent(fc.features)});entry.after=layer.fc;}
     record.entries.push(entry);result.count+=entry.count;
    }catch(error){result.errors.push(entry.layer.name+': '+error.message);}
    if(record.entries.length){history.push(record);if(history.length>10)history.shift();}
    return result;
   }finally{working=false;}
  },
  async undo(){
   const record=history.at(-1);if(!record||working)return {count:0,errors:[]};
   if(record.scope!==getScope()||!record.entries.every(available))throw Error('These layers changed after deletion. Undo is no longer available.');
   const result={count:0,errors:[]};working=true;
   try{
    for(const entry of [...record.entries].reverse())try{
     if(record.scope!==getScope()||!available(entry))throw Error('Project access or layer data changed.');
     if(entry.removed)await restore(entry.layer,entry.location);
     else await replace(entry.layer,{fc:entry.before,bounds:entry.bounds});
     result.count+=entry.count;record.entries.splice(record.entries.indexOf(entry),1);
    }catch(error){result.errors.push(entry.layer.name+': '+error.message);}
    if(!record.entries.length)history.pop();return result;
   }finally{working=false;}
  }
 };
}
