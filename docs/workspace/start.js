
(async()=>{
  if(loadRecoverySessionFromUrl())return;
  authSession=loadStoredAuthSession();
  if(!authSession){showLogin();return;}
  try{
    await accessToken();
    if(!await verifyPortalAccount())return;
  }catch(error){
    saveAuthSession(null);
    showLogin(error.message||'Please sign in again.');
    return;
  }
  document.getElementById('login-screen').style.display='none';
  try{
    await initializePortal();
  }catch(error){
    portalInitialized=false;
    console.error('Portal startup error:',error);
    var gateError=document.getElementById('workspace-gate-error');
    if(gateError)gateError.textContent='DrillOps could not finish loading. Refresh to retry; your sign-in and workspace have been kept.';
    document.getElementById('workspace-gate').classList.add('open');
    document.body.classList.add('workspace-locked');
  }
})();
