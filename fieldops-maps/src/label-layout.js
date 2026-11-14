export const LABEL_FONT='Arial, sans-serif';
export function labelsOverlap(a,b,padding=3){return a.left<b.right+padding&&a.right+padding>b.left&&a.top<b.bottom+padding&&a.bottom+padding>b.top;}
// Match Leaflet Tooltip._setPosition, with CSS direction margins removed.
export function labelPlacement(point,size,direction,gap=10,anchor=[0,0],halo=0){
 const offset=({right:[gap,0],left:[-gap,0],top:[0,-gap],bottom:[0,gap],center:[0,0]})[direction];
 const subX=direction==='right'?0:direction==='left'?size.width:Math.round(size.width/2);
 const subY=direction==='bottom'?0:direction==='top'?size.height:Math.round(size.height/2);
 const left=point.x-subX+offset[0]+anchor[0],top=point.y-subY+offset[1]+anchor[1];
 return {offset,box:{left:left-halo,top:top-halo,right:left+size.width+halo,bottom:top+size.height+halo}};
}
export function createLabelIndex(boxes=[]){
 const cells=new Map(),cellSize=64;
 function keys(box,padding=0){const keys=[];for(let x=Math.floor((box.left-padding)/cellSize);x<=Math.floor((box.right+padding)/cellSize);x++)for(let y=Math.floor((box.top-padding)/cellSize);y<=Math.floor((box.bottom+padding)/cellSize);y++)keys.push(x+','+y);return keys;}
 function index(box){for(const key of keys(box)){if(!cells.has(key))cells.set(key,[]);cells.get(key).push(box);}}
 boxes.forEach(index);
 return {add(box){boxes.push(box);index(box);},overlaps(box){const seen=new Set();for(const key of keys(box,3))for(const other of cells.get(key)||[]){if(seen.has(other))continue;seen.add(other);if(labelsOverlap(box,other))return true;}return false;}};
}
