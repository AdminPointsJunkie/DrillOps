(function(){
  const API=window.location.hostname==='localhost'||window.location.hostname==='127.0.0.1'
    ? 'http://localhost:8000' : 'https://api.drillops.com.au';
  const nativeFetch=window.fetch.bind(window);

  function storeReturnTo(){
    const page=window.location.pathname.split('/').pop()||'field.html';
    const allowed=new Set(['field.html','report.html','range-report.html','borehole.html','training.html']);
    const destination=allowed.has(page)?page:'field.html';
    const returnTo='./'+destination+window.location.search;
    sessionStorage.setItem('drillops_return_to',returnTo);
    return returnTo;
  }

  function redirectToLogin(){
    const returnTo=storeReturnTo();
    window.location.replace('./index.html?return_to='+encodeURIComponent(returnTo));
  }

  window.fetch=async function(input,options={}){
    const requestUrl=typeof input==='string'?input:input.url;
    if(new URL(requestUrl,window.location.href).origin!==new URL(API).origin)return nativeFetch(input,options);
    try{return await DrillOpsSession.fetch(input,options);}
    catch(error){if(error.sessionExpired)redirectToLogin();throw error;}
  };
})();
