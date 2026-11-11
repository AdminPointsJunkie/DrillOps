import {toolDialog,escapeHTML as esc} from './explore-dialogs.js';
export function invitationURL(id){return `https://www.drillops.com.au/maps/?signin=1&invitation=${encodeURIComponent(id)}`;}
export function showInvitationLink(invitation){
 const url=invitationURL(invitation.id),d=toolDialog('Invitation link',`<p>${esc(invitation.email||'')} · Sign in with the invited email address to accept.</p><label>Invite link<input data-invite-url readonly value="${esc(url)}"></label><button type="button" data-copy-invite>Copy link</button><p data-copy-status role="status"></p>`);
 d.querySelector('[type=submit]').remove();d.querySelector('form').onsubmit=e=>e.preventDefault();
 d.querySelector('[data-copy-invite]').onclick=async()=>{try{await navigator.clipboard.writeText(url);d.querySelector('[data-copy-status]').textContent='Invite link copied.';}catch{d.querySelector('[data-invite-url]').select();d.querySelector('[data-copy-status]').textContent='Select and copy the link above.';}};return d;
}
