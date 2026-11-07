
(async()=>{
  if(loadRecoverySessionFromUrl())return;
  // A saved session is not a request to leave the public homepage.
  const entryParams=new URLSearchParams(window.location.search);
  const requestedSignIn=entryParams.has('signin')||entryParams.has('return_to')||window.location.hash==='#portal-login';
  if(document.body.dataset.publicHome==='true'&&!requestedSignIn){showLogin();return;}
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
    if(WORKSPACE_APP==='eos'){
      document.getElementById('workspace-gate').classList.remove('open');document.body.classList.remove('workspace-locked');
      showAppHome();
    }else{
      document.getElementById('workspace-gate').classList.add('open');document.body.classList.add('workspace-locked');
    }
  }
})();
