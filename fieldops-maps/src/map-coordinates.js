export async function mapCoordinates(latlng,crs='EPSG:4326',catalogue=[],getEngine){
 const lng=((latlng.lng+180)%360+360)%360-180,lat=latlng.lat;
 const info=catalogue.find(c=>c.code===crs),geographic=crs==='EPSG:4326'||info?.geographic;
 const values=crs==='EPSG:4326'?[lng,lat]:(await (await getEngine()).gdaltransform([[lng,lat]],['-s_srs','EPSG:4326','-t_srs',crs,'-output_xy']))[0];
 if(!values||!values.slice(0,2).every(Number.isFinite))throw Error('Coordinates are unavailable in this CRS at this location.');
 const text=geographic?`${values[1].toFixed(5)}, ${values[0].toFixed(5)}`:`${values[0].toFixed(3)}, ${values[1].toFixed(3)}`;
 return {text,label:info?`${crs} · ${info.name}`:crs,axes:geographic?'Latitude, longitude · decimal degrees':`X, Y${info?.unit?' · '+info.unit:''}`};
}
export function locationLinks({lat,lng},zoom){
 lng=((lng+180)%360+360)%360-180;
 return [['Google Maps',`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`],['Google Street View',`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`],['OpenStreetMap',`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${Math.round(zoom)}/${lat}/${lng}`]];
}
