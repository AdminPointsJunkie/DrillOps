/* SILO conditions are optional context; production never waits for weather. */
let eosWeatherRequest=0,eosWeatherKey='',eosWeatherSummary=null;
const eosWeatherCache=new Map();
function prepareEosWeather(summary){
 eosWeatherSummary=summary;
 const select=document.getElementById('eos-weather-project'),previous=select.value;
 const names=summary.projects.map(p=>p.label).filter(p=>p!=='Unassigned project');
 select.innerHTML=names.map(name=>'<option value="'+attr(name)+'">'+esc(name)+'</option>').join('');
 if(names.includes(previous))select.value=previous;
 select.disabled=names.length<2;
 loadEosWeather();
}
function clearEosWeather(){
 eosWeatherRequest++;eosWeatherKey='';document.getElementById('eos-weather-cards').replaceChildren();productionSet('eos-weather-status','');productionSet('eos-weather-location','');
}
async function loadEosWeather(retry=false){
 const summary=eosWeatherSummary,project=document.getElementById('eos-weather-project').value,days=summary?.daily||[];
 if(!project||!days.length){clearEosWeather();productionSet('eos-weather-status','Weather needs a saved project location and dated records.');return;}
 const start=days[0].label,end=days.at(-1).label,key=JSON.stringify([activeContractor,project,start,end]);
 const request=++eosWeatherRequest,version=eosScopeVersion;
 if(eosWeatherCache.has(key)&&!retry){eosWeatherKey=key;renderEosWeather(eosWeatherCache.get(key),summary);return;}
 if(key===eosWeatherKey&&!retry){eosWeatherRequest--;return;}
 eosWeatherKey=key;productionSet('eos-weather-location','');document.getElementById('eos-weather-cards').replaceChildren();productionSet('eos-weather-status','Loading historical conditions…');
 try{
  const params=new URLSearchParams({contractor:activeContractor,project,start,end});
  const response=await fetch(API+'/eos/weather?'+params,{cache:'no-store'});
  if(!response.ok)throw Error('Weather unavailable.');
  const data=await response.json();if(!Array.isArray(data.days))throw Error('Weather unavailable.');
  eosWeatherCache.set(key,data);if(eosWeatherCache.size>24)eosWeatherCache.delete(eosWeatherCache.keys().next().value);
  if(request!==eosWeatherRequest||version!==eosScopeVersion)return;
  renderEosWeather(data,eosWeatherSummary);
 }catch(error){if(request!==eosWeatherRequest||version!==eosScopeVersion)return;eosWeatherKey='';productionSet('eos-weather-status','Weather unavailable — production is ready.');}
}
function eosRainIcon(rain){
 const path=rain===null?'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v1"/>':rain>0?'<path d="M6 15a4 4 0 0 1 0-8 6 6 0 0 1 11-2 5 5 0 0 1 0 10M7 18l-1 3m6-3-1 3m6-3-1 3"/>':'<path d="M12 3c-2 4-6 7-6 11a6 6 0 0 0 10 4M16 9c1 2 2 3 2 5M3 21 21 3"/>';
 return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+path+'</svg>';
}
function renderEosWeather(data,summary){
 const host=document.getElementById('eos-weather-cards');
 if(data.available===false){host.replaceChildren();productionSet('eos-weather-status',data.message||'No saved location available.');return;}
 const byMonth=summary.daily.length>45,weather=new Map(data.days.map(d=>[d.date,d])),groups=new Map();
 for(const day of summary.daily){const key=byMonth?day.label.slice(0,7):day.label;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(weather.get(day.label)||{date:day.label});}
 const present=(rows,key)=>rows.map(r=>r[key]).filter(v=>typeof v==='number'&&Number.isFinite(v));
 const show=(v,suffix)=>v===null?'—':Math.round(v)+suffix;
 host.innerHTML=[...groups].map(([date,rows])=>{
  const temperatures=present(rows,'max_c'),humidity=present(rows,'humidity_at_max'),rainfall=present(rows,'rain_mm');
  const high=temperatures.length?Math.max(...temperatures):null,rh=humidity.length?humidity.reduce((a,b)=>a+b,0)/humidity.length:null,rain=rainfall.length?rainfall.reduce((a,b)=>a+b,0):null;
  const incomplete=temperatures.length!==rows.length||humidity.length!==rows.length||rainfall.length!==rows.length;
  const label=byMonth?date:productionDisplayDate(date,true),rainLabel=rain===null?'No data':productionNumber(rain)+' mm';
  const title=label+' · '+(rain===null?'Rainfall unavailable':rain>0?'Rain recorded':'No rain recorded')+' · '+(byMonth?'Maximum temperature and mean RH at Tmax over recorded dates':'Maximum temperature and estimated relative humidity at Tmax')+(incomplete?' · Some values unavailable':'');
  return '<div class="eos-weather-day" title="'+attr(title)+'"><span>'+esc(label)+'</span><div class="eos-weather-icon">'+eosRainIcon(rain)+'</div><strong>'+show(high,'°C')+'</strong><span>'+show(rh,'% RH')+'</span><small>'+rainLabel+(incomplete?' *':'')+'</small></div>';
 }).join('');
 productionSet('eos-weather-status',(byMonth?'Monthly: maximum °C, mean RH at Tmax, rainfall over recorded dates.':'Daily maximum °C · estimated RH at Tmax · rainfall mm.')+' Symbols indicate rain / no rain; * missing values.');
 productionSet('eos-weather-location',Number.isFinite(data.latitude)?Math.abs(data.latitude).toFixed(2)+'°S, '+data.longitude.toFixed(2)+'°E · 5 km grid'+(data.location_project?' · Location from '+data.location_project+' (shared hole)':''):'');
}
