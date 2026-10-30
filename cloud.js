/* StudySpire Cloud bridge v3.77. Requires cloud-config.js, Supabase JS v2, supabase.sql, and username-login-migration.sql for no-email accounts.
   No service_role keys; authorization for roles/bans is always checked by SQL on the server. */
(()=>{'use strict';
const cfg=window.STUDY_SUMMIT_CLOUD||{};
const ready=/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(String(cfg.url||'').trim())&&String(cfg.publishableKey||'').trim().length>=20;
const $=id=>document.getElementById(id);
const STORE=['studydock-suite-v1','ss-study-lab-v374','studydock-simple-v1','studydock-mini-notes-v1','studysync-mini-notes-v1','study-summit-personalization-v1','sd-mini-notes-v1','studydock-mini-v1','studydock-ai-v1'];
let client=null,person=null,profile=null,remote=null,cloudId='',syncTimer=0,syncing=false,live=false,lastSnapshot='',role='student';
let lastSyncAt=0,lastSyncError='';
const RECENT_USERNAMES='ss-cloud-account-chooser-v1';
function savedUsernames(){
 try{
  const names=JSON.parse(localStorage.getItem(RECENT_USERNAMES)||'[]');
  return Array.isArray(names)?[...new Set(names.filter(v=>typeof v==='string'&&/^[a-z0-9_-]{3,32}$/.test(v)))].slice(0,8):[];
 }catch(_){return []}
}
function rememberUsername(username){
 const name=String(username||'').toLowerCase();
 if(!/^[a-z0-9_-]{3,32}$/.test(name))return;
 try{localStorage.setItem(RECENT_USERNAMES,JSON.stringify([name,...savedUsernames().filter(v=>v!==name)].slice(0,8)))}catch(_){}
}
function forgetUsername(username){
 forgetDeviceToken(username);
 try{localStorage.setItem(RECENT_USERNAMES,JSON.stringify(savedUsernames().filter(v=>v!==username)))}catch(_){}
}
const REMEMBERED_TOKENS='ss-cloud-remembered-device-v1';
function deviceTokens(){
 try{
  const saved=JSON.parse(localStorage.getItem(REMEMBERED_TOKENS)||'{}');
  if(!saved||typeof saved!=='object'||Array.isArray(saved))return {};
  return Object.fromEntries(Object.entries(saved).filter(([n,t])=>/^[a-z0-9_-]{3,32}$/.test(n)&&typeof t==='string'&&/^[0-9a-f]{64}$/.test(t)).slice(0,8));
 }catch(_){return {}}
}
const deviceToken=name=>deviceTokens()[name]||'';
function storeDeviceToken(name,token){
 if(!/^[a-z0-9_-]{3,32}$/.test(name)||!/^[0-9a-f]{64}$/.test(token))return;
 try{localStorage.setItem(REMEMBERED_TOKENS,JSON.stringify({[name]:token,...Object.fromEntries(Object.entries(deviceTokens()).filter(([n])=>n!==name).slice(0,7))}))}catch(_){}
}
function forgetDeviceToken(name){
 const tokens=deviceTokens();delete tokens[name];
 try{localStorage.setItem(REMEMBERED_TOKENS,JSON.stringify(tokens))}catch(_){}
}
async function rememberCurrentDevice(name){
 if(!client||!/^[a-z0-9_-]{3,32}$/.test(name))return;
 try{
  const {data,error}=await client.rpc('ss_remember_current_username');
  if(error)throw error;
  if(typeof data==='string'&&/^[0-9a-f]{64}$/.test(data)){
   const previous=deviceToken(name);
   storeDeviceToken(name,data);rememberUsername(name);
   if(previous&&previous!==data)client.rpc('ss_forget_remembered_username',{device_token:previous}).then(()=>{});
  }
 }catch(error){console.warn('Remembered sign-in unavailable:',error?.message||error)}
}
window.StudySummitCloudHealth=()=>({configured:ready,signedIn:!!person,username:profile?.username||'',role,active:!!live,syncing:!!syncing,lastSyncAt,syncError:lastSyncError});

const escapeHTML=str=>String(str??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prefix=()=>`sd-account-${cloudId}::`;
const localKey=k=>prefix()+k;
const banned=p=>Boolean(p?.banned&&(!p.banned_until||new Date(p.banned_until).getTime()>Date.now()));
const cloudNotice=msg=>{const el=$('ssCloudNotice');if(el)el.textContent=msg};
const download=(name,data)=>{const href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=href;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(href),2000)};
function studyItems(){const o={};for(const k of STORE){const val=localStorage.getItem(localKey(k));if(val!==null)o[k]=val}
  // Only per-account study data; never auth tokens, account hashes, moderation, bans or roles.
  const pref=prefix();for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(!k?.startsWith(pref))continue;const name=k.slice(pref.length);
    if(!/^(?:studydock|studysync|study-summit|ss-)/.test(name)||!/(?:chat|doc|flash|note|card|agenda|learning|skill|task|progress|study|personalization)/i.test(name)||/(?:auth|password|credential|token|admin|ban|moderat|role|account)/i.test(name))continue;
    o[name]=localStorage.getItem(k)
  }return o;}
function setStudy(items){syncing=true;try{if(!items||typeof items!=='object'||Array.isArray(items))return;
    for(const [k,v] of Object.entries(items)){if(typeof v!=='string'||v.length>1000000)continue;
      if(STORE.includes(k)||(/^(?:studydock|studysync|study-summit|ss-)/.test(k)&&/(?:chat|doc|flash|note|card|agenda|learning|skill|task|progress|study|personalization)/i.test(k)&&!/(?:auth|password|credential|token|admin|ban|moderat|role|account)/i.test(k)))
        localStorage.setItem(localKey(k),v);
    }
  }finally{syncing=false}}
/* Username + password is the only interactive sign-in option. Existing sessions remain compatible. */
let authMethod='username',sessionMethod='email',switchingRemembered=false;
function showGate(kind='login'){
 let gate=$('ssCloudGate');if(!gate){gate=document.createElement('section');gate.id='ssCloudGate';document.body.append(gate)}
 gate.hidden=false;gate.innerHTML=`<div class="ssc-shell"><div class="ssc-mark">✦</div><div class="ssc-title-row"><div class="ssc-heading">StudySpire <span>Cloud</span></div><button id="ssc-close" type="button" class="ssc-light" hidden aria-label="Close account menu">✕ Close</button></div>
 <p id="ssCloudNotice" class="ssc-muted" role="status" aria-live="polite">Your study space, on any device.</p>
 <div id="ssc-loginArea">
  <div id="ssc-recent" hidden><b class="ssc-recent-label">Accounts used on this browser</b><div id="ssc-recentList" class="ssc-recentList"></div><p class="ssc-caption">Tap a remembered account to switch instantly. If its password changed, enter the new one once.</p></div><div id="ssc-userRow"><label for="ssc-user">Username</label><input id="ssc-user" autocomplete="username" placeholder="Your username" maxlength="32" spellcheck="false" autocapitalize="none"/></div>
  <label for="ssc-pass">Password</label><input id="ssc-pass" type="password" autocomplete="current-password" placeholder="At least 10 characters for new accounts" minlength="8"/><button id="ssc-showpass" type="button" class="ssc-light ssc-password-toggle" aria-pressed="false" aria-controls="ssc-pass">Show password</button>
  <div class="ssc-row"><button id="ssc-login" type="button">Sign in</button><button id="ssc-register" type="button" class="ssc-light">Create account</button></div><button id="ssc-forgot" class="ssc-light ssc-forgot" type="button">Forgot password? Owner-assisted reset</button><div id="ssc-recovery" hidden><p class="ssc-caption">A verified account holder can request a one-time code from an Owner. Your replacement password is only entered here.</p><label for="ssc-resetUser">Username</label><input id="ssc-resetUser" autocomplete="username" maxlength="32" placeholder="Username"/><button id="ssc-requestReset" class="ssc-light" type="button">Request reset</button><label for="ssc-resetCode">Recovery code</label><input id="ssc-resetCode" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="6-digit code"/><label for="ssc-newPassword">New password</label><input id="ssc-newPassword" autocomplete="new-password" type="password" placeholder="At least 10 characters"/><div class="ssc-row"><button id="ssc-completeReset" type="button">Set new password</button><button id="ssc-cancelReset" class="ssc-light" type="button">Back to sign in</button></div></div>
  <p id="ssc-recoveryInfo" class="ssc-caption">No email needed. If you forget your password, request an Owner-approved six-digit recovery code.</p>
 </div>
 <div id="ssc-bannedArea" hidden><h1 class="ssc-banned">YOU ARE BANNED</h1><p id="ssc-banReason" class="ssc-muted"></p>
 <div class="ssc-row"><button id="ssc-flash" type="button">Export flashcards</button><button id="ssc-chats" type="button" class="ssc-light">Export saved chats</button></div>
 <div class="ssc-row"><button id="ssc-all" type="button" class="ssc-light">Export all study data</button><button id="ssc-check" type="button" class="ssc-light">Check ban status</button></div>
 <p class="ssc-caption">Downloads are available for the account owner. A ban doesn't delete your notes.</p></div>
 <div id="ssc-current-actions" hidden>
  <p class="ssc-caption">Signed in as @${escapeHTML(profile?.username||'account')}. Tap a remembered account to switch instantly; your study data stays separate.</p>
  <div class="ssc-row"><button id="ssc-switch-account" class="ssc-light" type="button">⇄ Switch account</button><button id="ssc-new-account" class="ssc-light" type="button">＋ Add account</button></div>
   <div id="ssc-switchList" class="ssc-switchList" hidden><b class="ssc-recent-label">Accounts remembered on this browser</b><div id="ssc-switchNames" class="ssc-recentList"></div><p class="ssc-caption">Anyone with access to this browser can open a remembered account. Use × to remove saved access.</p><button id="ssc-other-account" class="ssc-light" type="button">Use another username</button></div>
   <button id="ssc-save-current" class="ssc-light ssc-save-current" type="button">✓ Remember this account on this device</button>
  <details id="ssc-passwordSettings" class="ssc-change-pass" ${sessionMethod==='username'?'':'hidden'}><summary>🔒 Change my password</summary>
   <label for="ssc-oldPass">Current password</label><input id="ssc-oldPass" type="password" autocomplete="current-password" placeholder="Current password"/>
   <label for="ssc-nextPass">New password</label><input id="ssc-nextPass" type="password" autocomplete="new-password" placeholder="At least 10 characters"/>
   <label for="ssc-nextPassAgain">Confirm new password</label><input id="ssc-nextPassAgain" type="password" autocomplete="new-password" placeholder="Repeat password"/>
   <button id="ssc-changePassword" type="button" class="ssc-light">Save new password</button><p class="ssc-caption">Other devices must sign in again after changing this password.</p>
  </details>
  <details id="ssc-deleteSettings" class="ssc-change-pass ssc-danger-zone"><summary>Delete my account permanently</summary>
   <p class="ssc-caption">This deletes your Cloud account, conversations, saved study data and profile picture. Export anything you need first. This cannot be undone.</p>
   <label for="ssc-deleteUsername">Confirm your username</label><input id="ssc-deleteUsername" autocomplete="off" spellcheck="false" placeholder="Exact StudySpire username"/>
   <label for="ssc-deletePassword">Current password</label><input id="ssc-deletePassword" type="password" autocomplete="current-password" placeholder="Current account password"/>
   <label for="ssc-deletePhrase">Type DELETE to confirm</label><input id="ssc-deletePhrase" autocomplete="off" spellcheck="false" placeholder="DELETE"/>
   <button id="ssc-deleteAccount" type="button" class="ssc-light">Permanently delete my account</button>
  </details></div><div class="ssc-row"><button id="ssCloudAvatarEdit" class="ssc-light" type="button">🖼 Profile &amp; bio</button><button id="ssc-logout" class="ssc-light" type="button">Sign out</button></div></div>`;
 $('ssCloudAvatarEdit').onclick=()=>{gate.hidden=true;window.StudySpireAvatars?.openOwn();};
 async function confirmAccountDeletion(){
   if(!person||!profile)return cloudNotice('Sign into your Cloud account first.');
   const username=$('ssc-deleteUsername')?.value.trim().toLowerCase();
   const password=$('ssc-deletePassword')?.value||'';
   const phrase=$('ssc-deletePhrase')?.value.trim();
   if(username!==profile.username||!password||phrase!=='DELETE'){
     cloudNotice('Enter your exact username, current password, and DELETE to confirm.');
     return;
   }
   if(!confirm('Permanently delete @'+profile.username+' and all its Cloud data? This cannot be reversed.'))return;
   const button=$('ssc-deleteAccount');if(button)button.disabled=true;
   try{
     const {error}=await client.rpc('ss_delete_my_account',{confirmed_username:username,confirmed_password:password});
     if(error)throw Error(error.message);
     live=false;clearTimeout(syncTimer);forgetUsername(username);
     const prefixForDeleted='sd-account-'+cloudId+'::';
     for(let i=localStorage.length-1;i>=0;i--){
       const key=localStorage.key(i);
       if(key?.startsWith(prefixForDeleted))localStorage.removeItem(key);
     }
     try{await client.auth.signOut({scope:'local'})}catch(_){}
     person=null;profile=null;cloudId='';
     sessionStorage.removeItem('studydoc-active-account');
     sessionStorage.removeItem('ssCloudApplied');
     sessionStorage.removeItem('ss-cloud-display-name');
     location.reload();
   }catch(error){cloudNotice('Account deletion failed: '+error.message)}
   finally{
     if($('ssc-deletePassword'))$('ssc-deletePassword').value='';
     if(button)button.disabled=false;
   }
 }
 $('ssc-deleteAccount').onclick=confirmAccountDeletion;

 const setMethod=()=>{authMethod='username';$('ssc-recoveryInfo').textContent='No email needed. Ask an Owner for a six-digit password recovery code if you forget your password.';$('ssc-pass').value='';$('ssc-pass').type='password';$('ssc-showpass').textContent='Show password';$('ssc-showpass').setAttribute('aria-pressed','false');renderRecentAccounts();};
  async function chooseSavedAccount(name){
    if(switchingRemembered)return;
    const token=deviceToken(name);
    if(!token)return requirePasswordFor(name,'Enter your password once to remember @'+name+' on this device.');
    switchingRemembered=true;
    cloudNotice('Switching to @'+name+'…');
    try{
      // Finish any pending outgoing upload before changing the server-side identity.
      if(person&&live&&!banned(profile))await uploadSnapshot();
      await lastUpload;
      await ensureAnonymous();
      const {data,error}=await client.rpc('ss_remembered_switch',{chosen_username:name,device_token:token});
      if(error)throw error;
      if(data!==true){
        forgetDeviceToken(name);
        return requirePasswordFor(name,'The saved sign-in for @'+name+' is no longer valid. Enter the current password once.');
      }
      clearTimeout(syncTimer);live=false;remote=null;lastSnapshot='';
      sessionStorage.removeItem('ssCloudApplied');
      sessionStorage.removeItem('studydoc-active-account');
      location.reload();
    }catch(error){cloudNotice('Could not switch accounts: '+(error?.message||error))}
    finally{switchingRemembered=false}
  }
  function requirePasswordFor(name,message){
    if(person){
      sessionStorage.setItem('ss-cloud-switch-username',name);
      sessionStorage.setItem('ss-cloud-next-action','switch');
      cloudNotice(message);
      return signOutCloud();
    }
    $('ssc-user').value=name;$('ssc-pass').value='';$('ssc-pass').focus();
    cloudNotice(message);
  }
  function renderSavedIn(list,names){
    list.replaceChildren();
    for(const name of names){
     const wrap=document.createElement('span');wrap.className='ssc-recentItem';
     const choose=document.createElement('button');choose.type='button';choose.className='ssc-light';
     const active=Boolean(person&&profile?.username===name);
     choose.textContent='@'+name+(active?' · Current':deviceToken(name)?' · Tap to switch':' · Password needed');
     choose.disabled=active;choose.onclick=()=>chooseSavedAccount(name);
     const remove=document.createElement('button');remove.type='button';remove.className='ssc-light';remove.textContent='×';
     remove.title='Forget @'+name+' on this device';remove.setAttribute('aria-label',remove.title);
     remove.onclick=async()=>{
       const token=deviceToken(name);
       forgetDeviceToken(name);forgetUsername(name);renderRecentAccounts();
       if(token&&client){try{const {data:sessionData}=await client.auth.getSession();if(!sessionData?.session)await ensureAnonymous();else if(!sessionData.session.user?.is_anonymous)return;await client.rpc('ss_forget_remembered_username',{device_token:token})}catch(_){}}
     };
     wrap.append(choose,remove);list.append(wrap);
    }
  }
 function renderRecentAccounts(){
   const host=$('ssc-recent'),list=$('ssc-recentList');
   const names=savedUsernames();
   if(host&&list){host.hidden=!names.length;renderSavedIn(list,names)}
   const switchList=$('ssc-switchList'),switchNames=$('ssc-switchNames');
   if(switchList&&switchNames){renderSavedIn(switchNames,names);if(!names.length&&$('ssc-other-account'))$('ssc-other-account').textContent='Sign in to another account'}
 }
 $('ssc-showpass').onclick=()=>{const password=$('ssc-pass');const reveal=password.type==='password';password.type=reveal?'text':'password';$('ssc-showpass').textContent=reveal?'Hide password':'Show password';$('ssc-showpass').setAttribute('aria-pressed',String(reveal));};
 $('ssc-close').onclick=()=>{if(person&&!banned(profile))gate.hidden=true;};
 gate.onkeydown=e=>{if(e.key==='Escape'&&person&&!banned(profile))gate.hidden=true;};
 $('ssc-register').onclick=async()=>{
   const password=$('ssc-pass').value;
   const chosen_username=$('ssc-user').value.trim().toLowerCase();
   if(!/^[a-z0-9_-]{3,32}$/.test(chosen_username)||/^(owner|moderator|support|staff|official)$/.test(chosen_username))return cloudNotice('Choose a username using 3–32 letters, numbers, _ or -.');
   if(password.length<10||new TextEncoder().encode(password).length>72)return cloudNotice('Use a password of at least 10 characters and no more than 72 bytes.');
   const createButton=$('ssc-register');createButton.disabled=true;cloudNotice('Creating your username account…');
   let phase='starting a secure session';
   try{
     await ensureAnonymous();phase='creating your username account';
     const {error}=await client.rpc('ss_username_register',{chosen_username,chosen_password:password});
     if(error)throw Error(error.message);
     await rememberCurrentDevice(chosen_username);cloudNotice('Account created. Loading StudySpire…');await boot();
   }catch(err){
     const message=String(err?.message||err);
     cloudNotice('Could not create account ('+phase+'): '+message);
     if(/sign out before creating another account|session has an account/i.test(message))cloudNotice('This browser already has an account. Sign out before creating another.');
   }finally{createButton.disabled=false}
 };
 $('ssc-forgot').onclick=()=>{const panel=$('ssc-recovery');panel.hidden=!panel.hidden;if(!panel.hidden){$('ssc-resetUser').value=$('ssc-user').value.trim().toLowerCase();$('ssc-resetUser').focus()}};
 $('ssc-cancelReset').onclick=()=>{$('ssc-recovery').hidden=true;$('ssc-newPassword').value='';$('ssc-resetCode').value=''};
 $('ssc-requestReset').onclick=async()=>{const btn=$('ssc-requestReset');btn.disabled=true;try{await ensureAnonymous();const {error}=await client.rpc('ss_request_password_reset',{chosen_username:$('ssc-resetUser').value.trim().toLowerCase()});if(error)throw error;cloudNotice('If the username exists, the request was submitted. Contact an Owner for identity verification and a recovery code.')}catch(e){cloudNotice('Reset request failed: '+(e.message||e))}finally{btn.disabled=false}};
 $('ssc-completeReset').onclick=async()=>{const username=$('ssc-resetUser').value.trim().toLowerCase(),code=$('ssc-resetCode').value.trim(),password=$('ssc-newPassword').value;
  if(!/^[a-z0-9_-]{3,32}$/.test(username)||!/^[0-9]{6}$/.test(code))return cloudNotice('Enter a valid username and 6-digit recovery code.');
  if(password.length<10||new TextEncoder().encode(password).length>72)return cloudNotice('Password must be 10 characters minimum, 72 bytes maximum.');
  const btn=$('ssc-completeReset');btn.disabled=true;try{await ensureAnonymous();const {data,error}=await client.rpc('ss_complete_password_reset',{chosen_username:username,recovery_code:code,new_password:password});if(error)throw error;
   if(data!==true)return cloudNotice('Invalid, expired or used recovery code.');
   forgetDeviceToken(username);$('ssc-newPassword').value='';$('ssc-resetCode').value='';$('ssc-recovery').hidden=true;$('ssc-user').value=username;renderRecentAccounts();cloudNotice('Password updated. Sign in with your new password.');
  }catch(e){cloudNotice('Reset failed: '+(e.message||e))}finally{btn.disabled=false}};
 $('ssc-login').onclick=async()=>{
   const password=$('ssc-pass').value,chosen_username=$('ssc-user').value.trim().toLowerCase();
   if(!chosen_username||!password)return cloudNotice('Enter your username and password.');
   cloudNotice('Signing in…');
   let phase='starting a secure session';
   try{
     await ensureAnonymous();phase='checking your credentials';
     const {data,error}=await client.rpc('ss_username_login',{chosen_username,chosen_password:password});
     if(error)throw Error(error.message);
     if(data!==true){cloudNotice('Incorrect username or password, or account temporarily locked.');return}
     await rememberCurrentDevice(chosen_username);cloudNotice('Signed in. Loading StudySpire…');await boot();
   }catch(err){cloudNotice('Could not sign in ('+phase+'): '+(err.message||err))}
 };
 $('ssc-pass').onkeydown=e=>{if(e.key==='Enter')$('ssc-login').click()};
 $('ssc-logout').onclick=signOutCloud;
 async function switchCloudAccount(next){
   if(!person||signingOut)return;
   if(next==='switch'){
     const list=$('ssc-switchList');if(list){list.hidden=!list.hidden;renderRecentAccounts();}
     cloudNotice('Choose a remembered account. If a password changed, you’ll enter the new one once.');return;
   }
   if(!confirm('Sign out of @'+(profile?.username||'your account')+' and add an account? Your study data remains saved.'))return;
   sessionStorage.setItem('ss-cloud-next-action',next);await signOutCloud();
 }
 $('ssc-other-account').onclick=()=>{sessionStorage.setItem('ss-cloud-next-action','switch');signOutCloud()};
 $('ssc-save-current').onclick=async()=>{if(!person||sessionMethod!=='username')return;const btn=$('ssc-save-current');btn.disabled=true;await rememberCurrentDevice(profile.username);renderRecentAccounts();cloudNotice(deviceToken(profile.username)?'@'+profile.username+' is remembered on this browser.':'Could not remember this account. Try again.');btn.disabled=false;};
 $('ssc-new-account').onclick=()=>switchCloudAccount('register');
 $('ssc-switch-account').onclick=()=>switchCloudAccount('switch');
 $('ssc-changePassword').onclick=async()=>{
   if(!person||sessionMethod!=='username'||!live)return cloudNotice('Sign in with your username to change its password.');
   const old=$('ssc-oldPass').value,next=$('ssc-nextPass').value,again=$('ssc-nextPassAgain').value;
   if(!old)return cloudNotice('Enter your current password.');
   if(next!==again)return cloudNotice('New passwords do not match.');
   if(next===old)return cloudNotice('Use a different password.');
   if(next.length<10||new TextEncoder().encode(next).length>72)return cloudNotice('New passwords must have at least 10 characters and at most 72 bytes.');
   const button=$('ssc-changePassword');button.disabled=true;
   try{
    const {data,error}=await client.rpc('ss_username_change_password',{current_password:old,new_password:next});
    if(error)throw error;
    if(data!==true)return cloudNotice('Incorrect current password or account temporarily locked.');
    $('ssc-oldPass').value='';$('ssc-nextPass').value='';$('ssc-nextPassAgain').value='';
    forgetDeviceToken(profile.username);await rememberCurrentDevice(profile.username);renderRecentAccounts();
    cloudNotice('Password changed successfully. Other devices must sign in again.');
   }catch(e){cloudNotice('Could not change password: '+(e?.message||e))}
   finally{button.disabled=false}
 };
 $('ssc-check').onclick=async()=>{const ok=await refreshProfile();if(ok&&!banned(profile))location.reload();else cloudNotice('This ban is still active. Your data export options are available below.')};
 $('ssc-flash').onclick=()=>exportMine('flash');$('ssc-chats').onclick=()=>exportMine('chats');$('ssc-all').onclick=()=>exportMine('all');
 setMethod();
 $('ssc-current-actions').hidden=!(person&&kind==='account'&&!banned(profile));
 $('ssc-logout').parentElement.hidden=!(person&&kind!=='loading');
 if(kind==='loading'){$('ssc-loginArea').hidden=true;cloudNotice('Checking your account and syncing study data…')}
 if(kind==='login'&&!person){
  const next=sessionStorage.getItem('ss-cloud-next-action');
  if(next==='register'||next==='switch'){
    sessionStorage.removeItem('ss-cloud-next-action');
    cloudNotice(next==='register'?'Add an account: choose a fresh username and password.':'Select a remembered account or enter the password for another username.');
    if(next==='register')$('ssc-user')?.focus();
  }
 }
 if(kind==='login'&&!person){const pending=sessionStorage.getItem('ss-cloud-switch-username');if(pending){sessionStorage.removeItem('ss-cloud-switch-username');$('ssc-user').value=pending;cloudNotice('Enter the current password for @'+pending+' once to remember it again.')}}
 $('ssc-close').hidden=!(person&&kind==='account'&&!banned(profile));
 if(kind==='banned')showBanned();
 return gate;
}
async function ensureAnonymous(){
 // A missing Supabase session is the NORMAL state for a first-time signup.
 // Only a real session can be reused; otherwise create an anonymous one.
 const isMissing=e=>e?.name==='AuthSessionMissingError'||/auth session missing/i.test(String(e?.message||e||''));
 let session=null;
 try{
   const {data,error}=await client.auth.getSession();
   if(error && !isMissing(error))throw Error('Checking session: '+error.message);
   session=data?.session||null;
 }catch(e){if(!isMissing(e))throw e;}
 if(session?.user?.is_anonymous)return;
 if(session){
   const {error:logoutErr}=await client.auth.signOut({scope:'local'});
   if(logoutErr&&!isMissing(logoutErr))throw Error('Switching accounts: '+logoutErr.message);
 }
 let response;
 try{response=await client.auth.signInAnonymously();}
 catch(e){throw Error('Starting anonymous sign-in: '+(e?.message||e));}
 if(response?.error)throw Error('Starting anonymous sign-in: '+response.error.message);
 if(!response?.data?.session)throw Error('Anonymous sign-in returned no session. Check Supabase Authentication → Anonymous Sign-Ins.');
}
let signingOut=false;
async function signOutCloud(){
 if(signingOut||!client)return;
 signingOut=true;
 const logoutButtons=[$('ssc-logout'),$('sdAccountLogout')].filter(Boolean);
 for(const button of logoutButtons){button.disabled=true;button.textContent='Signing out…'}
 cloudNotice('Signing out of StudySpire…');
 try{
  // A PostgREST rpc() builder is Promise-like, not a Promise with .catch().
  // Session-map cleanup must not block the actual auth sign-out.
  if(sessionMethod==='username'){
   try{
    const {error}=await client.rpc('ss_username_logout');
    if(error)console.warn('Username session cleanup:',error.message);
   }catch(error){console.warn('Username session cleanup:',error)}
  }
  const {error}=await client.auth.signOut({scope:'local'});
  if(error)throw error;
  clearTimeout(syncTimer);
  live=false;person=null;profile=null;cloudId='';remote=null;
  window.dispatchEvent(new Event('ss-cloud-auth-changed'));
  sessionStorage.removeItem('ss-cloud-display-name');
  sessionStorage.removeItem('studydoc-active-account');
  sessionStorage.removeItem('ssCloudApplied');
  const staff=$('ssCloudStaffDialog');if(staff)staff.hidden=true;
  location.reload();
 }catch(error){
  sessionStorage.removeItem('ss-cloud-next-action');cloudNotice('Could not sign out: '+(error?.message||error)+'. Please retry.');
  console.error('StudySpire cloud sign-out failed:',error);
 }finally{
  signingOut=false;
  for(const button of logoutButtons){button.disabled=false;button.textContent='Sign out'}
 }
}
function showBanned(){const gate=$('ssCloudGate')||showGate();gate.hidden=false;if($('ssc-close'))$('ssc-close').hidden=true;$('ssc-loginArea').hidden=true;$('ssc-bannedArea').hidden=false;$('ssc-logout').parentElement.hidden=false;
 const until=profile.banned_until?'until '+new Date(profile.banned_until).toLocaleString():'permanently';
 const expiry=(!profile.banned_until&&profile.perma_banned_at)
   ?new Date(Date.parse(profile.perma_banned_at)+30*24*60*60*1000):null;
 const deletionNotice=expiry&&Number.isFinite(expiry.getTime())
   ?' This account becomes eligible for automatic deletion after '+expiry.toLocaleDateString()+', with daily processing, unless the ban is lifted.'
   :'';
 // Banned users may still confirm early self-deletion after exporting their work.
 const deletion=$('ssc-deleteSettings'),bannedArea=$('ssc-bannedArea');
 if(deletion&&bannedArea&&!bannedArea.contains(deletion))bannedArea.append(deletion);
 $('ssc-banReason').textContent='Account @'+profile.username+' banned '+until+'. Reason: '+(profile.ban_reason||'Admin decision')+'.'+deletionNotice;
 const note=gate.querySelector('#ssc-bannedArea .ssc-caption');
 if(note)note.textContent=expiry?'Export important study data before the 30-day deadline. Deletion is permanent.':'Your study exports remain available while this temporary ban lasts.';
 cloudNotice('Your account is banned. Review the ban notice and export options.');}
function exportMine(kind){const items=remote?.data||studyItems();const result={kind:'study-summit-cloud-export',account:profile?.username,exportedAt:new Date().toISOString(),data:{}};
 for(const [k,v] of Object.entries(items)){if(typeof v!=='string')continue;if(kind==='flash'&&!/(?:suite|card|flash|lab)/i.test(k))continue;if(kind==='chats'&&!/(?:chat|tutor|mini|suite|notes)/i.test(k))continue;
 try{const obj=JSON.parse(v);if(kind==='flash'&&k==='studydock-suite-v1')result.data[k]={cards:obj.cards||[]};else if(kind==='chats'&&k==='studydock-suite-v1')result.data[k]={chats:obj.chats||[]};else result.data[k]=obj}catch{result.data[k]=v}}
 download('study-summit-'+kind+'-'+Date.now()+'.json',result)}
async function refreshProfile(){if(!person)return false;const {data,error}=await client.from('ss_profiles').select('id,username,role,banned,banned_until,ban_reason,perma_banned_at').eq('id',person.id).single();
 if(error){cloudNotice('Account status unavailable: '+error.message);return false}profile=data;role=profile.role||'student';
 try{sessionStorage.setItem('ss-cloud-display-name',profile.username)}catch(_){}rememberUsername(profile.username);if(banned(profile)){live=false;showBanned();window.dispatchEvent(new Event('ss-cloud-auth-changed'))}else{const gate=$('ssCloudGate');if(gate&&!gate.hidden&&$('ssc-bannedArea')&&!$('ssc-bannedArea').hidden){gate.hidden=true;}updateHeader()}return true}
async function getRemote(){const {data,error}=await client.from('ss_study_data').select('data,updated_at').eq('user_id',person.id).maybeSingle();if(error)throw Error(error.message);return data}
function updateHeader(){const summary=$('sdAccountSummary');if(summary)summary.textContent=`@${profile.username} · Cloud ${role} · study data synced`;const topLabel=$('sdTopAccountLabel');if(topLabel)topLabel.textContent='@'+profile.username;
 const roleTag=window.StudySpireRoles;if(roleTag)roleTag.decorateLabel(topLabel,profile.username,role);const currentProfile=$('ssCurrentProfile');if(currentProfile)currentProfile.textContent='@'+profile.username;const toggle=$('sdAccountOpen');if(toggle)toggle.textContent='@'+profile.username;const log=$('sdAccountLogout');if(log){log.textContent='Sign out';log.style.display='inline-flex';log.hidden=false;}
 const names={owner:'👑 Owner Dashboard',co_owner:'🔱 Co-Owner Dashboard',admin:'🛡 Admin Dashboard',moderator:'⚑ Moderator Dashboard'};
 const staff=Boolean(names[role]),label=names[role]||'StudySpire';
 for(const id of ['ssCloudStaffBtn','ssCloudOwnerTop','ssCloudOwnerNav','ssCloudOwnerQuick']){
  const btn=$(id);if(!btn)continue;btn.hidden=!staff;
  if(id==='ssCloudOwnerNav'){const name=btn.querySelector('.sd-navtext');if(name)name.textContent=label}
  else if(id==='ssCloudOwnerQuick')btn.innerHTML='<span>⚙</span> '+label;
  else btn.textContent=label;
 }
 if(!staff&&$('ssCloudStaffDialog'))$('ssCloudStaffDialog').hidden=true;
}
function installOwnerNavigation(){
 // Show only the cloud-verified Owner/Admin/Moderator dashboard, never the local-only demo.
 const openDashboard=()=>openStaff();
 if(!$('ssCloudOwnerTop')){
  const top=$('sdTopAccount');
  if(top?.parentElement){const btn=document.createElement('button');btn.id='ssCloudOwnerTop';btn.type='button';btn.className='btn secondary small';btn.textContent='👑 Owner Dashboard';btn.onclick=openDashboard;btn.hidden=true;top.parentElement.insertBefore(btn,top);}
 }
 if(!$('ssCloudOwnerNav')){
  const old=$('ssAdminSidebar');
  if(old?.parentElement){const btn=document.createElement('button');btn.id='ssCloudOwnerNav';btn.type='button';btn.hidden=true;btn.innerHTML='<span class="navicon">⚑</span><span class="sd-navtext">👑 Owner Dashboard</span>';btn.onclick=openDashboard;old.parentElement.insertBefore(btn,old.nextSibling);}
 }
 if(!$('ssCloudOwnerQuick')){
  const quick=document.querySelector('.sd-dashboard-actions');
  if(quick){const btn=document.createElement('button');btn.id='ssCloudOwnerQuick';btn.hidden=true;btn.type='button';btn.innerHTML='<span>👑</span> Owner Dashboard';btn.onclick=openDashboard;quick.append(btn);}
 }
}
function installButtons(){document.documentElement.classList.add('ss-cloud-active');
 const localShade=$('sdAuthShade');if(localShade)localShade.style.display='none';
 const open=$('sdAccountOpen');if(open)open.onclick=()=>{showGate('account');cloudNotice(`Signed in as @${profile?.username||'…'}. Switch accounts or update your password below.`);$('ssc-loginArea').hidden=true;$('ssc-logout').parentElement.hidden=false};
 const logout=$('sdAccountLogout');if(logout){logout.style.display='inline-flex';logout.hidden=false;logout.onclick=signOutCloud;}
 const actions=document.querySelector('.sd-profile-actions')||document.querySelector('.sd-profile-side')||document.body;
 if(!$('ssCloudAccountBtn')){const button=document.createElement('button');button.id='ssCloudAccountBtn';button.type='button';button.className='btn secondary small';button.textContent='☁ Manage account';button.onclick=()=>open?.click();actions.append(button)}
 if(!$('ssCloudImportBtn')){const button=document.createElement('button');button.id='ssCloudImportBtn';button.type='button';button.className='btn secondary small';button.textContent='Import old backup';button.onclick=importLegacy;actions.append(button)}
 if(!$('ssCloudStaffBtn')){const button=document.createElement('button');button.id='ssCloudStaffBtn';button.type='button';button.className='btn secondary small';button.textContent='⚑ Cloud staff';button.onclick=()=>openStaff();actions.append(button)}
 if(!$('ssCloudReportBtn')){const button=document.createElement('button');button.id='ssCloudReportBtn';button.type='button';button.className='btn secondary small';button.textContent='Report an issue';button.onclick=sendReport;actions.append(button)}
 const disabled=['ssAdminSidebar','ssAdminSuiteTab','ssLabRolesTab'];for(const name of disabled){const el=$(name);if(el)el.hidden=true}
 // The authenticated messaging.js layer takes over this page with private Cloud RPCs.
 // Local-only social handlers are kept only when Cloud is not configured.
 // Keep legacy admin and local role panels hidden even if their own render methods later unhide them.
 const style=document.createElement('style');style.textContent='.ss-cloud-active #ssAdminSidebar,.ss-cloud-active #ssAdminSuiteTab,.ss-cloud-active #ssLabRolesTab,.ss-cloud-active #ssAdminPane,.ss-cloud-active #sdAuthShade{display:none!important}';document.head.append(style);
 installOwnerNavigation();
 updateHeader();
}
let lastUpload=Promise.resolve();
function scheduleSync(){if(!live||syncing||banned(profile)||!person)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>{uploadSnapshot().catch(e=>cloudNotice('Sync issue: '+e.message))},1800)}
async function uploadSnapshot(){if(!live||syncing||banned(profile)||!person)return;const uploadFor=person.id,contents=studyItems(),snapshot=JSON.stringify(contents);if(snapshot===lastSnapshot)return;
 if(snapshot.length>1400000){cloudNotice('Cloud storage limit reached. Export a backup and remove some large study documents.');return}
 lastUpload=lastUpload.then(async()=>{
    if(!live||person?.id!==uploadFor)return;
    const {data,error}=await client.from('ss_study_data').upsert({user_id:uploadFor,data:contents,updated_at:new Date().toISOString()},{onConflict:'user_id'}).select('updated_at').single();
    if(error)throw Error(error.message);
    if(person?.id===uploadFor){
      remote={data:contents,updated_at:data.updated_at};lastSnapshot=snapshot;lastSyncAt=Date.now();lastSyncError='';
      window.dispatchEvent(new Event('ss-cloud-sync'));
    }
  }).catch(error=>{
    if(person?.id===uploadFor){lastSyncError=String(error?.message||error);cloudNotice('Cloud sync failed: '+lastSyncError);window.dispatchEvent(new Event('ss-cloud-sync'))}
  });
 await lastUpload;
}
const nativeSet=Storage.prototype.setItem;
Storage.prototype.setItem=function(key,value){const out=nativeSet.call(this,key,value);if(ready&&this===localStorage&&cloudId&&String(key).startsWith(prefix())&&!syncing)scheduleSync();return out};
async function boot(){
 showGate('loading');if(!client)return cloudNotice('Supabase library did not load. Check your connection.');
 try{
 const {data:{user},error}=await client.auth.getUser();if(error||!user){person=null;profile=null;sessionStorage.removeItem('studydoc-active-account');showGate();return}
 if(user.is_anonymous){
   sessionMethod='username';
   const {data:account,error:lookupError}=await client.rpc('ss_username_me');
   if(lookupError){person=null;showGate();cloudNotice('Username accounts need the SQL migration in Supabase. Enable Anonymous Sign-Ins in Authentication settings. Use your username and password to sign in.');return}
   const row=Array.isArray(account)?account[0]:account;
   if(!row?.id){person=null;showGate();return}
   person={...user,id:row.id};
 } else {sessionMethod='email';person=user}
 cloudId='cloud'+person.id.replace(/-/g,'');const logged=sessionStorage.getItem('studydoc-active-account');
 if(logged!==cloudId){sessionStorage.setItem('studydoc-active-account',cloudId);sessionStorage.removeItem('ssCloudApplied');location.reload();return}
 if(!await refreshProfile())return;
 remote=await getRemote();
 if(!remote){remote={data:{},updated_at:'new'};}
 if(banned(profile)){showBanned();return}
 const tag=person.id+'|'+remote.updated_at;
 if(remote.updated_at!=='new'&&sessionStorage.getItem('ssCloudApplied')!==tag){setStudy(remote.data);sessionStorage.setItem('ssCloudApplied',tag);location.reload();return}
 if(remote.updated_at==='new')sessionStorage.setItem('ssCloudApplied',tag);
 lastSnapshot=remote.updated_at==='new'?'':JSON.stringify(studyItems());live=true;installButtons();$('ssCloudGate').hidden=true;
 window.dispatchEvent(new Event('ss-cloud-auth-changed'));
 if(remote.updated_at==='new'&&Object.keys(studyItems()).length)scheduleSync();
 window.addEventListener('beforeunload',()=>{if(live)uploadSnapshot().catch(()=>{})});
 window.addEventListener('focus',()=>refreshProfile());
 setInterval(async()=>{if(!person)return;const ok=await refreshProfile();if(!ok)return;if(banned(profile)){live=false;return}if(live){const nowRemote=await getRemote().catch(()=>null);if(nowRemote&&nowRemote.updated_at!==remote?.updated_at){const local=JSON.stringify(studyItems());if(local===lastSnapshot){remote=nowRemote;setStudy(nowRemote.data);lastSnapshot=JSON.stringify(studyItems());cloudNotice('New cloud updates received. Reload this page to view them.')}else cloudNotice('This account changed on another device. Export a backup before reloading.')}}},45000);
 }catch(err){showGate();cloudNotice('Could not open StudySpire Cloud: '+(err.message||err))}
}
async function importLegacy(){if(!person||banned(profile))return;const picker=document.createElement('input');picker.type='file';picker.accept='.json,application/json';picker.onchange=async()=>{const file=picker.files?.[0];if(!file)return;try{if(file.size>10000000)throw Error('Backups must be smaller than 10 MB.');const obj=JSON.parse(await file.text());const isLocalBackup=obj.kind==='study-summit-personal-backup'&&obj.items&&typeof obj.items==='object';
 const isCloudExport=obj.kind==='study-summit-cloud-export'&&obj.data&&typeof obj.data==='object';
 if(!isLocalBackup&&!isCloudExport)throw Error('Select a Study Lab personal backup or cloud study export JSON file.');
 const raw=isLocalBackup?obj.items:obj.data;
 const allowed=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,typeof v==='string'?v:JSON.stringify(v)]).filter(([k,v])=>typeof v==='string'&&v.length<1000000&&(STORE.includes(k)||(/^(studydock|studysync|study-summit|ss-)/.test(k)&&/(chat|doc|flash|note|card|agenda|learning|skill|task|progress|study|personalization)/i.test(k)&&!/(auth|password|credential|token|admin|ban|moderat|role|account)/i.test(k)))).slice(0,100));
 if(!Object.keys(allowed).length)throw Error('No study data found in that backup.');if(!confirm('Import '+Object.keys(allowed).length+' study sections into this cloud account? This replaces the matching sections already here.'))return;setStudy(allowed);await uploadSnapshot();alert('Study backup imported. Reloading StudySpire…');location.reload()}catch(e){alert('Import failed: '+e.message)}};picker.click()}
async function sendReport(){if(!person||banned(profile))return;const about=prompt('Username involved (optional):','');if(about===null)return;
 const message=prompt('Describe what happened (at least 10 characters):');if(message===null)return;
 const {error}=await client.rpc('ss_report_issue',{about_name:about,complaint:message});alert(error?'Could not send report: '+error.message:'Report received. Staff can review it in Cloud staff.')}
async function rpc(name,args){
 // Group-room content also gets the same AI safety review when posted through
 // the Cloud bridge. The database enforces a matching proof once strict mode is enabled.
 if(name==='ss_group_post'&&typeof args?.message==='string'){
  await window.StudySpireContentSafety.review('room',args.message);
 }
 const {data,error}=await client.rpc(name,args||{});
 if(error)throw Error(error.message);
 return data;
}
const SOCIAL_ALLOWED=new Set([
 'ss_chat_language_check','ss_social_lookup','ss_social_overview','ss_social_request','ss_social_respond',
 'ss_social_cancel','ss_social_unfriend','ss_social_block','ss_social_unblock',
 'ss_social_messages','ss_social_send','ss_social_share_deck','ss_social_report_message','ss_my_messaging_status'
]);
window.StudySummitMessagingBridge={
 configured:ready,
 account:()=>live&&person&&profile&&!banned(profile)?{id:person.id,username:profile.username,...(profile.role?{role:profile.role}:{})}:null,
 rpc:async(name,args)=>{
  if(!SOCIAL_ALLOWED.has(name))throw Error('Unsupported social operation');
  if(!live||!person||!profile||banned(profile))throw Error('Sign in to a Cloud account to use messages');
  return rpc(name,args);
 }
};
// Optional hosted tutor uses the signed-in StudySpire account.
// AI provider tokens are held ONLY by the Supabase Edge Function.
// School management RPCs: never send API secrets, never trust client role flags.
// Supabase validates the canonical profile and organization/school scope on every action.
window.StudySpireSchoolBridge={
 ready:()=>Boolean(ready&&client&&live&&person&&profile&&!banned(profile)),
 account:()=>live&&profile&&!banned(profile)?{username:profile.username,role:profile.role}:null,
 rpc:async(name,args={})=>{
  const allowed=new Set(['ss1_school_overview','ss1_school_create','ss1_school_set_admin',
   'ss1_school_set_permission','ss1_school_set_member','ss1_school_request_join',
   'ss1_school_pending','ss1_school_review_join','ss1_school_settings',
   'ss1_school_rename','ss1_school_announce','ss1_school_analytics',
   'ss_school_create_class','ss_school_classroom','ss_school_class_enroll',
   'ss_school_create_assignment','ss_school_submit_assignment',
   'ss_school_grade_assignment','ss_school_post_announcement',
   'ss_school_my_join_requests','ss_school_cancel_join']);
  if(!allowed.has(name))throw Error('Unsupported school operation');
  if(!ready||!client||!live||!person||!profile||banned(profile))throw Error('Sign in to StudySpire Cloud first');
  const {data,error}=await client.rpc(name,args);
  if(error)throw Error(error.message);
  return data;
 }
};
window.StudySpireHostedAI={
 available:()=>Boolean(ready&&client&&live&&person&&profile&&!banned(profile)),
 // Only the verified Cloud profile with this exact username may run diagnostics.
 // Supabase Edge Functions independently enforce the same authorization.
 canDiagnose:()=>Boolean(ready&&client&&live&&person&&profile&&!banned(profile)&&profile.username==='zk5142'),
 // Authenticated, zero-neuron diagnostic. Never returns provider credentials.
 diagnose:async()=>{
  if(!window.StudySpireHostedAI.canDiagnose())throw Error('Only the zk5142 account can test hosted AI settings.');
  const {data,error}=await client.functions.invoke('studyspire-tutor',{body:{action:'diagnose'}});
  if(error){
   let details=null;
   try{details=await error.context?.json?.()}catch(_){}
   throw Error(details?.message||error.message||'Could not test hosted AI configuration.');
  }
  if(!data?.ok)throw Error(data?.message||'Hosted AI diagnostic was unavailable.');
  return data;
 },
 quota:async()=>{
  if(!window.StudySpireHostedAI.available())throw Error('Sign in to StudySpire Cloud first.');
  const {data,error}=await client.rpc('ss_ai_status');
  if(error)throw Error(error.message);
  return data;
 },
 ask:async(messages,maxTokens,onChunk)=>{
  if(!window.StudySpireHostedAI.available())throw Error('Sign in to StudySpire Cloud first.');
  // Direct Worker access removes a Supabase Edge Function hop and a per-request
  // Worker health probe. The Worker independently verifies JWT and reserves quota.
  const workerRoot=String(window.STUDY_SUMMIT_CLOUD?.guideWorkerUrl||'').trim().replace(/\\/g,'').replace(/\/$/,'');
  let trustedWorker=false;
  try{const url=new URL(workerRoot);trustedWorker=url.protocol==='https:'&&url.hostname==='studyspire.zacharykeef735.workers.dev'&&!url.username&&!url.password&&!url.search&&!url.hash;}catch(_){}
  if(trustedWorker){
    const {data:sessionData,error:sessionError}=await client.auth.getSession();
    const accessToken=sessionData?.session?.access_token;
    if(sessionError||!accessToken)throw Error('Cloud session expired. Sign in again.');
    let response=null;
    try{response=await fetch(workerRoot+'/v1/tutor',{
      method:'POST',
      headers:{'Authorization':'Bearer '+accessToken,'Content-Type':'application/json'},
      body:JSON.stringify({messages,maxTokens:Math.min(300,Math.max(90,Number(maxTokens)||190)),stream:true}),
      credentials:'omit',
      referrerPolicy:'no-referrer',
      signal:AbortSignal.timeout(50000)
    });}catch(networkError){
      // Proxy, DNS and CORS transport failures may block workers.dev.
      // Supabase Edge Function retries server-to-server, without bypassing authentication.
      console.warn('Direct Worker connection unavailable; using Supabase AI gateway.',networkError?.name||'Network error');
    }
    if(response){
    const issueFrom=(details,status)=>{
      const error=new Error(details?.message||'Hosted tutor unavailable.');
      error.code=details?.code||('HTTP_'+status);
      return error;
    };
    if(!response.ok){
      const details=await response.json().catch(()=>null);
      throw issueFrom(details,response.status);
    }
    if(!String(response.headers.get('content-type')||'').includes('text/event-stream')){
      const payload=await response.json().catch(()=>null);
      if(!payload?.ok||typeof payload.answer!=='string')throw issueFrom(payload,response.status);
      return payload.answer;
    }
    if(!response.body)throw Error('Your browser cannot read streaming AI responses.');
    const reader=response.body.getReader();
    const decode=new TextDecoder();
    let buffer='',answer='';
    function acceptLine(line){
      if(!line.startsWith('data:'))return;
      const raw=line.slice(5).trim();
      if(!raw||raw==='[DONE]')return;
      let event;
      try{event=JSON.parse(raw)}catch(_){return}
      if(event?.error)throw Error('The model stopped unexpectedly. Please try again.');
      const piece=event?.response??event?.choices?.[0]?.delta?.content;
      if(typeof piece!=='string'||!piece)return;
      // Most Cloudflare SSE response chunks contain token deltas.
      // Also support providers sending the accumulating text.
      answer=piece.startsWith(answer)&&answer.length>0?piece:answer+piece;
      if(answer.length>10000)throw Error('Tutor response was unexpectedly long.');
      if(typeof onChunk==='function')onChunk(answer);
    }
    try{
      while(true){
        const {value,done}=await reader.read();
        if(done)break;
        buffer+=decode.decode(value,{stream:true});
        if(buffer.length>14000)throw Error('Invalid streaming response.');
        const lines=buffer.split(/\r?\n/);
        buffer=lines.pop()||'';
        for(const line of lines)acceptLine(line);
      }
      buffer+=decode.decode();
      if(buffer.trim())acceptLine(buffer);
    }finally{reader.releaseLock()}
    if(!answer.trim())throw Error('Cloudflare returned an empty tutor response.');
    return answer.trim();
    }
  }
  // Legacy fallback for installations without the direct Cloudflare Worker URL.
  const {data,error}=await client.functions.invoke('studyspire-tutor',{
   body:{messages,maxTokens:Math.min(300,Math.max(90,Number(maxTokens)||190))}
  });
  if(error){
   let details=null;
   try{details=await error.context?.json?.()}catch(_){}
   const issue=new Error(details?.message||error.message||'Hosted tutor unavailable.');
   issue.code=details?.code||'HOSTED_UNAVAILABLE';throw issue;
  }
  if(!data?.ok||typeof data?.answer!=='string'||!data.answer.trim()){
   const issue=new Error(data?.message||'Hosted AI returned no explanation.');
   issue.code=data?.code||'HOSTED_UNAVAILABLE';throw issue;
  }
  return data.answer;
 }
};
// Moderation checks are performed by a verified Supabase gateway, which invokes
// Cloudflare Workers AI and records a short-lived approval for the exact content.
// The browser never gets administrative credentials.
window.StudySpireContentSafety={
 review:async(kind,content)=>{
  if(!live||!person||!profile||banned(profile))throw Error('Sign in to StudySpire before posting.');
  if(!['message','room','bio','avatar'].includes(kind)||typeof content!=='string')throw Error('Invalid content to scan.');
  if(!content.trim())return {ok:true,allowed:true,active:false};
  const {data,error}=await client.functions.invoke('studyspire-moderate',{body:{kind,content}});
  if(error){
   let detail=null;
   try{detail=await error.context?.json?.()}catch(_){}
   throw Error(detail?.message||'Safety scanner unavailable. Please try again.');
  }
  if(!data?.ok)throw Error(data?.message||'Unable to scan this content.');
  if(data.allowed!==true)throw Error(data.message||'This content violates StudySpire safety rules.');
  return data;
 }
};
// Public profile labels expose only server-verified username, role and bio.
// This read-only RPC is available even for guests; no client can grant itself a role.
const PUBLIC_PROFILE_ALLOWED=new Set(['ss_public_profile','ss_public_titles']);
window.StudySpirePublicProfileBridge={
 ready:()=>Boolean(client&&ready),
 rpc:async(name,args)=>{
  if(!PUBLIC_PROFILE_ALLOWED.has(name))throw Error('Unsupported public profile lookup');
  if(!client||!ready)throw Error('StudySpire Cloud is not connected');
  const {data,error}=await client.rpc(name,args||{});
  if(error)throw Error(error.message);
  return data;
 }
};
// Photo actions use the existing authenticated Cloud client. Only allowlisted
// avatar operations are forwarded; all privileges are re-checked by SQL.
const AVATAR_ALLOWED=new Set([
 'ss_public_profile','ss_public_titles','ss_profile_set_bio','ss_avatar_me','ss_avatar_set','ss_avatar_public','ss_avatar_list','ss_avatar_report',
 'ss_avatar_staff_overview','ss_avatar_staff_restrict','ss_avatar_staff_review'
]);
window.StudySpireAvatarBridge={
 state:()=>live&&person&&profile&&!banned(profile)
   ? {id:person.id,username:profile.username,role:profile.role,active:true}
   : null,
 rpc:async(name,args)=>{
  if(!AVATAR_ALLOWED.has(name))throw Error('Unsupported profile picture operation');
  if(!live||!person||!profile||banned(profile))throw Error('Sign in to a Cloud account first');
  return rpc(name,args);
 }
};
async function openStaff(){if(!person||!['owner','co_owner','admin','moderator'].includes(role)||banned(profile))return;
 if(!await refreshProfile()||!['owner','co_owner','admin','moderator'].includes(role)||banned(profile))return;
 let modal=$('ssCloudStaffDialog');if(!modal){modal=document.createElement('div');modal.id='ssCloudStaffDialog';document.body.append(modal)}
 const canAccounts=['owner','co_owner','admin'].includes(role),canAudit=canAccounts,canRecover=['owner','co_owner'].includes(role);
 const names={owner:'👑 Owner Dashboard',co_owner:'🔱 Co-Owner Dashboard',admin:'🛡 Admin Dashboard',moderator:'⚑ Moderator Dashboard'};
 modal.hidden=false;modal.innerHTML=`<div class="ssc-staffbox ss-owner-classic" role="dialog" aria-modal="true" aria-labelledby="ssCloudAdminTitle" tabindex="-1">
 <div class="ssc-title-row ss-owner-heading"><div><div class="eyebrow">${role.toUpperCase()+' CONTROL CENTER'}</div><h2 id="ssCloudAdminTitle">${names[role]}</h2><p class="ssc-muted">${['owner','co_owner'].includes(role)?'Staff control · roles, moderation, auditing and recovery':role==='admin'?'Manage Students, Moderators and reports':'Review reports and help keep StudySpire safe'}</p></div><button id="ssCloudStaffClose" class="ssc-light" type="button">✕ Close</button></div>
 <div id="ssCloudAdminSummary" class="ssc-admin-summary"></div><nav class="ssc-staff-tabs" aria-label="Dashboard sections"><button data-staff-tab="accounts" ${canAccounts?'':'hidden'} type="button">👥 Accounts &amp; roles</button><button data-staff-tab="reports" type="button">⚑ Reports</button><button data-staff-tab="history" ${canAudit?'':'hidden'} type="button">◷ Action history</button><button data-staff-tab="report-history" ${['owner','co_owner'].includes(role)?'':'hidden'} type="button">🗂 Report history</button><button data-staff-tab="recovery" ${canRecover?'':'hidden'} type="button">🔐 Password recovery</button></nav>
 <div id="ssCloudStaffMsg" role="status" aria-live="polite"></div>
 <section class="ssc-admin-section" data-staff-pane="accounts" ${canAccounts?'':'hidden'}><h3>Account management &amp; permissions</h3><p class="ssc-muted">${role==='owner'?'Manage all roles, including Owners. At least one Owner must remain.':role==='co_owner'?'Manage roles except adding or removing Owners.':'Moderate Students and Moderators. Only Owners can assign roles.'}</p>
 <div class="ssc-role-manager" id="ssCloudRoleTools" hidden><label for="ssCloudTargetUser">Assign or change a role</label><div class="ssc-admin-tools"><select id="ssCloudTargetUser" aria-label="Select account"></select><select id="ssCloudTargetRole" aria-label="Choose role"><option value="student">Student</option><option value="moderator">Moderator</option><option value="admin">Admin</option><option value="co_owner">🔱 Co-Owner</option><option value="owner">👑 Owner · full access</option></select><button id="ssCloudApplyRole" type="button">Apply role</button></div><small>Create each username account normally, then promote it to Owner here. The promoted Owner receives full administrative access, including managing other Owners.</small></div>
 <div class="ssc-admin-tools"><input id="ssCloudAccountSearch" type="search" placeholder="Search accounts or roles…" aria-label="Search accounts"/><select id="ssCloudAccountFilter" aria-label="Filter accounts"><option value="all">All accounts</option><option value="active">Active</option><option value="banned">Banned</option><option value="staff">Staff</option></select><button id="ssCloudRefresh" class="ssc-light" type="button">↻ Refresh</button></div><div id="ssCloudStaffUsers"></div></section>
 <section class="ssc-admin-section" data-staff-pane="reports" hidden><div class="ssc-title-row"><h3>Reports inbox</h3><button class="ssc-light" id="ssCloudExportReports" type="button">↓ Export reports</button></div><div class="ssc-admin-tools"><select id="ssCloudReportFilter" aria-label="Filter reports"><option value="open">Open reports</option></select><input id="ssCloudReportSearch" type="search" placeholder="Search reports…" aria-label="Search reports"/></div><div id="ssCloudStaffReports"></div></section>
 <section class="ssc-admin-section" data-staff-pane="report-history" hidden><div class="ssc-title-row"><h3>Resolved report archive · Owners &amp; Co-Owners</h3><button class="ssc-light" id="ssCloudRefreshReportHistory" type="button">↻ Refresh history</button></div><p class="ssc-muted">Resolved reports leave the active inbox after a decision. Historical reasons, actions, reviewers and dates remain here; old image snapshots are not retained.</p><div class="ssc-admin-tools"><input type="search" id="ssCloudReportHistorySearch" placeholder="Search resolved reports…" aria-label="Search resolved report history"/><button type="button" class="ssc-light" id="ssCloudExportReportHistory">↓ Export history</button></div><div id="ssCloudReportHistory"></div></section>
 <section class="ssc-admin-section" data-staff-pane="history" hidden><div class="ssc-title-row"><h3>Admin action history</h3><button class="ssc-light" id="ssCloudExportAudit" type="button">↓ Export history</button></div><div id="ssCloudStaffAudit"></div></section><section class="ssc-admin-section" data-staff-pane="recovery" hidden><h3>Password recovery requests</h3><p class="ssc-muted">Verify the requester independently first. Only issue a code to the verified account holder. Never ask for their password.</p><button class="ssc-light" id="ssCloudRefreshRecovery" type="button">↻ Refresh requests</button><div id="ssCloudRecoveryRequests"></div></section></div>`;
 $('ssCloudStaffClose').onclick=()=>{modal.hidden=true;$('ssCloudReportViewer')?.remove()};
 modal.onclick=e=>{if(e.target===modal)modal.hidden=true};
 modal.onkeydown=e=>{if(e.key==='Escape')modal.hidden=true};
 const firstTab=modal.querySelector('[data-staff-tab]:not([hidden])');
 if(firstTab){firstTab.classList.add('ssc-current');modal.querySelectorAll('[data-staff-pane]').forEach(pane=>pane.hidden=pane.dataset.staffPane!==firstTab.dataset.staffTab)}
 modal.querySelectorAll('[data-staff-tab]:not([hidden])').forEach(tab=>{tab.onclick=()=>{modal.querySelectorAll('[data-staff-tab]').forEach(other=>{const selected=other===tab;other.classList.toggle('ssc-current',selected);other.setAttribute('aria-current',selected?'page':'false')});modal.querySelectorAll('[data-staff-pane]').forEach(pane=>pane.hidden=pane.dataset.staffPane!==tab.dataset.staffTab);if(tab.dataset.staffTab==='recovery')renderRecovery().catch(e=>staffMsg(e.message));if(tab.dataset.staffTab==='report-history')renderReportHistory().catch(e=>staffMsg(e.message))}});
 $('ssCloudRefreshRecovery').onclick=()=>renderRecovery().catch(e=>staffMsg(e.message));
 $('ssCloudApplyRole').onclick=async()=>{const id=$('ssCloudTargetUser').value,newRole=$('ssCloudTargetRole').value;const user=staffData.users.find(item=>item.id===id);
 if(!['owner','co_owner'].includes(role)||!user||user.id===person?.id)return staffMsg('Choose an account other than your own.');
 if(role==='co_owner'&&(user.role==='owner'||newRole==='owner'))return staffMsg('Co-Owners cannot add or remove Owners.');
 if(user.role===newRole)return staffMsg('@'+user.username+' already has this role.');
 const sensitive=user.role==='owner'||newRole==='owner';
 if(!confirm(sensitive
   ? 'WARNING: '+(newRole==='owner'?'Promote @'+user.username+' to full Owner? They will be able to manage all accounts and grant/revoke Owner roles.':'Remove Owner permissions from @'+user.username+'?')+' Continue?'
   : 'Change @'+user.username+' from '+user.role+' to '+newRole+'?'))return;
 const button=$('ssCloudApplyRole');button.disabled=true;
 try{await rpc('ss_change_role',{target_user:id,new_role:newRole});await renderStaff();staffMsg('Role updated for @'+user.username+'.')}
 catch(e){staffMsg('Role change failed: '+e.message)}finally{button.disabled=false}
 };
 for(const name of ['ssCloudAccountSearch','ssCloudReportSearch'])$(name).oninput=applyStaffFilters;
 $('ssCloudReportHistorySearch').oninput=applyReportHistoryFilters;
 $('ssCloudRefreshReportHistory').onclick=()=>renderReportHistory().catch(e=>staffMsg(e.message));
 $('ssCloudExportReportHistory').onclick=()=>download('studyspire-report-history-'+Date.now()+'.json',{exported:new Date().toISOString(),reports:staffData.reportHistory});
 for(const name of ['ssCloudAccountFilter','ssCloudReportFilter'])$(name).onchange=applyStaffFilters;
 $('ssCloudRefresh').onclick=()=>renderStaff().catch(e=>staffMsg(e.message));
 $('ssCloudExportReports').onclick=()=>download('study-summit-reports-'+Date.now()+'.json',{exported:new Date().toISOString(),reports:staffData.reports,profile_picture_reports:staffData.avatarReports});
 $('ssCloudExportAudit').onclick=()=>download('study-summit-admin-audit-'+Date.now()+'.json',{exported:new Date().toISOString(),actions:staffData.audit});
 modal.querySelector('.ssc-staffbox').focus();
 window.StudySpireAvatars?.mountStaff(modal);
 renderStaff().catch(e=>staffMsg(e.message));}
async function renderRecovery(){
 if(!['owner','co_owner'].includes(role)||!await refreshProfile()||!['owner','co_owner'].includes(role))throw Error('Owner only');
 const requests=await rpc('ss_owner_reset_requests'),container=$('ssCloudRecoveryRequests');if(!container)return;
 container.replaceChildren();if(!requests?.length){container.textContent='No pending password recovery requests.';return}
 for(const req of requests){
  const row=document.createElement('div');row.className='ssc-recovery-row';
  const heading=document.createElement('strong');heading.textContent='@'+req.username+' · '+req.status;row.append(heading);
  const date=document.createElement('small');date.textContent=new Date(req.created_at).toLocaleString();row.append(date);
  const buttons=document.createElement('div');buttons.className='ssc-row';
  const issue=document.createElement('button');issue.textContent='Issue one-time code';
  issue.onclick=async()=>{if(!confirm('Have you independently verified that this is the rightful owner of @'+req.username+'? Issuing a code enables password replacement.'))return;
   issue.disabled=true;try{const code=String(await rpc('ss_owner_issue_password_reset',{reset_request_id:req.request_id}));
    const secret=document.createElement('div');secret.className='ssc-recovery-code';
    const note=document.createElement('p');note.textContent='Show once; expires in 15 minutes. Privately share with the verified requester.';
    const value=document.createElement('code');value.textContent=code;
    const copy=document.createElement('button');copy.className='ssc-light';copy.textContent='Copy code';copy.onclick=()=>navigator.clipboard.writeText(code).catch(()=>staffMsg('Clipboard unavailable. Copy manually.'));
    secret.append(note,value,copy);row.append(secret);staffMsg('Code issued for @'+req.username+'.');
   }catch(e){staffMsg(e.message)}finally{issue.disabled=false}};
  const deny=document.createElement('button');deny.className='ssc-light';deny.textContent='Deny request';
  deny.onclick=async()=>{if(!confirm('Deny recovery for @'+req.username+'?'))return;deny.disabled=true;try{await rpc('ss_owner_deny_password_reset',{reset_request_id:req.request_id});await renderRecovery();staffMsg('Request denied.')}catch(e){staffMsg(e.message)}finally{deny.disabled=false}};
  buttons.append(issue,deny);row.append(buttons);container.append(row)
 }
}
let staffData={users:[],reports:[],avatarReports:[],audit:[],reportHistory:[],messagingRestrictions:[]};
function staffMsg(message){if($('ssCloudStaffMsg'))$('ssCloudStaffMsg').textContent=message}
function applyStaffFilters(){
 const s=($('ssCloudAccountSearch')?.value||'').toLowerCase().trim(),filter=$('ssCloudAccountFilter')?.value||'all';
 $('ssCloudStaffUsers')?.querySelectorAll('[data-staff-user]').forEach(row=>{const hit=row.dataset.staffUser.includes(s),ban=row.dataset.banned==='true',staff=row.dataset.staffRole!=='student';row.hidden=!(hit&&(filter==='all'||filter==='active'&&!ban||filter==='banned'&&ban||filter==='staff'&&staff))});
 const rs=($('ssCloudReportSearch')?.value||'').toLowerCase().trim(),rf=$('ssCloudReportFilter')?.value||'open';
 $('ssCloudStaffReports')?.querySelectorAll('[data-report]').forEach(row=>{row.hidden=!(row.dataset.report.includes(rs)&&(rf==='all'||row.dataset.status===rf))});
}


function applyReportHistoryFilters(){
 const q=($('ssCloudReportHistorySearch')?.value||'').toLowerCase().trim();
 $('ssCloudReportHistory')?.querySelectorAll('[data-history-search]').forEach(row=>row.hidden=!row.dataset.historySearch.includes(q));
}
async function renderReportHistory(){
 if(!['owner','co_owner'].includes(role))throw Error('Only Owners and Co-Owners can view report history.');
 const host=$('ssCloudReportHistory');if(!host)return;
 host.textContent='Loading archived reports…';
 const rows=await rpc('ss_owner_report_history');
 staffData.reportHistory=Array.isArray(rows)?rows:[];
 host.replaceChildren();
 for(const r of staffData.reportHistory){
  const item=document.createElement('article');item.className='ssc-report-history-item';
  item.dataset.historySearch=[r.kind,r.reporter,r.target,r.reason,r.decision,r.reviewer].join(' ').toLowerCase();
  const label=document.createElement('strong');
  label.textContent=(r.kind==='avatar'?'🖼 Picture':'⚑ General')+' · @'+(r.target||'General');
  const when=document.createElement('small');
  when.textContent=String(r.decision||'resolved').replaceAll('_',' ')+' · @'+(r.reviewer||'Unknown')+' · '+new Date(r.resolved_at).toLocaleString();
  const disclosure=document.createElement('details');
  const summary=document.createElement('summary');summary.textContent='Read original report';
  const evidence=document.createElement('p');
  evidence.textContent='Reported by @'+(r.reporter||'Unknown')+'\nSubmitted: '+new Date(r.created_at).toLocaleString()+'\nReason: '+(r.reason||'Unspecified');
  evidence.style.whiteSpace='pre-wrap';evidence.style.overflowWrap='anywhere';
  disclosure.append(summary,evidence);item.append(label,when,disclosure);host.append(item);
 }
 if(!staffData.reportHistory.length)host.textContent='No resolved reports yet. New decisions will appear here.';
 applyReportHistoryFilters();
}
function openStaffReport(report,kind){
 $('ssCloudReportViewer')?.remove();
 const avatar=kind==='avatar';
 const shade=document.createElement('div');shade.id='ssCloudReportViewer';shade.tabIndex=-1;
 const dialog=document.createElement('section');dialog.className='ssc-report-review-panel';dialog.setAttribute('role','dialog');
 dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','ssCloudReportReviewTitle');
 const top=document.createElement('div');top.className='ssc-report-review-head';
 const heading=document.createElement('h2');heading.id='ssCloudReportReviewTitle';
 heading.textContent=avatar?'🖼 Profile picture report':'⚑ Report review';
 const close=document.createElement('button');close.textContent='✕ Close without decision';close.className='ssc-light';
 close.onclick=()=>shade.remove();top.append(heading,close);dialog.append(top);
 function field(label,value){
  const group=document.createElement('div');group.className='ssc-report-review-field';
  const name=document.createElement('b');name.textContent=label;
  const content=document.createElement('p');content.textContent=String(value||'Not provided');
  group.append(name,content);dialog.append(group);
 }
 const target=avatar?report.target_username:report.about_username;
 const reporter=avatar?report.reporter:report.reporter_name;
 field('Reported account',target?'@'+target:'General issue / no account');
 field('Reported by',reporter?'@'+reporter:'Unknown');
 field('Submitted',new Date(report.created_at).toLocaleString());
 field('Report and evidence',report.reason);
 if(avatar&&typeof report.image_snapshot==='string'&&report.image_snapshot.startsWith('data:image/webp;base64,')&&report.image_snapshot.length<100000){
  const img=document.createElement('img');img.className='ssc-report-review-image';img.src=report.image_snapshot;
  img.alt='Reported profile picture as submitted';dialog.append(img);
 }
 const hint=document.createElement('p');hint.className='ssc-muted';
 hint.textContent='Closing this window leaves the report open. It disappears from the inbox only after a decision, which is saved in staff report history.';
 dialog.append(hint);
 const status=document.createElement('p');status.className='ssc-report-review-status';status.setAttribute('role','status');dialog.append(status);
 const actions=document.createElement('div');actions.className='ssc-report-review-actions';
 if(avatar&&report.can_moderate!==true){
  const restricted=document.createElement('p');restricted.textContent='Only higher-ranking staff can decide this report.';
  actions.append(restricted);
 }else{
  const options=avatar
   ? [['Dismiss · no violation','dismiss'],['Take down profile picture','remove']]
   : [['Dismiss · no violation','dismiss'],['Take down profile picture','remove_picture'],['Clear reported bio','remove_bio']];
  if(!avatar&&((report.reason||'').startsWith('Message report [')||report.reported_message_id))
   options.push(['Delete reported message','remove_message']);
  if(!avatar&&role!=='moderator'&&target)
   options.push(['Ban for 24 hours','ban_24h'],['Ban for 7 days','ban_7d']);
  for(const [label,decision] of options){
   const btn=document.createElement('button');btn.className='ssc-light';btn.textContent=label;
   btn.onclick=async()=>{
    const explanation=decision==='dismiss'
     ? 'Dismiss this report without removing content? The decision will be archived.'
     : 'Confirm '+label+' for @'+(target||'this account')+'? This closes and archives the report.';
    if(!confirm(explanation))return;
    actions.querySelectorAll('button').forEach(b=>b.disabled=true);
    status.textContent='Applying decision…';
    try{
     if(avatar)await rpc('ss_avatar_staff_review',{report_id:report.id,decision});
     else await rpc('ss_resolve_report',{report_id:report.id,decision});
     shade.remove();
     await renderStaff();
     staffMsg('Decision recorded: '+label+'. Report archived.');
    }catch(e){
     status.textContent='Could not resolve report: '+(e?.message||'Unknown error');
     actions.querySelectorAll('button').forEach(b=>b.disabled=false);
    }
   };
   actions.append(btn);
  }
 }
 dialog.append(actions);shade.append(dialog);
 shade.onclick=e=>{if(e.target===shade)shade.remove()};
 shade.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();shade.remove()}};
 document.body.append(shade);close.focus();
}
async function renderStaff(){staffMsg('Loading dashboard…');const canAccounts=['owner','co_owner','admin'].includes(role);
 const [users,reports,audit,chatFlags,avatarData,messagingRestrictions]=await Promise.all([canAccounts?rpc('ss_staff_profiles'):Promise.resolve([]),rpc('ss_staff_reports'),canAccounts?rpc('ss_staff_audit'):Promise.resolve([]),rpc('ss_staff_chat_flags'),rpc('ss_avatar_staff_overview'),['owner','co_owner'].includes(role)?rpc('ss_owner_messaging_restrictions'):Promise.resolve([])]);
 const avatarReports=Array.isArray(avatarData?.reports)?avatarData.reports:[];
 staffData={...staffData,users,reports,avatarReports,audit,messagingRestrictions:Array.isArray(messagingRestrictions)?messagingRestrictions:[]};
 const openReportCount=reports.filter(r=>r.status==='open').length+avatarReports.filter(r=>r.status==='open').length;const summary=$('ssCloudAdminSummary');if(summary){summary.replaceChildren();
 const overview=role==='moderator'
   ? [[openReportCount,'Open reports'],[Array.isArray(chatFlags)?chatFlags.length:0,'Blocked attempts']]
   : role==='admin'
   ? [[users.length,'Managed accounts'],[openReportCount,'Open reports'],[users.filter(u=>u.banned&&(!u.banned_until||Date.parse(u.banned_until)>Date.now())).length,'Active bans']]
   : [[users.length,'Accounts'],[users.filter(u=>u.role==='owner').length,'Owners'],[openReportCount,'Open reports'],[users.filter(u=>u.banned&&(!u.banned_until||Date.parse(u.banned_until)>Date.now())).length,'Active bans'],[users.filter(u=>u.role!=='student').length,'Staff']];
 for(const [number,label] of overview){const tile=document.createElement('div');tile.className='ssc-summary-tile';const strong=document.createElement('strong');strong.textContent=number;const small=document.createElement('small');small.textContent=label;tile.append(strong,small);summary.append(tile)}}
 const manager=$('ssCloudRoleTools'),target=$('ssCloudTargetUser');if(manager)manager.hidden=!['owner','co_owner'].includes(role);
 if(target){const ownerOption=$('ssCloudTargetRole')?.querySelector('option[value="owner"]');if(ownerOption)ownerOption.disabled=role!=='owner';const old=target.value;target.replaceChildren();for(const u of users.filter(u=>u.id!==person?.id&&(role==='owner'||u.role!=='owner')))target.add(new Option('@'+u.username+' · '+u.role,u.id));if(users.some(u=>u.id===old&&u.id!==person?.id&&(role==='owner'||u.role!=='owner')))target.value=old;const onPick=()=>{const u=users.find(user=>user.id===target.value);if(u)$('ssCloudTargetRole').value=u.role;const locked=role==='co_owner'&&u?.role==='owner';$('ssCloudApplyRole').disabled=Boolean(locked);};target.onchange=onPick;onPick();$('ssCloudApplyRole').disabled=!['owner','co_owner'].includes(role)||!target.value||(role==='co_owner'&&users.some(u=>u.id===target.value&&u.role==='owner'));}
 const box=$('ssCloudStaffUsers');if(!box)return;box.replaceChildren();const h=document.createElement('h3');h.textContent='Accounts ('+users.length+')';box.append(h);
 for(const u of users){const row=document.createElement('div');row.className='ssc-user';row.dataset.staffUser=(u.username+' '+u.role).toLowerCase();row.dataset.staffRole=u.role;row.dataset.banned=String(Boolean(u.banned&&(!u.banned_until||Date.parse(u.banned_until)>Date.now())));const left=document.createElement('div');const tag=document.createElement('strong');tag.textContent='@'+u.username+' · '+u.role;left.append(tag);
 const note=document.createElement('small');note.textContent=u.banned&&(!u.banned_until||new Date(u.banned_until)>new Date())?'BANNED · '+(u.ban_reason||'No reason'):u.banned?'Ban expired':'Active';left.append(note);row.append(left);
 if(['owner','co_owner'].includes(role)&&(role==='owner'||u.role!=='owner')&&u.id!==person?.id){const sel=document.createElement('select');(role==='owner'?['student','moderator','admin','co_owner','owner']:['student','moderator','admin','co_owner']).forEach(r=>sel.add(new Option(r==='owner'?'👑 Owner':r==='co_owner'?'🔱 Co-Owner':r,r)));sel.value=u.role;sel.setAttribute('aria-label','Role for '+u.username);sel.onchange=async()=>{const requested=sel.value;const sensitive=u.role==='owner'||requested==='owner';if(role==='co_owner'&&sensitive){sel.value=u.role;return staffMsg('Co-Owners cannot add or remove Owners.');}
 if(!confirm(sensitive
  ? 'WARNING: '+(requested==='owner'?'Grant full Owner control to @'+u.username+'? They can manage other Owners.':'Remove Owner permissions from @'+u.username+'?')+' Continue?'
  : 'Set @'+u.username+' to '+requested+'?')){sel.value=u.role;return}sel.disabled=true;try{await rpc('ss_change_role',{target_user:u.id,new_role:requested});await renderStaff();staffMsg('Role updated for @'+u.username+'.')}catch(e){sel.value=u.role;staffMsg('Role change failed: '+e.message)}finally{sel.disabled=false}};row.append(sel)}
 if(['owner','co_owner','admin'].includes(role)&&u.role!=='owner'&&u.id!==person.id&&(['owner','co_owner'].includes(role)||!['admin','co_owner'].includes(u.role))){
 const activeBan=u.banned&&(!u.banned_until||new Date(u.banned_until)>new Date());const ban=document.createElement('button');ban.textContent=activeBan?'Lift ban early':'Ban';ban.className='ssc-light';ban.onclick=async()=>{try{if(activeBan){if(!confirm('Unban @'+u.username+' right now?'))return;await rpc('ss_change_ban',{target_user:u.id,ban_hours:0,reason:'Ban lifted early',lift:true})}
 else{const why=prompt('Reason for banning @'+u.username+' (required):');if(!why?.trim())return;const duration=prompt('Hours: 24 = 1 day, 168 = 7 days, 720 = 30 days, 0 = permanent','24');if(!['0','24','168','720'].includes(duration))return alert('Choose 0, 24, 168 or 720.');if(!confirm('Confirm ban for @'+u.username+'?'))return;await rpc('ss_change_ban',{target_user:u.id,ban_hours:Number(duration),reason:why,lift:false})}
 staffMsg('Ban action saved.');await renderStaff()}catch(e){staffMsg(e.message)}};row.append(ban)}
 if(['owner','co_owner'].includes(role)&&u.id!==person?.id&&(role==='owner'||u.role!=='owner')){
  const current=staffData.messagingRestrictions.find(item=>item.id===u.id);
  const restricted=current?.restricted===true;
  if(restricted){
   const flag=document.createElement('small');flag.className='ssc-messaging-restricted';
   flag.textContent='🔇 Messaging restricted'+(current.reason?' · '+current.reason:'');
   left.append(flag);
  }
  const toggle=document.createElement('button');toggle.className='ssc-light';
  toggle.textContent=restricted?'🔊 Restore messaging':'🔇 Restrict messaging';
  toggle.title=restricted?'Allow this account to send messages again':'Prevent outgoing DMs, study-room posts, and deck sharing';
  toggle.onclick=async()=>{
   let reason='';
   if(!restricted){
    const answer=prompt('Reason for restricting @'+u.username+' from sending messages (3–300 characters):');
    if(answer===null)return;
    reason=answer.trim();
    if(reason.length<3||reason.length>300)return staffMsg('Enter a reason between 3 and 300 characters.');
   }
   const question=restricted
    ? 'Restore messaging for @'+u.username+'? They will be able to send messages and post in study rooms again.'
    : 'Restrict messaging for @'+u.username+'? They can still read conversations, but cannot send messages, post to study rooms, or share decks.';
   if(!confirm(question))return;
   toggle.disabled=true;
   try{
    await rpc('ss_owner_set_messaging_restriction',{target_user:u.id,restricted:!restricted,reason});
    await renderStaff();
    staffMsg('Messaging '+(restricted?'restored':'restricted')+' for @'+u.username+'.');
   }catch(e){staffMsg('Could not change messaging restriction: '+(e?.message||e));toggle.disabled=false;}
  };
  row.append(toggle);
 }
 box.append(row)}

 const reportsBox=$('ssCloudStaffReports');reportsBox.replaceChildren();
 for(const r of reports.filter(x=>x.status==='open')){
  const row=document.createElement('div');row.className='ssc-user';
  row.dataset.report=(r.about_username+' '+r.reporter_name+' '+r.reason).toLowerCase();row.dataset.status='open';
  const info=document.createElement('div');const heading=document.createElement('strong');
  heading.textContent='⚑ REPORT · '+(r.about_username?'@'+r.about_username:'General issue');
  const detail=document.createElement('small');
  detail.textContent='From @'+r.reporter_name+' · '+new Date(r.created_at).toLocaleString();
  info.append(heading,detail);row.append(info);
  const review=document.createElement('button');review.className='ssc-light';review.textContent='Review report';
  review.onclick=()=>openStaffReport(r,'general');row.append(review);reportsBox.append(row);
 }
 for(const r of avatarReports.filter(x=>x.status==='open')){
  const row=document.createElement('div');row.className='ssc-user';
  row.dataset.report=('profile picture '+(r.target_username||'')+' '+(r.reporter||'')+' '+(r.reason||'')).toLowerCase();
  row.dataset.status='open';const info=document.createElement('div');const heading=document.createElement('strong');
  heading.textContent='🖼 PICTURE REPORT · @'+(r.target_username||'Unknown');
  const detail=document.createElement('small');detail.textContent='From @'+(r.reporter||'Unknown')+' · '+new Date(r.created_at).toLocaleString();
  info.append(heading,detail);row.append(info);
  const review=document.createElement('button');review.className='ssc-light';review.textContent='Review report';
  review.onclick=()=>openStaffReport(r,'avatar');row.append(review);reportsBox.append(row);
 }
 if(!reports.some(x=>x.status==='open')&&!avatarReports.some(x=>x.status==='open'))reportsBox.textContent='No open reports.';
 applyStaffFilters();
 // Blocked chat attempts are logged server-side without retaining their message text.
 let languageFlags=$('ssCloudLanguageFlags');
 if(!languageFlags){
  const section=document.createElement('section');section.className='ssc-language-flags';
  const title=document.createElement('h3');title.textContent='⚑ Blocked chat attempts';
  const explanation=document.createElement('p');explanation.className='ssc-muted';
  explanation.textContent='Chat messages containing blocked language are NOT delivered. Only their sender, recipient, category and time are logged.';
  languageFlags=document.createElement('div');languageFlags.id='ssCloudLanguageFlags';
  section.append(title,explanation,languageFlags);reportsBox.insertAdjacentElement('afterend',section);
 }
 languageFlags.replaceChildren();
 for(const flag of Array.isArray(chatFlags)?chatFlags:[]){
  const row=document.createElement('div');row.className='ssc-user';
  const info=document.createElement('span');
  info.textContent='@'+flag.sender+' → @'+(flag.recipient||'unknown')+
    ' · '+(flag.reason==='hateful_language'?'Hateful language':'Profanity')+
    ' · '+new Date(flag.created_at).toLocaleString();
  row.append(info);languageFlags.append(row);
 }
 if(!chatFlags?.length)languageFlags.textContent='No blocked message attempts.';
 const auditBox=$('ssCloudStaffAudit');auditBox.replaceChildren();for(const a of audit){const item=document.createElement('div');item.className='ssc-audit';item.textContent=`${new Date(a.created_at).toLocaleString()} · @${a.actor_name} · ${a.action} · @${a.target_name} · ${a.details}`;auditBox.append(item)}if(!audit.length)auditBox.textContent='No admin actions yet.';
 applyStaffFilters();staffMsg('Cloud dashboard refreshed.');
}
function addStyling(){const style=document.createElement('style');style.textContent=`
#ssCloudGate[hidden],#ssCloudStaffDialog[hidden]{display:none!important}
#ssCloudGate,#ssCloudStaffDialog{position:fixed;inset:0;background:#080e19f4;color:#e8efff;z-index:99999;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:6vh 15px 40px;font:14px/1.6 system-ui,sans-serif}
.ssc-shell,.ssc-staffbox{background:#141f32;border:1px solid #344561;box-shadow:0 18px 80px #0008;padding:28px;border-radius:18px;width:min(100%,480px)}
.ssc-staffbox{width:min(100%,850px)}.ssc-mark{font-size:31px;color:#b4adff}.ssc-heading{font-size:25px;font-weight:800;letter-spacing:-.6px}.ssc-heading span{color:#aaa7ff}
.ssc-muted,.ssc-caption{color:#a6b7d2}.ssc-caption{font-size:12px}.ssc-shell label{display:block;font-weight:700;font-size:12px;margin-top:14px;margin-bottom:5px}
.ssc-shell input,.ssc-user select{width:100%;box-sizing:border-box;border:1px solid #486080;border-radius:9px;padding:11px;background:#0c1524;color:#fff;font:inherit}
 .ssc-shell .ssc-title-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.ssc-shell .ssc-title-row button{white-space:nowrap;font-size:12px;padding:7px 10px}.ssc-shell button[hidden]{display:none!important}.ssc-shell .ssc-password-toggle{display:block;margin:8px 0 0 auto;font-size:12px;padding:6px 11px}
.ssc-row{display:flex;gap:10px;margin-top:15px;flex-wrap:wrap}.ssc-row>button{flex:1}.ssc-shell button,.ssc-staffbox button{cursor:pointer;border:1px solid #8a89d8;background:#7978d6;color:#fff;border-radius:9px;padding:9px 13px;font-weight:720;font:inherit}
.ssc-methods{display:flex;gap:8px;margin:16px 0}.ssc-methods button{flex:1;font-size:12px;padding:9px 6px}.ssc-methods .ssc-selected{background:#7978d6!important;border-color:#9c9bfd!important;color:#fff!important}.ssc-shell button.ssc-light,.ssc-staffbox button.ssc-light{background:#25324c;border-color:#49607d}.ssc-shell button:hover,.ssc-staffbox button:hover{filter:brightness(1.2)}
.ssc-shell .ssc-forgot{display:block;margin:12px 0;width:100%;font-size:12px}
.ssc-recentList{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}
.ssc-recent-label{font-size:12px}
.ssc-recentItem{display:inline-flex;gap:3px}
.ssc-recentItem button{padding:6px 10px!important;font-size:12px!important}.ssc-recentItem button:disabled{opacity:.65;cursor:default}.ssc-switchList{margin:14px 0;padding:13px;border:1px solid #40526e;border-radius:10px}.ssc-switchList[hidden]{display:none!important}.ssc-switchList .ssc-caption{margin:10px 0}.ssc-save-current{margin:12px 0;width:100%;font-size:12px!important}
.ssc-change-pass{margin:14px 0;border:1px solid #40526e;padding:12px;border-radius:10px}
.ssc-change-pass summary{cursor:pointer;font-weight:700}
.ssc-change-pass[hidden]{display:none!important}
.ssc-change-pass button{margin-top:12px}
.ssc-shell #ssc-recovery[hidden]{display:none!important}
#ssCloudRecoveryRequests{display:grid;gap:10px;margin-top:12px}
.ssc-recovery-row{border:1px solid #34435c;border-radius:12px;padding:12px;overflow-wrap:anywhere}
.ssc-recovery-row strong{display:block}
.ssc-recovery-code{padding:10px;border:1px solid #7671c2;border-radius:9px;margin-top:12px}
.ssc-recovery-code code{display:block;white-space:pre-wrap;word-break:break-all;font-size:14px;margin:8px 0}
.ssc-banned{color:#ff657b;font-weight:950;font-size:35px;letter-spacing:1px;text-align:center;margin:18px 0 8px}.ssc-user{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid #33425c;padding:12px 0}
.ssc-user>div{flex:1;min-width:190px}.ssc-user small{display:block;color:#a8b5cb;overflow-wrap:anywhere}.ssc-user select{width:150px}.ssc-title-row{display:flex;justify-content:space-between;gap:15px}.ssc-staffbox h3{margin:24px 0 3px}.ssc-audit{padding:7px 0;border-bottom:1px solid #2e3a52;font-size:12px;color:#b5c3dd}

 #ssCloudOwnerTop[hidden],#ssCloudOwnerNav[hidden],#ssCloudOwnerQuick[hidden],#ssCloudStaffBtn[hidden]{display:none!important}
 #ssCloudOwnerNav{color:#e4d9ff}#ssCloudOwnerTop{white-space:nowrap}#ssCloudOwnerQuick{border-color:#9d85e9}
 #ssCloudStaffDialog .ssc-staffbox{width:min(100%,1010px);outline:0;background:linear-gradient(145deg,#141b28,#101620);border-color:#283348;box-shadow:0 18px 54px #0006;color:#edf1fb}
 #ssCloudStaffDialog .ss-owner-heading{border-bottom:1px solid #283348;padding-bottom:16px;align-items:flex-start}
 #ssCloudStaffDialog .ss-owner-heading .eyebrow{color:#b2aeff;font-size:11px;font-weight:800;letter-spacing:1.5px}
 #ssCloudStaffDialog .ss-owner-heading h2{font-size:27px;letter-spacing:-.8px;margin:5px 0}
 #ssCloudStaffDialog .ssc-staff-tabs{display:flex;gap:7px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid #283348}
 #ssCloudStaffDialog .ssc-staff-tabs button{background:transparent;border:1px solid transparent;color:#aab5c8;padding:10px 13px}
 #ssCloudStaffDialog .ssc-staff-tabs button.ssc-current{color:#e9e7ff;background:#7773ff20;border-color:#4f4b8735;box-shadow:inset 3px 0 #8b86ff}
 #ssCloudStaffDialog .ssc-admin-section{background:linear-gradient(145deg,#141b28,#101620);border:1px solid #283348;border-radius:16px;padding:16px 19px 19px!important}
 #ssCloudStaffDialog .ssc-admin-section[hidden],#ssCloudStaffDialog #ssCloudRoleTools[hidden],#ssCloudStaffDialog .ssc-staff-tabs button[hidden]{display:none!important}
 #ssCloudStaffDialog .ssc-role-manager{background:#1c1a34;border:1px solid #393766;border-radius:13px;padding:13px;margin:12px 0}
 #ssCloudStaffDialog .ssc-role-manager label{font-weight:800;color:#dad7ff}
 #ssCloudStaffDialog .ssc-role-manager small{color:#a8a5db}
 #ssCloudStaffDialog .ssc-role-manager select{min-width:155px;flex:1;background:#0c111a;border:1px solid #39445d;color:#edf1fa;padding:10px;border-radius:9px}
 #ssCloudStaffDialog .ssc-role-manager button{background:#6964e9;border-color:#958fff}
 #ssCloudStaffDialog .ssc-summary-tile{background:#171f2d;border:1px solid #283348;border-radius:12px;padding:12px;display:flex;flex-direction:column}
 #ssCloudStaffDialog .ssc-summary-tile strong{font-size:25px;color:#e9e7ff}
 #ssCloudStaffDialog .ssc-summary-tile small{font-size:11px;color:#97a3b8}
 #ssCloudStaffDialog .ssc-user{border-bottom:1px solid #283348}
 #ssCloudStaffDialog #ssCloudStaffMsg{font-size:12px;color:#a8d9c4;min-height:18px;margin-top:10px}
 #ssCloudStaffDialog .ssc-admin-summary{margin:15px 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}
 #ssCloudStaffDialog .ssc-admin-section{margin:16px 0 22px;border-top:1px solid #34435c;padding-top:10px}
 #ssCloudStaffDialog .ssc-admin-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}
 #ssCloudStaffDialog .ssc-admin-tools input,#ssCloudStaffDialog .ssc-admin-tools select{min-width:150px;flex:1;background:#0c1524;color:#fff;border:1px solid #486080;border-radius:9px;padding:10px;font:inherit}
 #ssCloudStaffDialog .ssc-user[hidden]{display:none!important}
 #ssCloudStaffDialog .ssc-messaging-restricted{color:#ffc68c;font-weight:700}#ssCloudStaffDialog .ssc-title-row{align-items:center}
 #ssCloudReportViewer{position:fixed;inset:0;z-index:100001;background:#080e19f5;display:flex;justify-content:center;align-items:flex-start;padding:5vh 14px 30px;overflow:auto;color:#edf2ff;font:14px/1.55 system-ui,sans-serif}
 #ssCloudReportViewer .ssc-report-review-panel{width:min(100%,720px);border:1px solid #4c5679;border-radius:17px;padding:24px;background:#151e30;box-shadow:0 25px 70px #000a}
 #ssCloudReportViewer .ssc-report-review-head{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;border-bottom:1px solid #34415c;padding-bottom:13px}
 #ssCloudReportViewer h2{font-size:22px;margin:0}
 #ssCloudReportViewer button{cursor:pointer;background:#293852;border:1px solid #536b90;color:#eef2ff;border-radius:9px;padding:10px 12px;font:inherit}
 #ssCloudReportViewer button:disabled{opacity:.5;cursor:wait}
 #ssCloudReportViewer .ssc-report-review-field{padding:10px 0;border-bottom:1px solid #2b3850}
 #ssCloudReportViewer .ssc-report-review-field p{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
 #ssCloudReportViewer .ssc-report-review-image{display:block;max-width:min(100%,310px);max-height:280px;object-fit:contain;border:1px solid #455674;border-radius:10px;margin:15px auto}
 #ssCloudReportViewer .ssc-report-review-actions{display:flex;gap:10px;flex-wrap:wrap;padding-top:10px}
 #ssCloudReportViewer .ssc-report-review-status{color:#ffb9ad;min-height:19px}
 #ssCloudStaffDialog .ssc-report-history-item{display:grid;gap:7px;padding:13px 0;border-bottom:1px solid #34415c;overflow-wrap:anywhere}
 #ssCloudStaffDialog .ssc-report-history-item small{color:#b1c0d7}
 #ssCloudStaffDialog .ssc-report-history-item summary{cursor:pointer;color:#ccc7ff}
 #ssCloudStaffDialog .ssc-report-history-item[hidden]{display:none!important}

 @media(max-width:720px){#ssCloudStaffDialog .ssc-user{align-items:flex-start}#ssCloudStaffDialog .ssc-user select{max-width:100%}}
`;document.head.append(style)}
addStyling();
if(!ready){
 // GitHub-only version works normally, but stays local; make this crystal clear.
 const banner=document.createElement('div');banner.id='ssCloudSetupBanner';banner.setAttribute('role','status');banner.textContent='☁ GitHub-only mode: accounts, bans and study saves stay in this browser. Set up Supabase and edit cloud-config.js for cross-device accounts.';
 banner.style.cssText='position:relative;z-index:3;background:#1c2940;border:1px solid #405277;color:#dbe6ff;padding:9px 14px;font:12px/1.6 system-ui,sans-serif;text-align:center';document.body.prepend(banner);return;
}
showGate('loading');
function startCloud(){if(!window.supabase?.createClient){cloudNotice('Cloud library failed to load. Reload with an internet connection.');return}
 client=window.supabase.createClient(cfg.url.trim().replace(/\/$/,''),cfg.publishableKey.trim());window.dispatchEvent(new Event('ss-public-profiles-ready'));boot()}
if(window.supabase?.createClient)startCloud();
else {const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';script.onload=startCloud;
 script.onerror=()=>cloudNotice('Could not load the Cloud library. Check your internet connection or browser extensions.');document.head.append(script)}
})();
