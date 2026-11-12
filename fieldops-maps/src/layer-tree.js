// Top-to-bottom display order; groups are one level deep.
export const nodeId=node=>typeof node==='string'?node:node.id;
export const flattenTree=tree=>tree.flatMap(node=>typeof node==='string'?[node]:node.children);
export function parentGroup(tree,id){return tree.find(n=>typeof n!=='string'&&n.children.includes(id));}
export function removeNode(tree,id,prune=true){
 for(const list of [tree,...tree.filter(n=>typeof n!=='string').map(n=>n.children)]){
  const index=list.findIndex(n=>nodeId(n)===id);if(index!==-1){const removed=list.splice(index,1)[0];if(prune){const group=tree.find(n=>typeof n!=='string'&&n.children===list);if(group&&!list.length)tree.splice(tree.indexOf(group),1);}return removed;}
 }
}
export function moveNode(tree,id,targetId,position='before'){
 if(id===targetId)return false;
 const node=tree.find(n=>nodeId(n)===id)??flattenTree(tree).find(n=>n===id);
 if(!node)return false;
 const targetGroup=tree.find(n=>typeof n!=='string'&&n.id===targetId);
 // Groups can move at the root only; never into themselves or another group.
 if(typeof node!=='string'&&(parentGroup(tree,targetId)||position==='inside'))return false;
 if(targetId&&!targetGroup&&!flattenTree(tree).includes(targetId))return false;
 const source=parentGroup(tree,id);
 removeNode(tree,id,false);
 const finish=()=>{if(source&&!source.children.length)tree.splice(tree.indexOf(source),1);return true;};
 if(!targetId){tree.push(node);return finish();}
 if(position==='inside'&&targetGroup){targetGroup.children.push(node);return finish();}
 const list=parentGroup(tree,targetId)?.children||tree;
 list.splice(list.findIndex(n=>nodeId(n)===targetId)+(position==='after'?1:0),0,node);return finish();
}
export function normaliseTree(raw,ids){
 const seen=new Set(),groups=new Set(),available=new Set(ids);
 const take=id=>typeof id==='string'&&available.has(id)&&!seen.has(id)&&(seen.add(id),true);
 const tree=[];
 for(const node of Array.isArray(raw)?raw:[]){
  if(typeof node==='string'){if(take(node))tree.push(node);}
  else if(node&&typeof node.id==='string'&&!groups.has(node.id)){
   groups.add(node.id);tree.push({id:node.id,name:String(node.name||'Group').slice(0,100),visible:node.visible!==false,collapsed:!!node.collapsed,
    children:(Array.isArray(node.children)?node.children:[]).filter(take)});
  }
 }
 for(let i=tree.length-1;i>=0;i--)if(typeof tree[i]!=='string'&&!tree[i].children.length)tree.splice(i,1);
 for(const id of ids)if(take(id))tree.push(id);
 return tree;
}
// Gather selected layers in their existing display order, at the first selected root position.
export function groupLayers(tree,ids,id,name='Group'){
 const chosen=new Set(ids),children=flattenTree(tree).filter(x=>chosen.has(x));
 if(!children.length)return null;
 const first=tree.findIndex(n=>typeof n==='string'?chosen.has(n):n.children.some(x=>chosen.has(x)));
 const group={id,name,children,visible:true,collapsed:false},next=[];
 tree.forEach((node,index)=>{if(index===first)next.push(group);if(typeof node==='string'){if(!chosen.has(node))next.push(node);}else{const remaining=node.children.filter(x=>!chosen.has(x));if(remaining.length||!node.children.length){node.children=remaining;next.push(node);}}});
 tree.splice(0,tree.length,...next);return group;
}
