import Papa from 'papaparse';

export async function readDelimited(file,delimiter=''){
 let text,encoding='UTF-8';
 if(file.arrayBuffer){
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(bytes[0]===255&&bytes[1]===254){encoding='UTF-16LE';text=new TextDecoder('utf-16le').decode(bytes);}
  else if(bytes[0]===254&&bytes[1]===255){encoding='UTF-16BE';text=new TextDecoder('utf-16be').decode(bytes);}
  else try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{encoding='Windows-1252';text=new TextDecoder('windows-1252').decode(bytes);}
 }else text=await file.text();
 text=text.replace(/^\uFEFF/,'');
 const rows=[],rowNumbers=[],rowIssues=[],repairs=[];let fields=null,cursor=0,line=1;
 Papa.parse(text,{delimiter,skipEmptyLines:false,step(result){
  const at=line,end=result.meta.cursor;line+=(text.slice(cursor,end).match(/\r\n|\r|\n/g)||[]).length;cursor=end;
  const values=result.data;
  const fatal=result.errors.find(e=>e.type==='Quotes');if(fatal)throw Error(`CSV line ${at}: ${fatal.message}. Fix the quotation marks before importing; row boundaries are unclear.`);
  if(values.every(v=>!v.trim()))return;
  if(!fields){
   const used=new Set();fields=values.map((v,i)=>{let name=v.trim()||`Column ${i+1}`,base=name,n=2;while(used.has(name))name=`${base} (${n++})`;used.add(name);if(name!==v)repairs.push({line:at,reason:`Column heading normalised: ${name}`});return name;});return;
  }
  if(rows.length>=20000)throw Error('Split this table into at most 20,000 data rows.');
  let issue=result.errors.filter(e=>e.code!=='UndetectableDelimiter').map(e=>e.message).join('; ');
  if(values.length>fields.length){
   if(values.slice(fields.length).some(v=>v.trim()))issue='Extra values beyond the column headings; columns cannot be aligned safely.';
   else repairs.push({line:at,reason:'Removed empty trailing columns.'});
  }else if(values.length<fields.length)repairs.push({line:at,reason:'Filled missing trailing cells with blanks.'});
  const row=Object.fromEntries(fields.map((f,i)=>[f,values[i]??'']));
  if(issue&&values.length>fields.length)row.__parsed_extra=values.slice(fields.length);
  rows.push(row);rowNumbers.push(at);rowIssues.push(issue);
 }});
 return {rows,fields,rowNumbers,rowIssues,tableRepairs:repairs,encoding};
}
