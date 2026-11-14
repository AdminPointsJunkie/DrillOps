import {escapeHTML as esc} from './explore-dialogs.js';

// Account navigation leaves the current map mounted, including unsaved edits.
export function createAccountSettingsPage(user,content){
 const doc=document,win=doc.defaultView,previousFocus=doc.activeElement,previousTitle=doc.title;
 const isAccountRoute=()=>/^#account\/(profile|billing|usage)$/.test(win.location.hash);
 const returnURL=win.location.pathname+win.location.search+(isAccountRoute()?'':win.location.hash);
 const backgrounds=[...doc.querySelectorAll('#app,.project-home')].map(el=>[el,el.hasAttribute('inert')]);
 for(const [el] of backgrounds)el.setAttribute('inert','');
 const page=doc.createElement('section');page.id='account-settings-page';page.className='account-profile';page.setAttribute('aria-label','Account settings');
 page.innerHTML=`<div class="account-page-sidebar"><div class="account-page-brand"><strong>DrillOps</strong><span>FieldMaps</span><small>BUILT FOR THE FIELD</small></div><div class="account-page-nav" data-account-navigation><small>ACCOUNT SETTINGS</small></div><div class="account-page-identity"><strong>${esc(user.user_metadata?.full_name||'Your account')}</strong><span>${esc(user.email||'')}</span></div></div><div class="account-page-main"><div class="account-page-header"><div><span>Account settings</span><h1 data-account-title tabindex="-1">Profile</h1></div><button type="button" data-dismiss>← Back to maps</button></div><div class="account-page-scroll"><div class="account-page-intro"><p data-account-description></p></div><form data-account-content><div data-account-initial>${content}</div><p class="error" role="alert"></p><div class="account-page-actions" data-account-actions><button type="submit" class="primary">Save changes</button></div></form></div></div>`;
 doc.body.classList.add('account-settings-open');doc.body.append(page);
 let navigated=false,closed=false;
 page.setSection=section=>{
  const url=win.location.pathname+win.location.search+'#account/'+section;
  if(!isAccountRoute()){win.history.pushState(win.history.state,'',url);navigated=true;}
  else if(win.location.hash!=='#account/'+section)win.history.replaceState(win.history.state,'',url);
  doc.title='Account settings · '+section[0].toUpperCase()+section.slice(1)+' — DrillOps FieldMaps';
 };
 page.close=({navigate=true,back=false}={})=>{
  if(closed)return;closed=true;page.remove();doc.body.classList.remove('account-settings-open');doc.title=previousTitle;
  for(const [el,inert] of backgrounds)if(!inert)el.removeAttribute('inert');
  page.dispatchEvent(new win.Event('close'));
  if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
  if(navigate&&isAccountRoute()){
   if(back&&navigated)win.history.back();else win.history.replaceState(win.history.state,'',returnURL);
  }
 };
 // Keep map keyboard shortcuts from operating on the map behind this page.
 page.addEventListener('keydown',event=>event.stopPropagation());
 page.querySelector('[data-dismiss]').onclick=()=>page.close({back:true});
 page.querySelector('h1').focus({preventScroll:true});
 return page;
}
