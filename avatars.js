/* StudySpire Cloud profile pictures v3.92.
   All image uploads, report submissions, staff restrictions and removals are
   independently authorized by the Supabase RPCs. No service key in browser. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const bridge=()=>window.StudySpireAvatarBridge;
const account=()=>bridge()?.state?.()||null;
const rpc=async(name,args={})=>{
  const b=bridge();
  if(!b?.state?.())throw Error('Sign in to StudySpire Cloud first.');
  return b.rpc(name,args);
};
const validImage=value=>
  typeof value==='string'&&value.length<95000
  &&/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)?value:null;
const validUsername=value=>/^[a-z0-9_-]{3,32}$/.test(String(value||''));
const node=(tag,text,cls)=>{
  const el=document.createElement(tag);
  if(text!==undefined&&text!==null)el.textContent=String(text);
  if(cls)el.className=cls;
  return el;
};
const button=(label,fn,cls='ss-avatar-button')=>{
  const el=node('button',label,cls);el.type='button';el.addEventListener('click',fn);return el;
};
const status=(host,message,bad=false)=>{
  if(host){host.textContent=message;host.classList.toggle('error',!!bad)}
};
let overlay=null,dialogBody=null,dialogStatus=null,backFocus=null,lastUsername='',me=null;
const avatarCache=new Map();
const currentAvatar=()=>document.querySelector('#sdTopAccount .ss-account-avatar');
function paint(el,image,initial='👤'){
  if(!el)return;
  const safe=validImage(image);
  el.classList.toggle('ss-has-profile-picture',!!safe);
  if(safe){
    el.style.backgroundImage='url("'+safe+'")';
    el.textContent='';
  }else{
    el.style.backgroundImage='';
    el.textContent=initial;
  }
}
function ensureDialog(){
  if(overlay)return;
  overlay=node('div',null,'ss-avatar-overlay');overlay.id='ssAvatarOverlay';overlay.hidden=true;
  overlay.innerHTML='<section class="ss-avatar-modal" role="dialog" aria-modal="true" aria-labelledby="ssAvatarTitle">'+
    '<header><div><span class="ss-avatar-kicker">STUDYSPIRE CLOUD</span><h2 id="ssAvatarTitle">Profile picture</h2></div>'+
    '<button id="ssAvatarClose" class="ss-avatar-close" type="button" aria-label="Close profile picture">✕</button></header>'+
    '<div id="ssAvatarBody" class="ss-avatar-body"></div>'+
    '<p id="ssAvatarStatus" class="ss-avatar-status" role="status" aria-live="polite"></p></section>';
  document.body.append(overlay);
  dialogBody=$('ssAvatarBody');dialogStatus=$('ssAvatarStatus');
  $('ssAvatarClose').addEventListener('click',close);
  overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
  document.addEventListener('keydown',e=>{
    if(!overlay||overlay.hidden)return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();return}
    if(e.key!=='Tab')return;
    const items=[...overlay.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href]')].filter(n=>n.offsetParent!==null);
    if(!items.length)return;
    const first=items[0],last=items[items.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  },true);
}
function close(){
  if(!overlay||overlay.hidden)return;
  overlay.hidden=true;
  if(backFocus?.isConnected)backFocus.focus({preventScroll:true});
}
function openShell(title){
  ensureDialog();backFocus=document.activeElement;
  $('ssAvatarTitle').textContent=title;
  dialogBody.replaceChildren();status(dialogStatus,'');
  overlay.hidden=false;$('ssAvatarClose')?.focus({preventScroll:true});
}
function preview(data,initial='👤'){
  const el=node('div',null,'ss-avatar-preview');
  paint(el,data,initial);
  return el;
}
async function readImage(file){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))
    throw Error('Choose a JPG, PNG, or WebP photo.');
  if(file.size>4*1024*1024)throw Error('Choose an image smaller than 4 MB.');
  const bitmap=await new Promise((resolve,reject)=>{
    const image=new Image(),url=URL.createObjectURL(file);
    image.onload=()=>{URL.revokeObjectURL(url);resolve(image)};
    image.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Unable to read that image.'))};
    image.src=url;
  });
  if(!bitmap.naturalWidth||!bitmap.naturalHeight||
     bitmap.naturalWidth>6000||bitmap.naturalHeight>6000)
    throw Error('Image dimensions are unsupported.');
  const canvas=document.createElement('canvas');canvas.width=192;canvas.height=192;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Image processing is not supported in this browser.');
  const width=bitmap.naturalWidth,height=bitmap.naturalHeight,side=Math.min(width,height);
  ctx.drawImage(bitmap,(width-side)/2,(height-side)/2,side,side,0,0,192,192);
  // Canvas export strips embedded image metadata and converts to a small square WebP.
  for(const quality of [.82,.7,.56,.42,.28]){
    const compressed=canvas.toDataURL('image/webp',quality);
    const payload=validImage(compressed);
    if(payload&&Math.ceil((payload.length-23)*3/4)<=65536)return payload;
  }
  throw Error('The photo is still too large after compression. Try a simpler picture.');
}
function updateHeader(){
  const user=account();const image=user&&me?.username===user.username?me?.image_data:null;
  const initial=user?.username?.[0]?.toUpperCase()||'👤';
  paint(currentAvatar(),image,initial);
  const side=document.querySelector('.sd-profile-icon');
  if(side)paint(side,image,initial);
}
function notifyChanged(){
  window.dispatchEvent(new Event('ss-avatar-updated'));
  updateHeader();
}
async function refreshOwn(){
  const user=account();
  if(!user){me=null;lastUsername='';avatarCache.clear();updateHeader();return}
  if(lastUsername!==user.username){lastUsername=user.username;me=null;avatarCache.clear();updateHeader()}
  try{
    const result=await rpc('ss_avatar_me');
    if(account()?.username!==user.username)return;
    me=result||null;
    if(result?.username)avatarCache.set(result.username,result.image_data||null);
    updateHeader();
  }catch(e){console.warn('Could not refresh profile picture:',e.message)}
}
async function openOwn(){
  if(!account())return;
  openShell('Your profile & bio');
  status(dialogStatus,'Loading your account picture…');
  try{
    const response=await rpc('ss_avatar_me');
    const profile=await rpc('ss_public_profile',{chosen_username:response.username});
    me=response;updateHeader();
    const block=node('div',null,'ss-avatar-edit-layout');
    const pic=preview(response.image_data,response.username[0]?.toUpperCase());
    const side=node('div',null,'ss-avatar-edit-fields');
    const ownName=node('strong','@'+response.username);
    side.append(ownName);
    window.StudySpireRoles?.decorateLabel(ownName,response.username,account()?.role);
    const bioLabel=node('label','Your bio · 180 characters max');
    bioLabel.htmlFor='ssAvatarBio';
    const bioField=node('textarea');bioField.id='ssAvatarBio';bioField.rows=3;bioField.maxLength=180;
    bioField.placeholder='Write a little about yourself or your favorite school subjects…';
    bioField.value=profile?.bio||'';
    bioField.setAttribute('aria-label','Edit your account bio');
    const saveBio=button('Save bio',async()=>{
      saveBio.disabled=true;
      try{
        const proposed=bioField.value.trim();
        if(proposed)await window.StudySpireContentSafety.review('bio',proposed);
        const saved=await rpc('ss_profile_set_bio',{new_bio:proposed});
        bioField.value=saved.bio||'';
        status(dialogStatus,'Bio saved. Anyone can view it on your profile.');
        window.StudySpireRoles?.refreshLabels();
      }catch(e){status(dialogStatus,e.message,true)}
      finally{saveBio.disabled=false}
    },'ss-avatar-button secondary');
    const bioArea=node('div',null,'ss-avatar-bio-editor');
    bioArea.append(bioLabel,bioField,saveBio);
    side.append(bioArea);
    const info=node('p','Profile pictures are visible to other signed-in StudySpire users.','ss-avatar-hint');
    side.append(info);
    const blocked=Boolean(response.restricted);
    if(blocked)side.append(node('p','Uploads are restricted by staff. You can still remove your current picture.','ss-avatar-restricted'));
    const file=node('input');file.type='file';file.accept='image/png,image/jpeg,image/webp';
    file.id='ssAvatarFile';file.setAttribute('aria-label','Choose a profile picture');
    file.disabled=blocked;
    const actions=node('div',null,'ss-avatar-actions');
    const upload=button('Save picture',async()=>{
      const selected=file.files?.[0];if(!selected){status(dialogStatus,'Choose a photo first.',true);return}
      upload.disabled=true;
      try{
        status(dialogStatus,'Resizing your picture…');
        const encoded=await readImage(selected);
        status(dialogStatus,'Scanning picture for safe content…');
        await window.StudySpireContentSafety.review('avatar',encoded);
        status(dialogStatus,'Saving your picture…');
        const result=await rpc('ss_avatar_set',{p_image_data:encoded});
        me=result;avatarCache.set(result.username,result.image_data||null);
        paint(pic,result.image_data,result.username[0]?.toUpperCase());
        status(dialogStatus,'Profile picture saved.');
        notifyChanged();
      }catch(e){status(dialogStatus,e.message,true)}
      finally{upload.disabled=blocked}
    });
    upload.disabled=blocked;
    const remove=button('Remove picture',async()=>{
      if(!response.image_data&&!me?.image_data)return;
      remove.disabled=true;
      try{
        const result=await rpc('ss_avatar_set',{p_image_data:null});
        me=result;avatarCache.set(result.username,null);
        paint(pic,null,result.username[0]?.toUpperCase());file.value='';
        status(dialogStatus,'Profile picture removed.');notifyChanged();
      }catch(e){status(dialogStatus,e.message,true)}
      finally{remove.disabled=false}
    },'ss-avatar-button secondary');
    actions.append(upload,remove);
    side.append(file,actions);block.append(pic,side);dialogBody.replaceChildren(block);
    status(dialogStatus,'');
  }catch(e){status(dialogStatus,e.message,true)}
}
async function openProfile(username){
  const name=String(username||'').replace(/^@/,'').trim().toLowerCase();
  if(!validUsername(name))return;
  if(account()?.username===name)return openOwn();
  if(!account())return;
  openShell('Profile picture · @'+name);
  status(dialogStatus,'Loading picture…');
  try{
    const [data,profile]=await Promise.all([
      rpc('ss_avatar_public',{chosen_username:name}),
      rpc('ss_public_profile',{chosen_username:name})
    ]);
    if(!data){status(dialogStatus,'Account not available.',true);return}
    const main=node('div',null,'ss-avatar-profile');
    const pic=preview(data.image_data,name[0].toUpperCase());
    const h=node('strong','@'+name);
    window.StudySpireRoles?.decorateLabel(h,name);
    const bio=node('p',profile?.bio||'No bio yet.','ss-avatar-bio-display');
    const help=node('p',data.image_data?'Profile picture shared with signed-in StudySpire users.':'This account has no profile picture.','ss-avatar-hint');
    main.append(pic,h,bio,help);
    if(data.image_data){
      const reason=node('textarea');reason.id='ssAvatarReportReason';
      reason.placeholder='Describe why this profile picture should be reviewed (10–500 characters)';
      reason.maxLength=500;reason.rows=3;
      reason.setAttribute('aria-label','Reason for reporting profile picture');
      const send=button('Report picture',async()=>{
        const complaint=reason.value.trim();
        if(complaint.length<10){status(dialogStatus,'Please enter a reason of at least 10 characters.',true);return}
        send.disabled=true;
        try{
          await rpc('ss_avatar_report',{chosen_username:name,complaint});
          status(dialogStatus,'Picture reported. Moderators and higher staff can review it.');
          reason.disabled=true;send.textContent='Reported';
        }catch(e){status(dialogStatus,e.message,true);send.disabled=false}
      },'ss-avatar-button report');
      const detail=node('details',null,'ss-avatar-report-details');
      const summary=node('summary','Report this profile picture');
      detail.append(summary,reason,send);main.append(detail);
    }
    dialogBody.replaceChildren(main);status(dialogStatus,'');
  }catch(e){status(dialogStatus,e.message,true)}
}
async function decorate(element,username){
  const name=String(username||'').replace(/^@/,'').toLowerCase();
  if(!validUsername(name)||!element)return;
  paint(element,avatarCache.get(name),name[0].toUpperCase());
  if(!account())return;
  try{
    let image=avatarCache.get(name);
    if(!avatarCache.has(name)){
      const result=await rpc('ss_avatar_public',{chosen_username:name});
      image=result?.image_data||null;avatarCache.set(name,image);
    }
    if(element.isConnected)paint(element,image,name[0].toUpperCase());
  }catch(_){}
}
async function decorateMany(items){
  const users=[...new Set((items||[]).map(x=>String(x?.username||'').toLowerCase()).filter(validUsername))].slice(0,16);
  if(!users.length||!account())return;
  try{
    const result=await rpc('ss_avatar_list',{chosen_usernames:users});
    for(const user of result||[])avatarCache.set(user.username,user.image_data||null);
  }catch(e){console.warn('Unable to load friend pictures:',e.message)}
}
function staffText(content,cl=''){return node('span',content,cl)}
function staffAvatarReportRow(item,refresh){
  const row=node('div',null,'ss-avatar-staff-row');
  const pic=preview(item.image_snapshot,item.target_username?.[0]?.toUpperCase()||'👤');
  pic.classList.add('ss-avatar-staff-thumb');
  const detail=node('div',null,'ss-avatar-staff-detail');
  detail.append(node('strong','@'+item.target_username+' · '+item.target_role),
    node('small','Reported by @'+item.reporter+' · '+new Date(item.created_at).toLocaleString()),
    node('p',item.reason));
  if(item.status!=='open')detail.append(staffText('Resolved · '+item.status,'ss-avatar-muted'));
  else if(!item.can_moderate)detail.append(staffText('Escalate to higher-ranking staff.','ss-avatar-restricted'));
  const controls=node('div',null,'ss-avatar-staff-actions');
  if(item.status==='open'&&item.can_moderate){
    controls.append(
      button('Remove picture',async()=>{
        if(!confirm('Remove the reported picture from @'+item.target_username+'?'))return;
        await staffAction(()=>rpc('ss_avatar_staff_review',{report_id:item.id,decision:'remove'}),refresh);
      },'ss-avatar-button report'),
      button('Dismiss',async()=>{
        await staffAction(()=>rpc('ss_avatar_staff_review',{report_id:item.id,decision:'dismiss'}),refresh);
      },'ss-avatar-button secondary')
    );
  }
  row.append(pic,detail,controls);return row;
}
async function staffAction(action,refresh){
  try{await action();await refresh();notifyChanged()}
  catch(e){alert('Profile picture action failed: '+e.message)}
}
function staffAccountRow(item,refresh){
  const row=node('div',null,'ss-avatar-staff-account');
  const label=node('div');label.append(node('strong','@'+item.username+' · '+item.role),
    node('small',(item.restricted?'Uploads restricted':'Uploads allowed')+(item.has_picture?' · Has picture':'')));
  const controls=node('div',null,'ss-avatar-staff-actions');
  const view=button('View / report',()=>openProfile(item.username),'ss-avatar-button secondary');
  const toggle=button(item.restricted?'Allow uploads':'Restrict uploads',async()=>{
    if(!confirm((item.restricted?'Allow':'Restrict')+' profile picture uploads for @'+item.username+'?'))return;
    await staffAction(()=>rpc('ss_avatar_staff_restrict',{
      target_user:item.id,restrict_uploads:!item.restricted,remove_picture:false
    }),refresh);
  });
  controls.append(view,toggle);
  if(item.has_picture){
    controls.append(button('Remove picture',async()=>{
      if(!confirm('Remove @'+item.username+'’s current profile picture?'))return;
      await staffAction(()=>rpc('ss_avatar_staff_restrict',{
        target_user:item.id,restrict_uploads:item.restricted,remove_picture:true
      }),refresh);
    },'ss-avatar-button secondary'));
  }
  row.append(label,controls);return row;
}
function mountStaff(modal){
  const user=account();
  if(!user||!['moderator','admin','co_owner','owner'].includes(user.role)||!modal)return;
  if(modal.querySelector('#ssAvatarStaffTab'))return;
  const tabs=modal.querySelector('.ssc-staff-tabs'),host=modal.querySelector('.ssc-staffbox');
  if(!tabs||!host)return;
  const tab=button('🖼 Profile pictures',()=>{},'ssc-light');tab.id='ssAvatarStaffTab';
  tab.dataset.staffTab='avatars';
  const section=node('section',null,'ssc-admin-section ss-avatar-staff-pane');
  section.dataset.staffPane='avatars';section.hidden=true;
  const title=node('h3','Profile picture reports and restrictions');
  const desc=node('p','Moderators can review and remove Student pictures. Admins can also restrict Students and Moderators. Owners and Co-Owners can manage other accounts according to their permissions.','ss-avatar-hint');
  const search=node('div',null,'ss-avatar-staff-search');
  const find=node('input');find.type='search';find.placeholder='Exact username to view / report a picture';find.setAttribute('aria-label','Account username');
  const open=button('View picture',()=>{
    const name=find.value.trim().toLowerCase();
    if(!validUsername(name)){staffNotice.textContent='Enter an exact StudySpire username.';return}
    openProfile(name);
  });
  search.append(find,open);
  const reload=button('↻ Refresh',()=>refresh(),'ss-avatar-button secondary');
  const staffNotice=node('p','','ss-avatar-hint');
  const reportTitle=node('h4','Reported pictures');
  const reports=node('div',null,'ss-avatar-reports');
  const accountTitle=node('h4','Manage upload restrictions');
  const accountList=node('div',null,'ss-avatar-accounts');
  if(user.role==='moderator')accountTitle.hidden=accountList.hidden=true;
  section.append(title,desc,search,reload,staffNotice,reportTitle,reports,accountTitle,accountList);
  host.append(section);tabs.append(tab);
  let loading=false;
  async function refresh(){
    if(loading)return;
    loading=true;reload.disabled=true;staffNotice.textContent='Loading profile picture reports…';
    try{
      const data=await rpc('ss_avatar_staff_overview');
      const allReports=Array.isArray(data?.reports)?data.reports:[];
      const allAccounts=Array.isArray(data?.accounts)?data.accounts:[];
      reports.replaceChildren();
      if(!allReports.length)reports.append(node('p','No picture reports yet.','ss-avatar-hint'));
      else for(const item of allReports)reports.append(staffAvatarReportRow(item,refresh));
      accountList.replaceChildren();
      if(user.role!=='moderator'){
        if(!allAccounts.length)accountList.append(node('p','No manageable accounts.','ss-avatar-hint'));
        else for(const item of allAccounts){
          // Cannot restrict your own account (checked again by the server).
          if(item.id!==account()?.id)accountList.append(staffAccountRow(item,refresh));
        }
      }
      staffNotice.textContent=allReports.filter(x=>x.status==='open').length+' open picture report(s).';
    }catch(e){staffNotice.textContent='Could not load reports: '+e.message}
    finally{loading=false;reload.disabled=false}
  }
  // Other built-in staff tabs already hide every section with data-staff-pane.
  // This new tab performs the same switch when clicked.
  tab.addEventListener('click',()=>{
    modal.querySelectorAll('[data-staff-tab]').forEach(other=>{
      const active=other===tab;
      other.classList.toggle('ssc-current',active);
      other.setAttribute('aria-current',active?'page':'false');
    });
    modal.querySelectorAll('[data-staff-pane]').forEach(pane=>pane.hidden=pane!==section);
    void refresh();
  });
  void refresh();
}
function init(){
  const top=$('sdTopAccount');
  if(top&&!top.dataset.ssAvatarHandler){
    top.dataset.ssAvatarHandler='true';
    top.addEventListener('click',event=>{
      if(!account()||!event.target.closest('.ss-account-avatar'))return;
      event.preventDefault();event.stopImmediatePropagation();
      void openOwn();
    },true);
  }
  window.addEventListener('ss-cloud-auth-changed',refreshOwn);
  window.addEventListener('ss-avatar-updated',()=>{
    if(overlay?.hidden)void refreshOwn();
  });
  void refreshOwn();
}
window.StudySpireAvatars={openOwn,openProfile,decorate,decorateMany,mountStaff,refreshOwn};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
})();