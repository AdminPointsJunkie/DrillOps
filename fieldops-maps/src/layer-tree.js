// Top-to-bottom display order; groups are one level deep.
export const nodeId=node=>typeof node==='string'?node:node.id;
export const flattenTree=tree=>tree.flatMap(node=>typeof node==='string'?[node]:node.children);
export function parentGroup(tree,id){return tree.find(n=>typeof n!=='string'&&n.children.includes(id));}
export function removeNode(tree,id){
 for(const list of [tree,...tree.filter(n=>typeof n!=='string').map(n=>n.children)]){
  const index=list.findIndex(n=>nodeId(n)===id);if(index!==-1)return list.splice(index,1)[0];
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
 removeNode(tree,id);
 if(!targetId){tree.push(node);return true;}
 if(position==='inside'&&targetGroup){targetGroup.children.push(node);return true;}
 const list=parentGroup(tree,targetId)?.children||tree;
 list.splice(list.findIndex(n=>nodeId(n)===targetId)+(position==='after'?1:0),0,node);return true;
}
export function normaliseTree(raw,ids){
 const seen=new Set(),groups=new Set();
 const take=id=>typeof id==='string'&&!seen.has(id)&&(seen.add(id),true);
 const tree=[];
 for(const node of Array.isArray(raw)?raw:[]){
  if(typeof node==='string'){if(take(node))tree.push(node);}
  else if(node&&typeof node.id==='string'&&!groups.has(node.id)){
   groups.add(node.id);tree.push({id:node.id,name:String(node.name||'Group').slice(0,100),visible:node.visible!==false,collapsed:!!node.collapsed,
    children:(Array.isArray(node.children)?node.children:[]).filter(take)});
  }
 }
 for(const id of ids)if(take(id))tree.push(id);
 return tree;
}
