(function(root){
  'use strict';
  const money=value=>Math.round((value+Number.EPSILON)*100)/100;
  function defaults(period,firstHoleStart=period.from){
    const start=firstHoleStart&&(!period.from||firstHoleStart>period.from)?firstHoleStart:(firstHoleStart?period.from:'');
    const from=Date.parse(start+'T00:00:00Z');
    const to=Date.parse(period.to+'T00:00:00Z');
    const days=Number.isFinite(from)&&Number.isFinite(to)&&to>=from?Math.round((to-from)/86400000)+1:0;
    return {enabled:false,geologist:1400,vehicle:110,flightRate:600,days,flights:Math.ceil(days/7)};
  }
  function calculate(settings,invoiced){
    for(const field of ['geologist','vehicle','flightRate','days','flights']){
      if(typeof settings[field]!=='number'||!Number.isFinite(settings[field])||settings[field]<0||settings[field]>100000000)
        throw new Error('Enter a valid, non-negative value for '+field+'.');
    }
    if(!Number.isInteger(settings.days)||!Number.isInteger(settings.flights))throw new Error('Days and flights must be whole numbers.');
    const gross=money((settings.geologist+settings.vehicle)*settings.days+settings.flightRate*settings.flights);
    const invoices=money(Math.max(0,Number(invoiced)||0));
    const unbilled=settings.enabled?money(Math.max(0,gross-invoices)):0;
    return {gross,invoices,unbilled,total:money(invoices+unbilled)};
  }
  function storageKey(scope){
    return 'drillops_fortem_estimate_v1_'+JSON.stringify([scope.client,scope.project,scope.program,scope.from,scope.to]);
  }
  root.FortemEstimate={defaults,calculate,storageKey};
})(typeof window==='undefined'?globalThis:window);
