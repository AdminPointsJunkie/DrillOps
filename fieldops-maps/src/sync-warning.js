export function hasUnsyncedChanges(project,{dirty=false,local=false,readOnly=false}={}){
 if(!project||local||readOnly)return false;
 if(dirty||project._unsynced)return true;
 const revision=Number(project.draft_revision),published=Number(project.last_synced_revision);
 return Number.isFinite(revision)&&revision>0&&(!project.last_synced_at||revision!==published);
}
export function updateSyncWarning(element,{pending=false,syncing=false,error=false}={}){
 if(!element)return;
 element.hidden=!pending;
 const message=syncing?'Saved changes are syncing.':error?'Saved changes have not been synced. Sync failed; use SYNC to retry.':'Saved changes have not been synced. Use SYNC to update the published map.';
 element.title=message;element.setAttribute('aria-label',message);
}
