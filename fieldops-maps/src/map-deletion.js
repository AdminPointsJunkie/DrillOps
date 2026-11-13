export async function deleteMapCompletely(db,id,{local=false}={}){
 if(local){const result=await db.from('maps').delete().eq('id',id).select('id').single();if(result.error)throw result.error;if(result.data?.id!==id)throw Error('Deletion could not be confirmed. Retry Delete map.');return result.data;}
 const result=await db.functions.invoke('maps-delete',{body:{map_id:id,confirm:true}});
 if(result.error){let message=result.error.message;try{message=(await result.error.context.json()).error||message;}catch{}throw Error(message);}
 if(result.data?.error)throw Error(result.data.error);
 if(result.data?.id!==id||result.data?.deleted!==true)throw Error('Complete deletion could not be confirmed. Retry Delete map.');
 return result.data;
}
