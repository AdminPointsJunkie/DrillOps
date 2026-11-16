// Top-to-bottom display order. Groups may contain layers or other groups.
export const nodeId=node=>typeof node==='string'?node:node.id;
export const flattenTree=tree=>tree.flatMap(node=>typeof node==='string'?[node]:flattenTree(node.children||[]));
export function findNode(tree,id){for(const node of tree){if(nodeId(node)===id)return node;if(typeof node!=='string'){const found=findNode(node.children,id);if(found)return found;}}}
export function parentGroup(tree,id){for(const node of tree){if(typeof node==='string')continue;if(node.children.some(child=>nodeId(child)===id))return node;const parent=parentGroup(node.children,id);if(parent)return parent;}}
export function ancestorGroups(tree,id){const result=[];let parent=parentGroup(tree,id);while(parent){result.unshift(parent);parent=parentGroup(tree,parent.id);}return result;}
export function allGroups(tree){return tree.flatMap(node=>typeof node==='string'?[]:[node,...allGroups(node.children)]);}
export function removeNode(tree,id,prune=true){
 const parent=parentGroup(tree,id),list=parent?.children||tree,index=list.findIndex(n=>nodeId(n)===id);
 if(index<0)return;
 const removed=list.splice(index,1)[0];if(prune&&parent&&!list.length)removeNode(tree,parent.id);return removed;
}
export function moveNode(tree,id,targetId,position='before'){
 if(id===targetId)return false;
 const node=findNode(tree,id),target=targetId?findNode(tree,targetId):null;
 if(!node||(targetId&&!target)||(position==='inside'&&typeof target==='string'))return false;
 // Reject every descendant destination before removing anything, to prevent cycles/data loss.
 if(typeof node!=='string'&&targetId&&findNode(node.children,targetId))return false;
 const source=parentGroup(tree,id);removeNode(tree,id,false);
 if(!targetId)tree.push(node);
 else if(position==='inside')target.children.push(node);
 else{const list=parentGroup(tree,targetId)?.children||tree;list.splice(list.findIndex(n=>nodeId(n)===targetId)+(position==='after'?1:0),0,node);}
 if(source&&!source.children.length)removeNode(tree,source.id);
 return true;
}
export function ungroupNode(tree,id){const node=findNode(tree,id);if(!node||typeof node==='string')return false;const list=parentGroup(tree,id)?.children||tree;list.splice(list.indexOf(node),1,...node.children);return true;}

// Keep the persisted layout compatible with the existing publisher and mobile apps:
// each flat group contains layer IDs; desktop_group records the nested hierarchy.
// Effective visibility is written for older clients, with each group's own choice retained.
export function serialiseTree(tree){
 if(!allGroups(tree).some(g=>g.children.some(n=>typeof n!=='string')))return structuredClone(tree);
 const result=[];
 function visit(nodes,parent=null,visible=true){for(const node of nodes){if(typeof node==='string'){if(!parent)result.push(node);continue;}const shown=visible&&node.visible!==false;
  result.push({...node,visible:shown,children:node.children.filter(n=>typeof n==='string'),desktop_group:{parent,visible:node.visible!==false,order:node.children.map(nodeId)}});
  visit(node.children,node.id,shown);
 }}visit(tree);return result;
}
export function restoreTree(raw){
 const source=Array.isArray(raw)?structuredClone(raw):[],groups=new Map(source.filter(n=>n&&typeof n==='object'&&typeof n.id==='string').map(n=>[n.id,n])),attached=new Set();
 for(const group of groups.values()){
  const hint=group.desktop_group;if(!hint)continue;
  group.visible=hint.visible!==false;
  const direct=new Set(group.children.filter(n=>typeof n==='string')),children=[],used=new Set();
  for(const id of Array.isArray(hint.order)?hint.order:[]){if(used.has(id))continue;used.add(id);const child=groups.get(id);
   if(direct.delete(id)){children.push(id);continue;}
   if(!child||child===group||child.desktop_group?.parent!==group.id)continue;
   let parent=group;const seen=new Set([id]);while(parent&&!seen.has(parent.id)){seen.add(parent.id);parent=groups.get(parent.desktop_group?.parent);}
   if(parent)continue;
   children.push(child);attached.add(id);
  }
  children.push(...direct);group.children=children;
 }
 for(const group of groups.values())delete group.desktop_group;
 return source.filter(n=>typeof n==='string'||!attached.has(n?.id));
}
export function normaliseTree(raw,ids){
 const seen=new Set(),groups=new Set(),available=new Set(ids);
 const take=id=>typeof id==='string'&&available.has(id)&&!seen.has(id)&&(seen.add(id),true);
 function visit(nodes){const result=[];for(const node of nodes){if(typeof node==='string'){if(take(node))result.push(node);}else if(node&&typeof node.id==='string'&&!available.has(node.id)&&!groups.has(node.id)){
  groups.add(node.id);const children=visit(Array.isArray(node.children)?node.children:[]);
  if(children.length)result.push({id:node.id,name:String(node.name||'Group').slice(0,100),visible:node.visible!==false,collapsed:!!node.collapsed,children});
 }}return result;}
 const tree=visit(restoreTree(raw));for(const id of ids)if(take(id))tree.push(id);return tree;
}
// Group chosen nodes at their closest shared parent, retaining display order.
export function groupLayers(tree,ids,id,name='Group'){
 const chosen=new Set(ids),children=[];
 function collect(nodes){for(const node of nodes){if(chosen.has(nodeId(node)))children.push(node);else if(typeof node!=='string')collect(node.children);}}collect(tree);
 if(!children.length)return null;
 const paths=children.map(n=>ancestorGroups(tree,nodeId(n)));let parent=null;
 for(let i=0;i<paths[0].length&&paths.every(path=>path[i]===paths[0][i]);i++)parent=paths[0][i];
 const list=parent?.children||tree,first=children[0],branch=paths[0][(parent?paths[0].indexOf(parent)+1:0)]||first,index=list.indexOf(branch);
 const group={id,name,children:[],visible:true,collapsed:false};list.splice(index,0,group);
 for(const node of children)removeNode(tree,nodeId(node));group.children=children;return group;
}
