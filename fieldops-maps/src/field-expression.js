// Supported QGIS-style scalar expressions. Parsed as data; never executed as JavaScript.
export function compileFieldExpression(source,fields=[]){
 const text=String(source).trim().replace(/^=/,'');if(!text||text.length>4000)throw Error('Enter a formula of up to 4,000 characters.');
 const tokens=[];let pos=0;
 while(pos<text.length){const rest=text.slice(pos),space=/^\s+/.exec(rest);if(space){pos+=space[0].length;continue;}const m=/^("(?:[^"]|"")*"|'(?:[^']|'')*'|\[[^\]\r\n]+\]|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|>=|<=|!=|<>|\|\||[+*/%^(),<>=-]|[A-Za-z_][A-Za-z_0-9]*)/i.exec(rest);if(!m)throw Error('Unsupported expression near '+rest.slice(0,24));tokens.push(m[0]);pos+=m[0].length;}
 let i=0;const peek=()=>tokens[i]?.toLowerCase(),take=value=>{if(peek()!==value)throw Error('Expected '+value);i++;};
 const precedence={or:1,and:2,'=':3,'!=':3,'<>':3,'<':3,'>':3,'<=':3,'>=':3,is:3,'||':4,'+':5,'-':5,'*':6,'/':6,'%':6,'^':7};
 const arity={to_date:[1,2],year:[1,1],month:[1,1],day:[1,1],if:[3,3],coalesce:[1,30],nullif:[2,2],concat:[1,30],upper:[1,1],lower:[1,1],trim:[1,1],length:[1,1],replace:[3,3],substr:[2,3],to_real:[1,1],to_int:[1,1],to_string:[1,1],round:[1,2],abs:[1,1],sqrt:[1,1],floor:[1,1],ceil:[1,1],min:[1,30],max:[1,30]};
 function atom(){const token=tokens[i++];if(token===undefined)throw Error('Formula is incomplete.');const name=token.toLowerCase();
  if(['+','-','not'].includes(name))return {op:'unary',name,arg:expression(name==='not'?3:7)};
  if(token==='('){const value=expression(0);take(')');return value;}
  if(name==='case'){const branches=[];while(peek()==='when'){i++;const condition=expression(0);take('then');branches.push([condition,expression(0)]);}if(!branches.length)throw Error('Use CASE WHEN condition THEN value ELSE value END.');let otherwise={op:'value',value:null};if(peek()==='else'){i++;otherwise=expression(0);}take('end');return {op:'case',branches,otherwise};}
  if(token.startsWith('"')||token.startsWith('[')){const field=token.startsWith('"')?token.slice(1,-1).replaceAll('""','"'):token.slice(1,-1);if(!fields.includes(field))throw Error('Unknown column: '+field);return {op:'field',field};}
  if(token.startsWith("'"))return {op:'value',value:token.slice(1,-1).replaceAll("''","'")};
  if(/^\d|^\./.test(token))return {op:'value',value:Number(token)};
  if(['null','true','false'].includes(name))return {op:'value',value:name==='null'?null:name==='true'};
  if(fields.includes(token)&&peek()!=='(')return {op:'field',field:token};
  if(!Object.hasOwn(arity,name))throw Error('Unsupported function or column: '+token);take('(');const args=[];if(peek()!==')'){do{args.push(expression(0));if(peek()!==',')break;i++;}while(true);}take(')');if(args.length<arity[name][0]||args.length>arity[name][1])throw Error('Wrong number of arguments for '+name);return {op:'call',name,args};
 }
 function expression(min){let left=atom();while(Object.hasOwn(precedence,peek())&&precedence[peek()]>=min){const op=tokens[i++].toLowerCase(),p=precedence[op];if(op==='is'){const negate=peek()==='not';if(negate)i++;take('null');left={op:'isnull',left,negate};}else left={op,left,right:expression(op==='^'?p:p+1)};}return left;}
 const tree=expression(0);if(i!==tokens.length)throw Error('Unexpected token: '+tokens[i]);
 const nil=v=>v===null||v===undefined;
 const number=v=>{if(nil(v))return null;if(typeof v==='string'&&!v.trim())throw Error('Empty text is not a number; use nullif or coalesce.');const n=Number(v);if(!Number.isFinite(n))throw Error('Not a valid number: '+String(v).slice(0,40));return n;};
 const equal=(a,b)=>a===b||(!nil(a)&&!nil(b)&&String(a).trim()!==''&&String(b).trim()!==''&&Number.isFinite(Number(a))&&Number(a)===Number(b));
 const dateParts=(value,format='yyyy-MM-dd')=>{
  const patterns={'dd/MM/yyyy':[/^(\d{2})\/(\d{2})\/(\d{4})$/,[3,2,1]],'d/M/yyyy':[/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,[3,2,1]],'yyyy-MM-dd':[/^(\d{4})-(\d{2})-(\d{2})$/,[1,2,3]],'MM/dd/yyyy':[/^(\d{2})\/(\d{2})\/(\d{4})$/,[3,1,2]]};
  const pattern=patterns[format];if(!pattern)throw Error('Supported date formats: dd/MM/yyyy, d/M/yyyy, yyyy-MM-dd and MM/dd/yyyy.');const match=pattern[0].exec(String(value).trim());if(!match)throw Error('Date does not match '+format+': '+String(value));
  const [year,month,day]=pattern[1].map(i=>Number(match[i]));const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];if(year<1||month<1||month>12||day<1||day>days[month-1])throw Error('Invalid date: '+String(value));return [year,month,day];
 };
 function run(n,props){
  if(n.op==='value')return n.value;if(n.op==='field')return Object.hasOwn(props,n.field)?props[n.field]:null;
  if(n.op==='case'){for(const [condition,value] of n.branches)if(run(condition,props))return run(value,props);return run(n.otherwise,props);}
  if(n.op==='isnull')return n.negate?!nil(run(n.left,props)):nil(run(n.left,props));
  if(n.op==='unary'){const a=run(n.arg,props);return nil(a)?null:n.name==='not'?!a:n.name==='-'?-number(a):number(a);}
  if(n.op==='call'){
   if(n.name==='if')return run(n.args[0],props)?run(n.args[1],props):run(n.args[2],props);
   if(n.name==='coalesce'){for(const arg of n.args){const value=run(arg,props);if(!nil(value))return value;}return null;}
   const a=n.args.map(arg=>run(arg,props));if(n.name==='concat')return a.map(v=>v??'').join('');if(n.name==='nullif')return equal(a[0],a[1])?null:a[0];if(a.some(nil))return null;
   switch(n.name){case 'to_date':return dateParts(a[0],a[1]||'yyyy-MM-dd').map((v,i)=>String(v).padStart(i===0?4:2,'0')).join('-');case 'year':return dateParts(a[0])[0];case 'month':return dateParts(a[0])[1];case 'day':return dateParts(a[0])[2];case 'upper':return String(a[0]).toUpperCase();case 'lower':return String(a[0]).toLowerCase();case 'trim':return String(a[0]).trim();case 'length':return String(a[0]).length;case 'replace':return String(a[0]).split(String(a[1])).join(String(a[2]));case 'substr':{const start=number(a[1]),from=start<0?String(a[0]).length+start:start-1;return String(a[0]).slice(from,a.length===3?from+number(a[2]):undefined);}case 'to_string':return String(a[0]);case 'to_real':return number(a[0]);case 'to_int':return Math.trunc(number(a[0]));case 'round':{const digits=a.length===2?number(a[1]):0;if(!Number.isInteger(digits)||Math.abs(digits)>15)throw Error('Rounding precision must be an integer from -15 to 15.');const factor=10**digits;return Math.round(number(a[0])*factor)/factor;}default:return Math[n.name](...a.map(number));}
  }
  const a=run(n.left,props);if(n.op==='and'&&a===false)return false;if(n.op==='or'&&a===true)return true;const b=run(n.right,props);
  if(n.op==='and')return b===false?false:nil(a)||nil(b)?null:Boolean(a&&b);if(n.op==='or')return b===true?true:nil(a)||nil(b)?null:Boolean(a||b);
  if(nil(a)||nil(b))return null;if(n.op==='||')return String(a)+String(b);
  if(n.op==='=')return equal(a,b);if(n.op==='!='||n.op==='<>')return !equal(a,b);
  if(['>','<','>=','<='].includes(n.op)){const x=typeof a==='string'&&typeof b==='string'?a:number(a),y=typeof a==='string'&&typeof b==='string'?b:number(b);return n.op==='>'?x>y:n.op==='<'?x<y:n.op==='>='?x>=y:x<=y;}
  const x=number(a),y=number(b);switch(n.op){case '+':return x+y;case '-':return x-y;case '*':return x*y;case '/':if(y===0)throw Error('Division by zero.');return x/y;case '%':if(y===0)throw Error('Division by zero.');return x%y;case '^':return x**y;}
 }
 return props=>{const value=run(tree,props||{});if(typeof value==='number'&&!Number.isFinite(value))throw Error('Formula produced an invalid number.');return value;};
}
