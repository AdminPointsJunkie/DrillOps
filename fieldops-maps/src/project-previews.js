import {readPrintLayout,writePrintLayout} from './print-storage.js';
export const validPreview=value=>typeof value==='string'&&value.length<=200000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value);
export function projectPreviews({db,local=false}){
 const key=(scope,id)=>`home-preview:${scope}:${id}`;
 return {
  async load(scope,ids){
   if(!ids.length)return new Map();
   const previews=new Map();
   if(!local){const {data,error}=await db.from('project_previews').select('map_id,image').in('map_id',ids);if(error)throw error;for(const row of data||[])if(validPreview(row.image))previews.set(row.map_id,row.image);}
   await Promise.all(ids.filter(id=>!previews.has(id)).map(async id=>{try{const image=await readPrintLayout(key(scope,id));if(validPreview(image))previews.set(id,image);}catch{}}));
   return previews;
  },
  async save(scope,id,image){
   if(!validPreview(image))throw Error('The project preview could not be saved.');
   if(!local){const {error}=await db.from('project_previews').upsert({map_id:id,image,updated_at:new Date().toISOString()},{onConflict:'map_id'});if(error)throw error;}
   try{await writePrintLayout(key(scope,id),image);}catch{ /* Cloud preview is already saved. */ }
  }
 };
}
