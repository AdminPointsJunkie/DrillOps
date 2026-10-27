const escapeHTML=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function xyzSettings({url,attribution='',minZoom=0,maxZoom=19}){
 url=String(url||'').trim();
 if(!['{x}','{y}','{z}'].every(token=>url.includes(token)))throw Error('Include {z}, {x} and {y} in the tile URL.');
 if(/\{(?![xyzsr]\})[^}]*\}/.test(url))throw Error('Supported placeholders are {z}, {x}, {y}, {s} and {r}. Replace other placeholders with the provider’s values.');
 let parsed;try{parsed=new URL(url.replace(/\{[xyzsr]\}/g,'0'));}catch{throw Error('Enter a valid HTTPS tile URL.');}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash)throw Error('Use an HTTPS URL without a username, password or fragment.');
 minZoom=Number(minZoom);maxZoom=Number(maxZoom);
 if(!Number.isInteger(minZoom)||!Number.isInteger(maxZoom)||minZoom<0||maxZoom>22||minZoom>maxZoom)throw Error('Zoom levels must be whole numbers from 0 to 22, with minimum no greater than maximum.');
 return {url,attribution:String(attribution).trim(),minZoom,maxZoom};
}

export function xyzLayer(L,item,onError=()=>{}){
 const settings=xyzSettings(item.metadata.xyz);
 const layer=L.tileLayer(settings.url,{minZoom:settings.minZoom,maxZoom:22,maxNativeZoom:settings.maxZoom,
  opacity:item.opacity??1,attribution:escapeHTML(settings.attribution),zIndex:10});
 layer.once('tileerror',()=>onError(`Tiles for “${item.name}” could not load. Check the URL, access key, coverage and zoom range in Edit tiles.`));
 return layer;
}
