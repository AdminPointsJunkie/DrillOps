import {toolDialog} from './explore-dialogs.js';

export async function openDocumentSigningPermissions({db,project,user,getProject,getUser}){
 const dialog=toolDialog('Operator signing permissions','<p>Allow assigned operators to sign current supporting PDFs. This does not allow them to edit maps or publish releases.</p><div data-signers>Loading assigned operators…</div>');
 dialog.querySelector('[type=submit]').hidden=true;
 dialog.querySelector('.dialog-actions [data-dismiss]').textContent='Close';
 const valid=()=>dialog.isConnected&&getProject()===project&&getUser()?.id===user.id;
 const list=dialog.querySelector('[data-signers]'),error=dialog.querySelector('.error');
 try{
  const response=await db.rpc('maps_document_signers',{p_map:project.id});if(response.error)throw response.error;if(!valid())return;
  list.replaceChildren();
  for(const signer of response.data){
   const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=signer.enabled;
   label.append(input,document.createTextNode(signer.name||'Assigned operator'));list.append(label);
   input.onchange=async()=>{
    if(!valid()){input.checked=signer.enabled;return;}
    input.disabled=true;error.textContent='';
    try{const result=await db.rpc('maps_set_document_signer',{p_map:project.id,p_user:signer.user_id,p_enabled:input.checked});if(result.error)throw result.error;if(valid())signer.enabled=input.checked;}
    catch(e){if(valid()){input.checked=signer.enabled;error.textContent=e.message||'Could not update signing permission.';}}
    finally{if(valid())input.disabled=false;}
   };
  }
  if(!response.data.length)list.textContent='Assign operators to this project in company settings first.';
 }catch(e){if(valid()){list.textContent='';error.textContent=e.message||'Could not load signing permissions.';}}
}
