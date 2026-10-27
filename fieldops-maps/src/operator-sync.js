import {flattenTree} from './layer-tree.js';
const checked=async request=>{const r=await request;if(r.error)throw r.error;return r.data;};
export async function syncProjectRelease(db,mapId,userId,progress=()=>{}){
 const project=await checked(db.from('maps').select('*').eq('id',mapId).single());
 const layers=await checked(db.from('layers').select('*').eq('map_id',mapId).order('created_at'));
 const id=crypto.randomUUID(),rasters={};
 // Separate copies keep the operator version stable when draft previews are replaced.
 if(project.last_synced_revision!==project.draft_revision){
  const included=new Set(flattenTree(project.layer_layout||[]));
  for(const layer of layers.filter(l=>included.has(l.id)&&l.kind==='raster'&&!l.metadata?.xyz)){
   progress(`Preparing imagery: ${layer.name}`);
   const target=`${userId}/sync/${id}/${layer.id}.png`;
   await checked(db.storage.from('gis-files').copy(layer.raster_path,target));rasters[layer.id]=target;
  }
 }
 progress('Publishing operator version…');
 // On an uncertain network response keep uploaded snapshots: the transaction may have committed.
 return checked(db.rpc('sync_map',{p_map_id:mapId,p_release_id:id,p_expected_revision:project.draft_revision,p_rasters:rasters}));
}
