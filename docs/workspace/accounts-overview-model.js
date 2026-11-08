(function(root){
 const tracked=[{id:'mitchells',name:'Mitchells',aliases:['mitchells','mitchells drilling']},{id:'depco',name:'DEPCO',aliases:['depco','depco drilling']},{id:'weatherford',name:'Weatherford / Precision',aliases:['weatherfords','weatherford','precision','precision drilling','weatherford precision']},{id:'fortem',name:'Fortem',aliases:['fortem']}];
 const text=v=>String(v??'').trim(),norm=v=>text(v).toLowerCase().replace(/[^a-z0-9]/g,'');
 const family=name=>tracked.find(t=>t.aliases.some(a=>norm(a)===norm(name)))?.id||norm(name);
 const known=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
 const cents=v=>Math.round(Number(v)*100);
 function date(value){
  const s=text(value);let y,m,d,parts;
  if(parts=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/)){[,y,m,d]=parts;}
  else if(parts=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)){[,d,m,y]=parts;}
  else if(parts=s.match(/^(\d{1,2})\s*([a-z]{3,9})\s*(\d{4})$/i)){d=parts[1];m=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(parts[2].slice(0,3).toLowerCase())+1;y=parts[3];}
  else return '';
  const check=new Date(Date.UTC(+y,+m-1,+d));if(check.getUTCFullYear()!==+y||check.getUTCMonth()!==+m-1||check.getUTCDate()!==+d)return '';
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
 }
 function month(value){const s=text(value);let m=s.match(/^(\d{4})-(0[1-9]|1[0-2])$/);if(m)return s;m=s.match(/^(0?[1-9]|1[0-2])\/(\d{4})$/);return m?`${m[2]}-${m[1].padStart(2,'0')}`:'';}
 const period=r=>month(r.billing_month)||date(r.invoice_date).slice(0,7);
 const scope=r=>JSON.stringify([norm(r.project),norm(r.program)]);
 const workKey=(r,m)=>JSON.stringify([family(r.contractor),scope(r),m]);
 function build(invoices,eos,{year,project='',today}){
  const within=r=>!project||scope(r)===project;
  const records=invoices.filter(within),eligible=records.filter(r=>period(r).startsWith(year+'-'));
  const usable=r=>text(r.invoice_number)&&known(r.subtotal)&&period(r);
  const received=eligible.filter(r=>usable(r)&&Number(r.subtotal)>=0),credits=eligible.filter(r=>known(r.subtotal)&&Number(r.subtotal)<0);
  const invoiceKeys=new Set(received.map(r=>workKey(r,period(r))));
  const work=eos.filter(r=>within(r)&&text(r.month).startsWith(year+'-')&&Number(r.eos_total)>0);
  const gaps=[...new Map(work.filter(r=>r.month<today.slice(0,7)&&!invoiceKeys.has(workKey(r,r.month))).map(r=>[workKey(r,r.month),r])).values()];
  const months=Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);
  const totals=months.map(m=>({month:m,total:eligible.filter(r=>period(r)===m&&known(r.subtotal)).reduce((s,r)=>s+cents(r.subtotal),0)/100,count:received.filter(r=>period(r)===m).length}));
  const suppliers=new Map();for(const r of eligible){const key=family(r.contractor);if(!suppliers.has(key))suppliers.set(key,{name:tracked.find(t=>t.id===key)?.name||r.contractor,total:0});if(known(r.subtotal))suppliers.get(key).total+=cents(r.subtotal);}
  const rows=tracked.map(t=>{
   const own=received.filter(r=>family(r.contractor)===t.id).sort((a,b)=>period(b).localeCompare(period(a))||date(b.invoice_date).localeCompare(date(a.invoice_date)));
   return {...t,latest:own[0]||null,latestMonth:own[0]?period(own[0]):'',fallback:own[0]?!month(own[0].billing_month):false,
    cells:months.map(m=>{const entries=eligible.filter(r=>family(r.contractor)===t.id&&period(r)===m),receipts=own.filter(r=>period(r)===m),missing=gaps.filter(r=>family(r.contractor)===t.id&&r.month===m),reports=work.filter(r=>family(r.contractor)===t.id&&r.month===m);
     return {month:m,entries,receipts,gaps:missing,reports,status:missing.length?(receipts.length?'partial':'gap'):receipts.length?'received':entries.some(r=>known(r.subtotal)&&Number(r.subtotal)<0)?'credit':m>today.slice(0,7)?'future':'none'};})};
  });
  const closed=months.filter(m=>m<today.slice(0,7)).at(-1)||'';
  return {year,months,totals,rows,records:eligible,net:totals.reduce((s,r)=>s+cents(r.total),0)/100,count:received.length,credits:credits.length,
   suppliers:[...suppliers.values()].map(r=>({...r,total:r.total/100})).sort((a,b)=>Math.abs(b.total)-Math.abs(a.total)),gaps,
   closed,receivedClosed:rows.filter(r=>r.cells.some(c=>c.month===closed&&c.receipts.length)).length,
   undated:records.filter(r=>!period(r)).length,incomplete:eligible.filter(r=>!usable(r)).length,fallbacks:eligible.filter(r=>!month(r.billing_month)).length};
 }
 const api={tracked,family,date,month,period,scope,build};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AccountsOverview=api;
})(typeof globalThis!=='undefined'?globalThis:this);
