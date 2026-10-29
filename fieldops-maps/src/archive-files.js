import {zipSync} from 'fflate';
export const archivePattern=/\.(zip|7z|rar|tar|gz|tgz|lpk|lpkx|mpk|mpkx)$/i;
const limit=300*1024*1024;
export function safeArchivePath(path){
 const value=path.replaceAll('\\','/');
 if(value.startsWith('/')||/^[a-z]:/i.test(value)||value.split('/').some(p=>['..','__proto__','constructor','prototype'].includes(p)))throw Error('Archive contains an unsafe file path.');
 return value.replace(/^\.\//,'');
}
export async function unpackArchive(file,budget={remaining:limit}){
 const {Archive}=await import('libarchive.js');Archive.init({workerUrl:import.meta.env.BASE_URL+'archive/worker-bundle.js'});
 const archive=await Archive.open(file);
 try{
  if(await archive.hasEncryptedData())throw Error('Password-protected archives are not supported.');
  // Validate raw paths before libarchive builds its nested JavaScript object.
  // Pinned libarchive.js 2.0.2 exposes this worker client; do not remove this guard.
  const raw=await archive.client.listFiles();for(const entry of raw)safeArchivePath(entry.path);
  const entries=await archive.getFilesArray();if(entries.length>5000)throw Error('Archive contains more than 5,000 files.');
  let total=0;const paths=new Set();
  for(const entry of entries){entry.safePath=safeArchivePath(entry.path+entry.file.name);if(paths.has(entry.safePath))throw Error('Archive contains duplicate file paths.');paths.add(entry.safePath);total+=entry.file.size;if(total>Math.min(limit,budget.remaining))throw Error('Expanded archive exceeds 300 MB. Split the archive before importing.');}
  budget.remaining-=total;
  const regular=[],databases=new Map();
  for(const entry of entries){if(/(^|\/)__MACOSX\//.test(entry.safePath)||/\/\.[^/]+$/.test(entry.safePath))continue;
   const extracted=await entry.file.extract();const path=entry.safePath;const db=path.match(/^(.*?\.gdb)\//i);
   if(db){if(!databases.has(db[1]))databases.set(db[1],Object.create(null));databases.get(db[1])[path.slice(db[1].lastIndexOf('/')+1)]=new Uint8Array(await extracted.arrayBuffer());}
   else regular.push(new File([extracted],path));
  }
  for(const [name,contents] of databases)regular.push(new File([zipSync(contents,{level:0})],name.split('/').at(-1)+'.zip'));
  return regular;
 }finally{await archive.close();}
}
