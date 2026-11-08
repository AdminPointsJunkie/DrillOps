/* Fixed regional context. Weather loads independently, and never blocks production. */
let eosWeatherRequest=0,eosWeatherSummary=null;
const eosWeatherCache=new Map();
function prepareEosWeather(summary){eosWeatherSummary=summary;loadEosWeather();}
function clearEosWeather(){
 eosWeatherRequest++;document.getElementById('eos-weather-trend').replaceChildren();productionSet('eos-weather-status','');
}
async function loadEosWeather(retry=false){
 const summary=eosWeatherSummary,days=summary?.daily||[];
 if(!days.length){clearEosWeather();productionSet('eos-weather-status','No dated records in this period.');return;}
 const start=days[0].label,end=days.at(-1).label,key=JSON.stringify([start,end]),request=++eosWeatherRequest;
 if(retry)eosWeatherCache.delete(key);
 document.getElementById('eos-weather-trend').replaceChildren();productionSet('eos-weather-status','Loading historical conditions…');
 try{
  if(!eosWeatherCache.has(key)){
   const pending=fetch(API+'/eos/weather?'+new URLSearchParams({start,end}),{cache:'no-store'}).then(async response=>{
    if(!response.ok)throw Error('Weather unavailable.');const data=await response.json();if(!Array.isArray(data.days))throw Error('Weather unavailable.');return data;
   });
   eosWeatherCache.set(key,pending);if(eosWeatherCache.size>24)eosWeatherCache.delete(eosWeatherCache.keys().next().value);
   pending.catch(()=>{if(eosWeatherCache.get(key)===pending)eosWeatherCache.delete(key);});
  }
  const data=await eosWeatherCache.get(key);if(request!==eosWeatherRequest)return;renderEosWeather(data,summary);
 }catch(error){if(request!==eosWeatherRequest)return;productionSet('eos-weather-status','Weather unavailable — production is ready.');}
}
const eosWeatherLabels=['','Clear','Fair','Cloudy','Overcast','Fog','Freezing fog','Light rain','Rain','Heavy rain','Freezing rain','Heavy freezing rain','Sleet','Heavy sleet','Light snow','Snow','Heavy snow','Rain showers','Heavy rain showers','Sleet showers','Heavy sleet showers','Snow showers','Heavy snow showers','Lightning','Hail','Thunderstorm','Heavy thunderstorm','Storm'];
function eosWeatherPriority(code){return ({23:100,26:99,25:98,24:90,27:85,9:80,18:79,8:70,17:69,7:60,6:55,5:54,4:40,3:30,2:20,1:10})[code]||50;}
function eosWeatherIcon(code,rain){
 const cloud='<path d="M5 15a4 4 0 0 1 0-8 6 6 0 0 1 11-2 5 5 0 0 1 1 10"/>';
 if([23,25,26].includes(code))return cloud+'<path d="m13 11-4 7h4l-2 5 7-9h-5l2-3"/>';
 if([1,2].includes(code))return '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>';
 if([3,4].includes(code))return cloud+'<path d="M5 15h12"/>';
 if([5,6].includes(code))return '<path d="M3 7h18M1 12h18M5 17h18"/>';
 if(code===24)return cloud+'<circle cx="7" cy="20" r="1"/><circle cx="13" cy="19" r="1"/><circle cx="19" cy="20" r="1"/>';
 if(code===27)return '<path d="M2 7h14c5 0 5-6 1-5M2 12h17c5 0 5 6 1 5M2 17h8c5 0 5 6 1 5"/>';
 if([14,15,16,21,22].includes(code))return cloud+'<path d="M8 17v6m-3-3h6m5-3v6m-3-3h6"/>';
 if((code>=7&&code<=22)||rain>0)return cloud+'<path d="m7 18-1 3m6-3-1 3m6-3-1 3"/>';
 return '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v1"/>';
}
function renderEosWeather(data,summary){
 const host=document.getElementById('eos-weather-trend');
 if(data.available===false){host.replaceChildren();productionSet('eos-weather-status','Weather unavailable for these dates.');return;}
 const byMonth=summary.daily.length>45,weather=new Map(data.days.map(d=>[d.date,d])),groups=new Map();
 for(const day of summary.daily){const key=byMonth?day.label.slice(0,7):day.label;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(weather.get(day.label)||{date:day.label});}
 const present=(rows,key)=>rows.map(r=>r[key]).filter(v=>typeof v==='number'&&Number.isFinite(v));
 const points=[...groups].map(([date,rows])=>{
  const temperatures=present(rows,'max_c'),humidity=present(rows,'humidity_at_max'),rainfall=present(rows,'rain_mm'),codes=rows.filter(r=>eosWeatherLabels[r.condition_code]).sort((a,b)=>eosWeatherPriority(b.condition_code)-eosWeatherPriority(a.condition_code));
  return {date,high:temperatures.length?Math.max(...temperatures):null,rh:humidity.length?humidity.reduce((a,b)=>a+b,0)/humidity.length:null,rain:rainfall.length?rainfall.reduce((a,b)=>a+b,0):null,code:codes[0]?.condition_code,partial:temperatures.length!==rows.length||humidity.length!==rows.length||rainfall.length!==rows.length};
 });
 const x=i=>54+(i+.5)*932/points.length,storm=p=>[23,25,26].includes(p.code),selected=new Set(points.map((p,i)=>storm(p)?i:-1).filter(i=>i>=0));
 const count=Math.min(10,points.length);
 for(let j=0;j<count;j++){const i=count===1?0:Math.round(j*(points.length-1)/(count-1));if(![...selected].some(k=>Math.abs(x(k)-x(i))<45))selected.add(i);}
 const temps=points.filter(p=>p.high!==null).map(p=>p.high),low=temps.length?Math.floor(Math.min(...temps)/5)*5:0,high=temps.length?Math.max(low+5,Math.ceil(Math.max(...temps)/5)*5):40;
 const tempY=v=>79-(v-low)/(high-low)*35,rhY=v=>137-v*.35;
 const show=(v,suffix)=>v===null?'unavailable':productionNumber(v)+suffix;
 let svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 150" role="img" aria-label="Weather estimates aligned with production dates: maximum temperature, humidity, and condition symbols"><title>Fixed Coppabella–Moranbah weather estimates</title>';
 svg+='<path d="M54 44H986M54 79H986M54 102H986M54 137H986" stroke="#e8ede8"/><text x="43" y="47" text-anchor="end">'+high+'°C</text><text x="43" y="82" text-anchor="end">'+low+'°C</text><text x="43" y="105" text-anchor="end">100%</text><text x="43" y="140" text-anchor="end">0%</text>';
 for(const [key,y,colour] of [['high',tempY,'#ae773e'],['rh',rhY,'#5c8798']]){
  let path='',connected=false;points.forEach((p,i)=>{if(p[key]===null){connected=false;return;}path+=(connected?'L':'M')+x(i)+' '+y(p[key])+' ';connected=true;});
  svg+='<path class="eos-weather-line" data-series="'+key+'" d="'+path+'" fill="none" stroke="'+colour+'" stroke-width="2"/>';
  points.forEach((p,i)=>{if(p[key]!==null)svg+='<circle cx="'+x(i)+'" cy="'+y(p[key])+'" r="2.3" fill="'+colour+'"><title>'+esc(p.date+' · '+(key==='high'?'Maximum temperature '+show(p.high,'°C'):'Estimated RH at Tmax '+show(p.rh,'%')))+(p.partial?' · partial data':'')+'</title></circle>';});
 }
 for(const i of [...selected].sort((a,b)=>a-b)){
  const p=points[i],condition=p.code?eosWeatherLabels[p.code]+' (estimated)':p.rain>0?'Rain recorded; storm conditions unavailable':'Conditions unavailable';
  const title=p.date+' · '+condition+' · '+show(p.high,'°C')+' · '+show(p.rh,'% RH at Tmax')+' · '+show(p.rain,' mm rain')+(p.partial?' · partial data':'');
  svg+='<g class="eos-weather-symbol'+(storm(p)?' eos-weather-storm':'')+'" data-date="'+p.date+'" data-condition="'+(p.code||'')+'" transform="translate('+(x(i)-10)+' 9) scale(.83)" fill="none" stroke="'+(storm(p)?'#94632c':'#627c79')+'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><title>'+esc(title)+'</title>'+eosWeatherIcon(p.code,p.rain)+'</g>';
 }
 host.innerHTML=svg+'</svg>';
 const partial=points.some(p=>p.partial),hasConditions=points.some(p=>p.code);
 productionSet('eos-weather-status',(byMonth?'Monthly over recorded dates: peak °C, mean RH. ':'')+(hasConditions?'Symbols show estimated conditions; ⚡ means lightning / thunderstorm estimated, not confirmed strikes.':'Condition / lightning estimates unavailable; rain symbols use recorded rainfall.')+(partial?' Gaps = missing data.':''));
}
