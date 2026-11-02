// Keep original keys intact: trimming them can merge distinct source columns.
export function columnOptions(fields){
 const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 return fields.map(field=>`<option value="${escape(field)}">${escape(field)}</option>`).join('');
}
export function coordinateColumns(fields){
 return {
  x:fields.find(f=>/^(lon|lng|longitude|east|easting|x)$/i.test(f.trim()))||fields[0],
  y:fields.find(f=>/^(lat|latitude|north|northing|y)$/i.test(f.trim()))||fields[1]||fields[0]
 };
}
