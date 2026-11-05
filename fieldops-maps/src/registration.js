const redirect='https://www.drillops.com.au/maps/';
export function installRegistration(db,{doc=document,socialAuth}={}){
 const $=s=>doc.querySelector(s),dialog=$('#auth'),form=$('#auth-form');let working=false;
 const url=new URL(doc.defaultView.location.href);let signinRequested=url.searchParams.get('signin')==='1';
 if(signinRequested){url.searchParams.delete('signin');doc.defaultView.history.replaceState(doc.defaultView.history.state,'',url.href);}
 form.innerHTML=`<div class="dialog-heading"><div><span class="eyebrow">DRILLOPS FIELDMAPS</span><h2 id="auth-title">Welcome back.</h2></div><button type="button" id="auth-close" class="square" aria-label="Close sign in">×</button></div><p id="auth-intro">Sign in to your workspace.</p><section data-social-auth></section><label>Email<input type="email" id="email" required autocomplete="email"></label><label>Password<input type="password" id="password" minlength="8" required autocomplete="current-password"></label><div id="auth-error" role="status" aria-live="polite"></div><div class="dialog-actions"><button id="email-link" type="button" class="secondary">Email sign-in link</button><button id="auth-submit" type="submit" class="primary">Sign in</button></div><p class="registration-switch">Email sign-in is available for existing accounts. Company access requires an invitation.</p>`;
 const message=t=>$('#auth-error').textContent=t;
 async function run(fn){if(working)return;working=true;const buttons=[...form.querySelectorAll('button')].map(b=>[b,b.disabled]);buttons.forEach(([b])=>b.disabled=true);message('');try{await fn();}catch(e){message(e.message||'Please try again.');}finally{working=false;buttons.forEach(([b,disabled])=>b.disabled=disabled);}}
 function open(){message('');socialAuth?.mount($('[data-social-auth]'));if(!dialog.open)dialog.showModal();}
 $('#auth-close').onclick=()=>{if(!working)dialog.close();};dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});
 form.onsubmit=e=>{e.preventDefault();if(!form.reportValidity())return;run(async()=>{const email=$('#email').value.trim(),password=$('#password').value;const result=await db.auth.signInWithPassword({email,password});if(result.error)throw result.error;$('#password').value='';dialog.close();});};
 $('#email-link').onclick=()=>{if(!$('#email').reportValidity())return;run(async()=>{const {error}=await db.auth.signInWithOtp({email:$('#email').value.trim(),options:{emailRedirectTo:redirect,shouldCreateUser:false}});if(error)throw error;message('Check your email for your sign-in link.');});};
 return {open,restoreSession(user){const requested=signinRequested;signinRequested=false;if(user){if(dialog.open)dialog.close();form.reset();message('');}else if(requested)open();},reset(){form.reset();message('');}};
}
