import {heatmapRaster,hexSummary} from './density-analysis.js';
import {analyse} from './analysis-engine.js';
self.onmessage=async({data})=>{try{self.postMessage({result:data.operation==='heatmap'?await heatmapRaster(data.source,data.distance):data.operation==='hex'?hexSummary(data.source,data.distance):analyse(data)});}catch(e){self.postMessage({error:e.message});}};
