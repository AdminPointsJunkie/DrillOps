import {readFile,writeFile} from 'node:fs/promises';
let source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
source=source.replace("import {SUPABASE_URL,SUPABASE_KEY,LOCAL_TESTING} from './config.js';","const SUPABASE_URL='',SUPABASE_KEY='',LOCAL_TESTING=true;").replaceAll("'./","'../src/");
source+=`\nsetTimeout(()=>{activeMap={id:'tools-fixture',name:'Analysis preview'};syncProject();homeUI.close();const features=Array.from({length:12},(_,i)=>({type:'Feature',properties:{name:'Test hole '+(i+1),status:i%3===0?'Complete':'Planned',depth:30+i*12,date:'2026-10-'+String(10+i).padStart(2,'0')},geometry:{type:'Point',coordinates:[153.02+(i%4)*.003,-27.47+Math.floor(i/4)*.003]}}));addAnalysisResult({type:'FeatureCollection',features},'Sample drill collars');fit();},300);`;
await writeFile(new URL('.browser-main.js',import.meta.url),source);
