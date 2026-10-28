// A small expression language: no JavaScript evaluation or property access.
export function compileExpression(source, fields = []) {
 const text=String(source).trim().replace(/^=/,'');
 if(!text||text.length>1000)throw new Error('Enter a formula of at most 1,000 characters.');
 const tokens=[];let pos=0;
 while(pos<text.length){
  const rest=text.slice(pos), space=/^\s+/.exec(rest);if(space){pos+=space[0].length;continue;}
  const match=/^(\[[^\]\r\n]+\]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|>=|<=|!=|==|<>|&&|\|\||[+*/%(),<>=!-]|[A-Za-z_][A-Za-z_0-9]*)/i.exec(rest);
  if(!match)throw new Error(`Unexpected character near ${rest.slice(0,20)}`);
  tokens.push(match[0]);pos+=match[0].length;
 }
 let i=0;
 const precedence={'||':1,or:1,'&&':2,and:2,'=':3,'==':3,'!=':3,'<>':3,'>':4,'<':4,'>=':4,'<=':4,'+':5,'-':5,'*':6,'/':6,'%':6};
 const functions={if:[3,3],min:[1,20],max:[1,20],abs:[1,1],round:[1,1],sqrt:[1,1],coalesce:[1,20]};
 function atom(){
  const t=tokens[i++];if(t===undefined)throw new Error('Formula is incomplete.');
  if(['-','+','!','not'].includes(t.toLowerCase()))return {op:'unary',name:t.toLowerCase(),arg:atom()};
  if(t==='('){const node=expression(0);if(tokens[i++]!==')')throw new Error('Missing closing parenthesis.');return node;}
  if(t.startsWith('[')){const name=t.slice(1,-1);if(!fields.includes(name))throw new Error(`Unknown column: ${name}`);return {op:'field',name};}
  if(/^['"]/.test(t))return {op:'value',value:t.slice(1,-1).replace(/\\(['"\\])/g,'$1')};
  if(/^\d|^\./.test(t))return {op:'value',value:Number(t)};
  const name=t.toLowerCase();
  if(['true','false','null'].includes(name))return {op:'value',value:name==='null'?null:name==='true'};
  if(!Object.hasOwn(functions,name)||tokens[i++]!=='(')throw new Error(`Unknown function: ${t}. Use [Column] for values.`);
  const args=[];if(tokens[i]!==')'){do{args.push(expression(0));if(tokens[i]!==',')break;i++;}while(true);}
  if(tokens[i++]!==')')throw new Error('Missing closing parenthesis.');
  if(args.length<functions[name][0]||args.length>functions[name][1])throw new Error(`Wrong number of arguments for ${name}.`);
  return {op:'call',name,args};
 }
 function expression(min){let left=atom();while(i<tokens.length){const op=tokens[i].toLowerCase(),p=Object.hasOwn(precedence,op)?precedence[op]:undefined;if(p===undefined||p<min)break;i++;left={op,left,right:expression(p+1)};}return left;}
 const tree=expression(0);if(i!==tokens.length)throw new Error(`Unexpected token: ${tokens[i]}`);
 const num=v=>v===null||v===undefined||String(v).trim()===''?NaN:Number(v);
 function run(n,p){
  if(n.op==='value')return n.value;
  if(n.op==='field')return Object.hasOwn(p,n.name)?p[n.name]:null;
  if(n.op==='unary'){const v=run(n.arg,p);return n.name==='-'?-num(v):n.name==='+'?num(v):!v;}
  if(n.op==='call'){
   if(n.name==='if')return run(n.args[0],p)?run(n.args[1],p):run(n.args[2],p);
   const args=n.args.map(a=>run(a,p));if(n.name==='coalesce')return args.find(v=>v!==null&&v!==undefined&&v!=='')??null;
   return Math[n.name](...args.map(num));
  }
  const a=run(n.left,p);
  if(n.op==='and'||n.op==='&&')return a&&run(n.right,p);
  if(n.op==='or'||n.op==='||')return a||run(n.right,p);
  const b=run(n.right,p),x=num(a),y=num(b);
  const equal=a===b||(Number.isFinite(x)&&Number.isFinite(y)&&x===y);
  switch(n.op){case '=':case '==':return equal;case '!=':case '<>':return !equal;case '>':return x>y;case '<':return x<y;case '>=':return x>=y;case '<=':return x<=y;case '+':return x+y;case '-':return x-y;case '*':return x*y;case '/':return x/y;case '%':return x%y;}
 }
 return properties=>run(tree,properties||{});
}
