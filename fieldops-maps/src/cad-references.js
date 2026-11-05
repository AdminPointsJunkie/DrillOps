import {convertDWG} from './dwg-import.js';
export const cadPath=value=>String(value||'').replaceAll('\\','/').replace(/\/+/g,'/').toLowerCase();
export const cadBasename=value=>cadPath(value).split('/').at(-1);
// Never select an arbitrary file when separate folders contain the same filename.
export function matchCADReference(reference,files){
 const path=cadPath(reference.path),name=cadBasename(path)||cadBasename(reference.name+'.dwg');
 const candidates=files.filter(f=>cadBasename(f.webkitRelativePath||f.name)===name);
 const exact=candidates.filter(f=>{const p=cadPath(f.webkitRelativePath||f.name);return p===path||(p.includes('/')&&path.endsWith('/'+p))||(path.includes('/')&&!path.startsWith('../')&&p.endsWith('/'+path.replace(/^\.\//,'')));});
 return exact.length===1?exact[0]:candidates.length===1?candidates[0]:null;
}
export async function readDWGReferences(file,progress,{dwg=convertDWG,resolveReferences,saved,sourceFiles=[]}={}){
 let selected=[];const decided=new Set();
 if(saved?.references){for(const ref of saved.references){decided.add(ref.key);if(ref.included){const original=sourceFiles[ref.fileIndex];if(!original)throw Error('An original referenced drawing is missing. Import the main DWG again.');selected.push({...ref,file:original});}}}
 let result;
 for(let round=0;round<10;round++){
  result=await dwg(file,progress,{references:selected});
  const pending=(result.references||[]).filter(ref=>!ref.issue&&!decided.has(ref.key));
  if(!pending.length||!resolveReferences)break;
  const choices=await resolveReferences({drawing:file.name,references:pending});
  if(choices===null)throw Error('Drawing import cancelled.');
  pending.forEach(ref=>decided.add(ref.key));
  if(!choices.length)break;
  for(const choice of choices){if(!pending.some(r=>r.key===choice.key)||!choice.file)throw Error('Invalid drawing reference selection.');selected.push(choice);}
 }
 const originals=[file],references=(result.references||[]).map(ref=>{
  const choice=ref.included?selected.find(s=>s.key===ref.key):null;
  if(!choice)return {...ref,included:false};
  // Unique stored filenames avoid collisions between references with the same basename.
  const index=originals.length;let filename=`xref_${String(index).padStart(3,'0')}_${(choice.filename||choice.file.name).split(/[\\/]/).at(-1)}`;
  const storedName=name=>name.replace(/[^a-zA-Z0-9._-]/g,'_');while(originals.some(f=>storedName(f.name)===storedName(filename)))filename='_'+filename;
  originals.push(new File([choice.file],filename,{type:choice.file.type||'application/octet-stream'}));
  return {...ref,fileIndex:index,filename:choice.filename||choice.file.name,origin:choice.origin||'Local file',...(choice.librarySource?{librarySource:choice.librarySource}:{})};
 });
 return {...result,references,originals};
}
