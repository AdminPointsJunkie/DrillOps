
(async()=>{
  if(loadRecoverySessionFromUrl())return;
  // A saved session is not a request to leave the public homepage.
  const entryParams=new URLSearchParams(window.location.search);
  const requestedSignIn=entryParams.has('signin')||entryParams.has('return_to')||window.location.hash==='#portal-login';
  if(document.body.dataset.publicHome==='true'&&!requestedSignIn){showLogin();return;}
  authSession=loadStoredAuthSession();
  if(!authSession){showLogin();return;}
  showSessionRetry('Restoring your sign-in…');
  await resumePortalSession();
})();

async function resumePortalSession(){
  const retry=document.getElementById('session-retry-button');
  retry.disabled=true;
  try{
    await accessToken();
    if(!await verifyPortalAccount())return;
  }catch(error){
    if(error.sessionExpired||!loadStoredAuthSession())showLogin(error.message||'Please sign in again.');
    else showSessionRetry();
    return;
  }finally{retry.disabled=false;}
  document.getElementById('login-screen').style.display='none';
  document.body.classList.remove('workspace-locked');
  try{
    await initializePortal();
  }catch(error){
    portalInitialized=false;
    console.error('Portal startup error:',error);
    showAppHome();
    toast('Could not finish loading. Refresh to retry.','warn');
  }
}
