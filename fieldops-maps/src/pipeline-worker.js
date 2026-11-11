import {openDEM} from './pipeline-dem.js';
import {planPipeline} from './pipeline-engine.js';
self.onmessage=async({data})=>{let dem;try{dem=await openDEM(data.file,data.demOptions);const results=await planPipeline(data.input,dem.sample,message=>self.postMessage({progress:message}));self.postMessage({results});}catch(e){self.postMessage({error:e.message});}finally{dem?.dispose();}};
