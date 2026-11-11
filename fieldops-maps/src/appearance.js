export const themePreference=value=>['system','light','dark'].includes(value)?value:'system';
export const resolvedTheme=(preference,dark)=>themePreference(preference)==='system'?(dark?'dark':'light'):preference;
export function createAppearance({root,storage,media,save=async()=>{}}){
 let user=null,preference='system';const listeners=new Set();
 const key=()=>`fieldmaps:appearance:${user?.id||'guest'}`;
 function paint(){root.dataset.theme=resolvedTheme(preference,media.matches);root.style.colorScheme=root.dataset.theme;for(const listener of listeners)listener(preference);}
 function setUser(next){user=next;let cached;try{cached=storage.getItem(key());}catch{}preference=themePreference(user?.user_metadata?.appearance??cached);paint();}
 media.addEventListener('change',paint);setUser(null);
 return {setUser,get preference(){return preference;},subscribe(fn){listeners.add(fn);fn(preference);return()=>listeners.delete(fn);},async choose(value){const next=themePreference(value),owner=user?.id;await save(next,user);if(owner!==user?.id)return;preference=next;if(user)user.user_metadata={...user.user_metadata,appearance:next};try{storage.setItem(key(),next);}catch{}paint();}};
}
let appearance;
export function configureAppearance(options){appearance=createAppearance(options);return appearance;}
export function installAppearanceSettings(container){
 const label=document.createElement('label');label.className='appearance-setting';label.innerHTML='Appearance<select aria-label="Appearance"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select><small>System follows your device.</small><span role="status"></span>';container.append(label);
 const select=label.querySelector('select'),status=label.querySelector('[role=status]');appearance.subscribe(value=>select.value=value);
 select.onchange=async()=>{const value=select.value;select.disabled=true;status.textContent='Saving…';try{await appearance.choose(value);status.textContent='Saved';}catch(e){select.value=appearance.preference;status.textContent='Could not save appearance. Try again.';}finally{select.disabled=false;}};
}
