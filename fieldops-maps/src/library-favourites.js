export function createLibraryFavourites({db,getUser,getWorkspace,local=false,storage=globalThis.localStorage}){
 const identity=()=>({user:getUser()?.id||'local',workspace:getWorkspace()?.id||'local'});
 const same=(a,b)=>a.user===b.user&&a.workspace===b.workspace;
 const clean=rows=>Array.isArray(rows)?rows.filter(x=>x&&typeof x.key==='string'&&['layer','source','service'].includes(x.kind)&&x.key.length<1000&&(x.kind!=='service'||(typeof x.name==='string'&&typeof x.path==='string'&&typeof x.sourceId==='string'&&x.path.length<800&&!x.path.split('/').includes('..')))).slice(0,300):[];
 return {
  async list(){const owner=identity();if(local){try{return clean(JSON.parse(storage.getItem('fieldmaps:favourites:'+owner.workspace)||'[]'));}catch{return [];}}
   const r=await db.auth.getUser();if(r.error)throw r.error;if(r.data.user?.id!==owner.user||!same(owner,identity()))throw Error('Account changed. Reopen the library.');return clean(r.data.user.user_metadata?.library_favourites?.[owner.workspace]);},
  async save(rows){const owner=identity();rows=clean(rows);if(local){storage.setItem('fieldmaps:favourites:'+owner.workspace,JSON.stringify(rows));return;}
   const r=await db.auth.getUser();if(r.error)throw r.error;if(r.data.user?.id!==owner.user||!same(owner,identity()))throw Error('Account changed. Reopen the library.');
   const all={...r.data.user.user_metadata?.library_favourites,[owner.workspace]:rows};
   const result=await db.auth.updateUser({data:{library_favourites:all}});if(result.error)throw result.error;
  }
 };
}
