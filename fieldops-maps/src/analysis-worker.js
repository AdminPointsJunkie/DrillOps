import {analyse} from './analysis-engine.js';
self.onmessage=({data})=>{try{self.postMessage({result:analyse(data)});}catch(e){self.postMessage({error:e.message});}};
