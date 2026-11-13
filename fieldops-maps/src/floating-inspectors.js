import {installPanelStack} from './panel-stack.js';
// The shared stack also handles the sidebar and table, so inspectors do not
// remain permanently above other windows just because they use the top layer.
export function installFloatingInspectors(root,menu,doc=document){
 const stack=installPanelStack(doc);stack.register(menu);return {refresh:stack.refresh};
}
