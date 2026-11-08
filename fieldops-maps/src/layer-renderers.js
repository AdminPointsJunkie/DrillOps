// Leaflet 1.9.4 caches one renderer per custom pane. Removing paths alone keeps
// its Canvas surface alive, so release only the departing project's own panes.
export function releaseLayerRenderers(map,layers){
 for(const layer of layers){
  if(!layer._pane)continue;
  const renderer=map._paneRenderers?.[layer._pane];
  if(renderer){map.removeLayer(renderer);delete map._paneRenderers[layer._pane];}
 }
}
