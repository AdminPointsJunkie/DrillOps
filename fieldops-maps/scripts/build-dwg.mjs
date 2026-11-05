import {execFileSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),tmp=mkdtempSync(join(tmpdir(),'fieldmaps-dwg-'));
const commit='d9f3de8c9910b602d392aa1acc72b62c095ec40e';
const run=(cmd,args,cwd=root)=>execFileSync(cmd,args,{cwd,stdio:'inherit'});
try{
 const source=join(tmp,'ACadSharp');
 run('git',['clone','https://github.com/DomCR/ACadSharp.git',source]);
 run('git',['checkout',commit],source);run('git',['submodule','update','--init','--recursive'],source);
 // GDAL needs explicit layer 0 to inherit the enclosing INSERT layer when blocks expand.
 const writer=join(source,'src/ACadSharp/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.cs');
 const original=readFileSync(writer,'utf8'),defaultLayer='this._writer.WriteIfNotDefault(8, entity.Layer.Name, Layer.DefaultName);';
 if(!original.includes(defaultLayer))throw Error('Review the ACadSharp layer-0 compatibility patch after upgrading.');
 writeFileSync(writer,original.replace(defaultLayer,'this._writer.Write(8, entity.Layer.Name);'));
 const project=resolve(root,'tools/dwg-browser');
 rmSync(join(project,'bin/Release/net10.0/browser-wasm/publish'),{recursive:true,force:true});
 run('dotnet',['publish',project,'-c','Release','-p:TargetFrameworks=net10.0','-p:DebugType=none','-p:DebugSymbols=false','-p:GeneratePackageOnBuild=false',`-p:ACadSharpProject=${source}/src/ACadSharp/ACadSharp.csproj`]);
 const dest=resolve(root,'public/dwg');mkdirSync(dest,{recursive:true});rmSync(join(dest,'runtime'),{recursive:true,force:true});
 cpSync(join(project,'bin/Release/net10.0/browser-wasm/publish/wwwroot/_framework'),join(dest,'runtime'),{recursive:true,filter:path=>! /\.(br|gz|pdb|map)$/.test(path)});
 cpSync(join(project,'convert-worker.js'),join(dest,'convert-worker.js'));
 cpSync(join(source,'LICENSE'),join(dest,'ACadSharp-LICENSE.txt'));
 cpSync(join(source,'src/CSUtilities/LICENSE'),join(dest,'CSUtilities-LICENSE.txt'));
 // .NET licence and third-party notices are checked in alongside the runtime. Update them when upgrading the SDK.
 writeFileSync(join(dest,'VERSION.txt'),`ACadSharp 3.8.37\n${commit}\nBuilt with .NET ${execFileSync('dotnet',['--version'],{encoding:'utf8'}).trim()}\n`);
}finally{rmSync(tmp,{recursive:true,force:true});}
