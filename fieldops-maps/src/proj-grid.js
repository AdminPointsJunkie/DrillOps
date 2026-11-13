// GDAL's worker remounts /input on each external open. Keep the datum grid in
// that mount and leave internal /input and /output opens untouched.
export function installProjGrid(engine,grid){
 const open=engine.open.bind(engine);
 engine.open=async(files,options=[],vfs=[])=>{
  const list=Array.isArray(files)?files:typeof FileList==='function'&&files instanceof FileList?[...files]:[files];
  if(list.every(f=>typeof f==='string'&&/^\/(input|output)\//.test(f)))return open(files,options,vfs);
  if(list.some(f=>f.name===grid.name))throw Error('This filename is reserved for the coordinate transformation grid. Rename the source file.');
  const result=await open([...list,grid],vfs.length?[]:options);
  const grids=result.datasets.filter(d=>d.path===grid.name);
  if(!grids.length)throw Error('The AGD84 coordinate grid could not be loaded. Reload and retry.');
  for(const ds of grids)await engine.close(ds);
  result.datasets=result.datasets.filter(d=>d.path!==grid.name);
  if(vfs.length){
   for(const ds of result.datasets)await engine.close(ds);
   return open(list.map(f=>typeof f==='string'?f:'/input/'+f.name),options,vfs);
  }
  if(!result.datasets.length&&result.errors.length)throw result.errors;
  return result;
 };
 return engine;
}
