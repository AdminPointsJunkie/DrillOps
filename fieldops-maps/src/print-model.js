export const sizes={A4:[210,297],A3:[297,420],Letter:[215.9,279.4],Tabloid:[279.4,431.8]};
export function exportSize(width,height,dpi){
 if(![width,height,dpi].every(Number.isFinite)||width<25.4||height<25.4||width>2540||height>2540||![150,300,600].includes(dpi))throw Error('Choose a page between 1 and 100 inches and 150, 300 or 600 DPI.');
 const w=width/25.4*dpi,h=height/25.4*dpi,scale=Math.min(1,16384/w,16384/h,Math.sqrt(32000000/(w*h)));
 return {width:Math.max(1,Math.floor(w*scale)),height:Math.max(1,Math.floor(h*scale)),dpi:Math.floor(dpi*scale),reduced:scale<1};
}
export function tokens(text,context,date=new Date()){return String(text).replace(/\{\{\s*(map.title|map.description|current.date)\s*\}\}/g,(_,token)=>token==='map.title'?context.title:token==='map.description'?context.description||'':date.toLocaleDateString());}
export function standardPage(context){const mapId=crypto.randomUUID();return {id:crypto.randomUUID(),name:'Page 1',width:297,height:210,dpi:300,format:'PDF',units:'mm',items:[
 {id:crypto.randomUUID(),type:'text',x:12,y:8,w:232,h:14,text:'{{ map.title }}',fontSize:24},
 {id:mapId,type:'map',x:12,y:28,w:210,h:165,center:context.center,zoom:context.zoom,layers:context.layers.map(l=>l.id),north:true,scale:true,frame:true,measurement:'metric'},
 {id:crypto.randomUUID(),type:'legend',x:229,y:30,w:57,h:92,target:mapId},
 {id:crypto.randomUUID(),type:'locator',x:229,y:133,w:57,h:60,target:mapId},
 {id:crypto.randomUUID(),type:'text',x:12,y:195,w:273,h:9,text:'{{ current.date }}',fontSize:9}
 ]};}
export function resizePage(page,width,height){const sx=width/page.width,sy=height/page.height;for(const item of page.items){item.x*=sx;item.y*=sy;item.w*=sx;item.h*=sy;}page.width=width;page.height=height;return page;}
export function moveItem(item,dx,dy,page,resize=false){if(resize){item.w=Math.max(5,Math.min(page.width-item.x,item.w+dx));item.h=Math.max(5,Math.min(page.height-item.y,item.h+dy));}else{item.x=Math.max(0,Math.min(page.width-item.w,item.x+dx));item.y=Math.max(0,Math.min(page.height-item.h,item.y+dy));}}

export function imageExportSize(width,height,resolution){
 if(![width,height,resolution].every(Number.isFinite)||width<96||height<96||width>9600||height>9600||![1,2,3,4].includes(resolution))throw Error('Choose dimensions from 96 to 9,600 pixels and a resolution from 1× to 4×.');
 const scale=Math.min(resolution,16384/width,16384/height,Math.sqrt(32000000/(width*height)));
 return {width:Math.floor(width*scale),height:Math.floor(height*scale),dpi:Math.floor(96*scale),reduced:scale<resolution};
}

export function sampleLayouts(context){
 const report=standardPage(context);report.name='Field report';
 const portrait=standardPage(context);portrait.name='Portrait map';portrait.width=210;portrait.height=297;
 Object.assign(portrait.items[0],{w:145});Object.assign(portrait.items[1],{x:12,y:28,w:186,h:205});
 Object.assign(portrait.items[2],{x:12,y:240,w:120,h:40});Object.assign(portrait.items[3],{x:145,y:240,w:53,h:40});Object.assign(portrait.items[4],{x:12,y:285,w:186,h:8});
 const figure=standardPage(context);figure.name='Report figure';figure.items=figure.items.filter(i=>['map','text'].includes(i.type));Object.assign(figure.items.find(i=>i.type==='map'),{x:12,y:28,w:273,h:165});
 for(const page of [report,portrait,figure])for(const item of page.items)if(item.type==='map')item.frame=true;
 return [report,portrait,figure].map(page=>({name:page.name,page}));
}
