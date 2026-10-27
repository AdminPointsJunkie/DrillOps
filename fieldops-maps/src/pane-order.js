// CSS z-index accepts integers only. Keep data below tooltips/popups.
// DOM order breaks ties when a project has more layers than available levels.
export function orderPanes(panes){
 for(let i=panes.length-1;i>=0;i--){
  const pane=panes[i];if(!pane)continue;
  pane.style.zIndex=String(400+Math.floor((panes.length-i)*190/(panes.length+1)));
  pane.parentNode?.appendChild(pane);
 }
}
