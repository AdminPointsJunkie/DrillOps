// Capture at the map's actual viewport size before shrinking the finished image.
// Never replace a saved preview with tiles that are still loading.
export async function captureMapPreview(map,{render,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const node=map.getContainer();
 const loading=()=>{let pending=false;map.eachLayer(layer=>{if(layer.isLoading?.())pending=true;});return pending;};
 for(let i=0;i<25&&loading();i++)await wait(200);
 if(loading())return null;
 const width=node.clientWidth,height=node.clientHeight;
 if(!width||!height)return null;
 const toJpeg=render||(await import('html-to-image')).toJpeg;
 return toJpeg(node,{width,height,quality:.7,pixelRatio:1,canvasWidth:400,canvasHeight:Math.max(1,Math.round(400*height/width)),skipFonts:true,
  style:{width:width+'px',height:height+'px',position:'relative',inset:'auto',left:'0',top:'0',margin:'0',transform:'none'},
  filter:node=>!node.classList?.contains('leaflet-control-container')});
}
