/* StudySpire verified public role titles v3.97.
   Never trust user-set display text for staff status: all roles come from
   ss_profiles via an exact-username, read-only Supabase RPC. */
(()=>{
'use strict';
const valid=name=>/^[a-z0-9_-]{3,32}$/.test(String(name||''));
const staffRoles=new Set(['owner','co_owner','admin','moderator']);
const names={owner:'Owner',co_owner:'Co-Owner',admin:'Admin',moderator:'Moderator'};
const icons={owner:'👑',co_owner:'🔱',admin:'🛡',moderator:'⚑'};
const cache=new Map();
const requests=new Map();
function normalize(name){return String(name||'').replace(/^@/,'').trim().toLowerCase()}
function paint(label,profile){
 if(!label)return; // Labels can be decorated before their row is mounted.
 const role=profile?.role;
 let badge=label.querySelector(':scope > .ss-verified-role');
 if(!staffRoles.has(role)){badge?.remove()}
 if(staffRoles.has(role)){
  if(!badge){badge=document.createElement('span');badge.className='ss-verified-role';label.append(badge)}
  badge.className='ss-verified-role role-'+role;
  badge.textContent=icons[role]+' '+names[role];
  badge.title='Verified StudySpire '+names[role]+' account';
  badge.setAttribute('aria-label',badge.title);
 }
 const title=profile?.staff_title;
 let founder=label.querySelector(':scope > .ss-founder-title');
 if(title!=='founder'&&title!=='co-founder'){founder?.remove();return}
 if(!founder){founder=document.createElement('span');founder.className='ss-verified-role ss-founder-title';label.append(founder)}
 founder.textContent=title==='founder'?'✦ Founder':'✧ Co-Founder';
 founder.title='Verified StudySpire '+(title==='founder'?'Founder':'Co-Founder');
 founder.setAttribute('aria-label',founder.title);
}
async function lookup(username){
 const name=normalize(username);
 if(!valid(name))return null;
 if(cache.has(name))return cache.get(name);
 if(requests.has(name))return requests.get(name);
 const bridge=window.StudySpirePublicProfileBridge;
 if(!bridge?.ready?.()||typeof bridge.rpc!=='function')return null;
 const request=bridge.rpc('ss_public_profile',{chosen_username:name})
   .then(data=>{cache.set(name,data||null);return data||null})
   .catch(err=>{console.warn('Verified account role unavailable:',err.message);return null})
   .finally(()=>requests.delete(name));
 requests.set(name,request);return request;
}
function decorateLabel(element,username,roleHint){
 const name=normalize(username);
 if(!element||!valid(name))return;
 // Hints are ONLY valid for our own Cloud session, itself verified by Supabase.
 const self=window.StudySpireAvatarBridge?.state?.();
 if(self?.username===name&&roleHint===self.role&&staffRoles.has(roleHint)){
   paint(element,{username:name,role:roleHint});
   void lookup(name).then(profile=>{if(element.isConnected&&profile)paint(element,profile)});
   return;
 }
 if(cache.has(name)){paint(element,cache.get(name));return}
 void lookup(name).then(profile=>{if(element.isConnected)paint(element,profile)});
}
function refreshLabels(){
 cache.clear();requests.clear();
 const self=window.StudySpireAvatarBridge?.state?.();
 const top=document.getElementById('sdTopAccountLabel');
 if(self&&top)decorateLabel(top,self.username,self.role);
}
window.StudySpireRoles={decorateLabel,lookup,refreshLabels,
 roleName:role=>names[role]||'',isStaffRole:role=>staffRoles.has(role)};
window.addEventListener('ss-cloud-auth-changed',refreshLabels);
window.addEventListener('ss-public-profiles-ready',refreshLabels);
})();
