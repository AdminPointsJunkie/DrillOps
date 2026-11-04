import {tokens} from './print-model.js';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const textFonts={sans:'Arial',serif:'Times New Roman',mono:'Courier New'};
const colour=(v,fallback)=>/^#[0-9a-f]{6}$/i.test(v||'')?v:fallback;
const bounded=(v,min,max,fallback)=>Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):fallback;
export function textFormat(item){return {font:Object.hasOwn(textFonts,item.fontFamily)?item.fontFamily:'sans',size:bounded(item.fontSize,6,200,14),bold:!!item.bold,italic:!!item.italic,underline:!!item.underline,align:['left','center','right'].includes(item.textAlign)?item.textAlign:'left',color:colour(item.textColor,'#283746'),background:item.textBackground?colour(item.backgroundColor,'#ffffff'):'none',padding:bounded(item.textPadding,0,80,2),lineHeight:bounded(item.lineHeight,1,3,1.25)};}
export function textBoxSVG(item,context,width,height){
 const f=textFormat(item),text=tokens(item.text,context),available=Math.max(1,width-2*f.padding),lines=[];
 const ctx=globalThis.document?.createElement('canvas').getContext('2d');
 if(ctx)ctx.font=`${f.italic?'italic ':''}${f.bold?'bold ':''}${f.size}px "${textFonts[f.font]}"`;
 const measure=value=>ctx?ctx.measureText(value).width:[...value].length*f.size*.56;
 for(const paragraph of text.split('\n')){let line='';for(const word of paragraph.split(/(\s+)/)){if(line&&measure(line+word)>available){lines.push(line.trimEnd());line='';}for(const char of word){if(line&&measure(line+char)>available){lines.push(line);line='';}line+=char;}}lines.push(line);}
 const x=f.align==='center'?width/2:f.align==='right'?width-f.padding:f.padding,anchor={left:'start',center:'middle',right:'end'}[f.align];
 let out=`<g data-text-font="${f.font}"><rect width="${width}" height="${height}" fill="${f.background}"/>`;
 lines.forEach((line,i)=>{const y=f.padding+f.size+i*f.size*f.lineHeight;out+=`<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${textFonts[f.font]}" font-size="${f.size}" font-weight="${f.bold?'bold':'normal'}" font-style="${f.italic?'italic':'normal'}" fill="${f.color}" xml:space="preserve">${esc(line)}</text>`;if(f.underline&&line){const length=measure(line),left=f.align==='center'?x-length/2:f.align==='right'?x-length:x;out+=`<path d="M${left} ${y+f.size*.12}h${length}" stroke="${f.color}" stroke-width="${Math.max(.7,f.size/16)}"/>`;}});
 return out+'</g>';
}
