(function(){
  const API=window.location.hostname==='localhost'||window.location.hostname==='127.0.0.1'
    ? 'http://localhost:8000' : 'https://api.drillops.com.au';
  const storageKey='drillops_supabase_session';
  const nativeFetch=window.fetch.bind(window);
  let session;

  function storeReturnTo(){
    const page=window.location.pathname.split('/').pop()||'field.html';
    const allowed=new Set(['field.html','report.html','range-report.html','borehole.html']);
    const destination=allowed.has(page)?page:'field.html';
    const returnTo='./'+destination+window.location.search;
    sessionStorage.setItem('drillops_return_to',returnTo);
    return returnTo;
  }

  function redirectToLogin(){
    const returnTo=storeReturnTo();
    window.location.replace('./index.html?return_to='+encodeURIComponent(returnTo));
  }

  function config(){
    const value=window.DRILLOPS_CONFIG||{};
    const url=String(value.supabaseUrl||'').replace(/\/$/,'');
    const key=String(value.supabasePublishableKey||'');
    if(!url||!key)throw new Error('DrillOps authentication is not configured.');
    return {url,key};
  }

  function loadSession(){
    if(session!==undefined)return session;
    try{
      const stored=localStorage.getItem(storageKey)||sessionStorage.getItem(storageKey)||'null';
      session=JSON.parse(stored);
      if(session){
        localStorage.setItem(storageKey,JSON.stringify(session));
        sessionStorage.removeItem(storageKey);
      }
    }
    catch(error){session=null;localStorage.removeItem(storageKey);sessionStorage.removeItem(storageKey);}
    return session;
  }

  async function accessToken(){
    const current=loadSession();
    if(!current){
      redirectToLogin();
      throw new Error('Authentication required');
    }
    if(Number(current.expires_at||0)*1000>Date.now()+90000)return current.access_token;
    const auth=config();
    const response=await nativeFetch(auth.url+'/auth/v1/token?grant_type=refresh_token',{
      method:'POST',
      headers:{apikey:auth.key,'Content-Type':'application/json'},
      body:JSON.stringify({refresh_token:current.refresh_token})
    });
    const refreshed=await response.json().catch(()=>({}));
    if(!response.ok){
      localStorage.removeItem(storageKey);
      sessionStorage.removeItem(storageKey);
      redirectToLogin();
      throw new Error('Session expired');
    }
    session=refreshed;
    localStorage.setItem(storageKey,JSON.stringify(refreshed));
    return refreshed.access_token;
  }

  window.fetch=async function(input,options={}){
    const requestUrl=typeof input==='string'?input:input.url;
    const targetOrigin=new URL(requestUrl,window.location.href).origin;
    if(targetOrigin!==new URL(API).origin)return nativeFetch(input,options);
    const token=await accessToken();
    const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));
    headers.set('Authorization','Bearer '+token);
    const response=await nativeFetch(input,{...options,headers});
    if(response.status===401){
      localStorage.removeItem(storageKey);
      sessionStorage.removeItem(storageKey);
      redirectToLogin();
    }
    return response;
  };
})();
