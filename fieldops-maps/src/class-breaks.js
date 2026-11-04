// Exact weighted 1D least-squares (Jenks) with monotone divide-and-conquer DP.
export function naturalBreaks(values,count){
 const sorted=values.slice().sort((a,b)=>a-b),x=[...new Set(sorted)],n=x.length,k=Math.min(count,n);if(n===1)return [x[0],x[0]];
 const weights=new Map();for(const v of sorted)weights.set(v,(weights.get(v)||0)+1);
 const w=[0],sum=[0],sq=[0],origin=x[0];for(let i=0;i<n;i++){const z=x[i]-origin,c=weights.get(x[i]);w.push(w[i]+c);sum.push(sum[i]+z*c);sq.push(sq[i]+z*z*c);}
 const cost=(a,b)=>Math.max(0,sq[b]-sq[a]-(sum[b]-sum[a])**2/(w[b]-w[a]));
 let prev=Array(n+1).fill(Infinity);prev[0]=0;const cuts=[];
 for(let group=1;group<=k;group++){const next=Array(n+1).fill(Infinity),split=Array(n+1).fill(0);
  function solve(lo,hi,left,right){if(lo>hi)return;const mid=(lo+hi)>>1;let best=-1;for(let j=left;j<=Math.min(mid-1,right);j++){const v=prev[j]+cost(j,mid);if(v<next[mid]){next[mid]=v;best=j;}}split[mid]=best;solve(lo,mid-1,left,best);solve(mid+1,hi,best,right);}
  solve(group,n,group-1,n-1);cuts.push(split);prev=next;
 }
 const boundaries=[x.at(-1)];let at=n;for(let group=k-1;group>0;group--){at=cuts[group][at];boundaries.unshift(x[at-1]/2+x[at]/2);}boundaries.unshift(x[0]);return boundaries;
}
export function manualBreaks(values,text){
 const limits=String(text).split(',').map(v=>v.trim());if(limits.some(v=>!v)||limits.length<2||limits.length>13)throw Error('Enter 2–13 ascending limits separated by commas, including the lowest and highest value.');const breaks=limits.map(Number);
 if(breaks.some((v,i)=>!Number.isFinite(v)||(i&&v<=breaks[i-1])))throw Error('Manual limits must be numbers in strictly ascending order.');
 if(values.some(v=>v<breaks[0]||v>breaks.at(-1)))throw Error('Manual limits must cover every numeric value.');return breaks;
}
