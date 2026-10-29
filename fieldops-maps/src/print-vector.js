import {xml,textSVG,legendSVG,layerSVG,framePoint,footprint} from './print-cartography.js';
import {tokens} from './print-model.js';
const px=96/25.4;
const image=(url,w,h)=>`<image width="${w}" height="${h}" href="${xml(url)}" preserveAspectRatio="none"/>`;
export async function pageSVG(page,context,maps,{quick=false,pixelRatio=2}={}){
 const {toCanvas}=await import('html-to-image');const width=page.width*px,height=page.height*px;
 let out=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${xml(context.title)}</title><rect width="100%" height="100%" fill="white"/>`,i=0;
 const active=page.items.filter(i=>i.type==='map'),targetFor=item=>active.find(m=>m.id===item.target)||active[0];
 for(const item of [...page.items].sort((a,b)=>Number(b.type==='section')-Number(a.type==='section'))){if(item.hidden)continue;const w=item.w*px,h=item.h*px,id=`clip-${i++}`;
  out+=`<defs><clipPath id="${id}"><rect width="${w}" height="${h}"/></clipPath></defs><g transform="translate(${item.x*px} ${item.y*px})"><g clip-path="url(#${id})">`;
  if(item.type==='section')out+=`<rect width="${w}" height="${h}" fill="${xml(item.color||'#e8eee9')}"/>`;
  else if(item.type==='text')out+=textSVG(tokens(item.text,context),2,(item.fontSize||14)+2,w-4,item.fontSize||14);
  else if(item.type==='image')out+=`<image width="${w}" height="${h}" href="${xml(item.src)}" preserveAspectRatio="xMidYMid meet"/>`;
  else if(item.type==='legend'){const target=targetFor(item);out+=legendSVG(context.layers.filter(l=>target?.layers.includes(l.id)),item,w,h,{title:quick&&page.title?context.title:'Legend',description:quick&&page.description?context.description:''}).markup;}
  else if(item.type==='map'||item.type==='locator'){
   const m=maps.get(item.id);if(!m)throw Error('Map view could not be prepared.');const frame=m.getContainer().parentElement;
   const capture=async selected=>{
    const container=m.getContainer(),background=container.style.background;if(selected)container.style.background='transparent';
    try{const canvas=await toCanvas(frame,{backgroundColor:selected?'transparent':'#eef1ee',style:{background:selected?'transparent':'#eef1ee'},pixelRatio,skipAutoScale:true,fontEmbedCSS:'',filter:node=>{
     if(node.classList?.contains('leaflet-control-container'))return false;
     if(node.dataset?.printLayer)return node.dataset.printLayer===selected;
     if(node.classList?.contains('leaflet-tile-pane'))return !selected;
     if(['leaflet-overlay-pane','leaflet-marker-pane','leaflet-shadow-pane','leaflet-tooltip-pane','leaflet-popup-pane'].some(c=>node.classList?.contains(c)))return false;
     return true;
    }});return canvas.toDataURL('image/png');}finally{container.style.background=background;}
   };
   const basemap=(item.type==='locator'?targetFor(item)?.basemap:item.basemap)||context.basemap;
   out+=basemap==='none'?`<rect width="${w}" height="${h}" fill="#eef1ee"/>`:image(await capture(null),w,h);
   if(item.type==='map')for(const layer of context.layers.filter(l=>item.layers.includes(l.id)).slice().reverse()){
    if(layer.kind==='raster'||layer.metadata?.xyz)out+=image(await capture(layer.id),w,h);else out+=`<g data-layer="${xml(layer.name)}">${layerSVG(layer,m)}</g>`;
   }
   else{const target=maps.get(targetFor(item)?.id);if(target){const d=footprint(target).map((ll,i)=>{const p=framePoint(m,ll);return `${i?'L':'M'}${p[0]} ${p[1]}`;}).join('')+'Z';out+=`<path d="${d}" fill="#cc3333" fill-opacity=".08" stroke="#cc3333" stroke-width="2"/>`;}}
   if(item.type==='map'&&item.north)out+=`<g transform="translate(${w-25} 30) rotate(${item.bearing||0})"><path d="M0 -12L-6 7L0 3L6 7Z" fill="#17382b"/>${textSVG('N',-4,-16,20,12)}</g>`;
   // Controls are recreated as vector text and lines, retaining every data attribution.
   const credit=m.getContainer().parentElement.parentElement.querySelector('.leaflet-control-attribution')?.textContent||'';
   if(credit){const lines=Math.ceil(credit.length*8*.56/Math.max(20,w-10));out+=`<rect x="0" y="${h-lines*10-4}" width="${w}" height="${lines*10+4}" fill="white" fill-opacity=".85"/>`+textSVG(credit,4,h-lines*10+4,w-8,8);}
   if(item.scale){const control=m.getContainer().parentElement.parentElement.querySelector('.leaflet-control-scale-line');if(control){const length=control.getBoundingClientRect().width,y=h-32;out+=`<rect x="8" y="${y-14}" width="${length+4}" height="19" fill="white" fill-opacity=".8"/><path d="M10 ${y-3}V${y+2}H${10+length}V${y-3}" fill="none" stroke="#333" stroke-width="1.5"/>`+textSVG(control.textContent,12,y-3,length,9);}}
  }
  out+='</g></g>';
 }return out+'</svg>';
}
let fontData;
export async function vectorPDF(pdf,svg,width,height){
 const {svg2pdf}=await import('svg2pdf.js');
 if(!fontData){const response=await fetch(import.meta.env.BASE_URL+'fonts/NotoSans-Regular.ttf');if(!response.ok)throw Error('The export font could not load.');const bytes=new Uint8Array(await response.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));fontData=btoa(binary);}
 if(!pdf.getFontList().NotoSans){pdf.addFileToVFS('NotoSans.ttf',fontData);pdf.addFont('NotoSans.ttf','NotoSans','normal');pdf.addFont('NotoSans.ttf','NotoSans','bold');}
 const element=new DOMParser().parseFromString(svg.replaceAll('font-family="Arial"','font-family="NotoSans"'),'image/svg+xml').documentElement;
 if(element.nodeName==='parsererror'||element.querySelector('parsererror'))throw Error('Could not build the vector document.');
 await svg2pdf(element,pdf,{x:0,y:0,width,height});
}
export function downloadBlob(blob,filename){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
