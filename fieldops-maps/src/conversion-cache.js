export async function cachedConversion(item,settings,convert,progress){
 const key=JSON.stringify(settings);
 if(item.converted?.key===key)return item.converted.data;
 const data=await convert(item,settings,progress);item.converted={key,data};return data;
}
