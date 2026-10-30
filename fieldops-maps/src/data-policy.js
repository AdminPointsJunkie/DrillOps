export const isArchiveFile=f=>/\.(zip|7z|rar|tar|gz|tgz|kmz|lpk|lpkx|mpk|mpkx)$/i.test(f?.name||'');
export function isGeoTIFFFile(file){return /\.tiff?$/i.test(file?.name||'')||/image\/(?:x-)?tiff/i.test(file?.type||'');}
export function isLocalGeoTIFF(layer){return layer?.kind==='raster'&&!layer.metadata?.xyz&&(layer.localOnly||layer.metadata?.local_only||/^(?:GTiff|GeoTIFF|COG)$/i.test(layer.metadata?.format||layer.format||'')||(layer.files||[]).some(isGeoTIFFFile)||(layer.metadata?.source_names||layer.original_paths||[]).some(name=>isGeoTIFFFile({name})));}
export async function assertCloudFile(file){
 if(isGeoTIFFFile(file))throw Error('GeoTIFFs are local-only. Neither the original nor its preview can be uploaded.');
 if(file.slice){const b=new Uint8Array(await file.slice(0,4).arrayBuffer());if((b[0]===73&&b[1]===73&&(b[2]===42||b[2]===43)&&b[3]===0)||(b[0]===77&&b[1]===77&&b[2]===0&&(b[3]===42||b[3]===43)))throw Error('TIFF content is local-only, including renamed files.');}
}
export function cloudLayout(tree,layers){const local=new Set(layers.filter(isLocalGeoTIFF).map(l=>l.id));return tree.flatMap(n=>typeof n==='string'?(local.has(n)?[]:[n]):[{...n,children:(n.children||[]).filter(id=>!local.has(id))}]);}
