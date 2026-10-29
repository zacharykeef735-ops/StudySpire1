/* StudySpire1 organization and school manager. UI permissions are hints;
   Supabase RPCs are the actual security boundary. No external API keys. */
(()=>{
'use strict';
const ID='ssSchoolManager';
let state={is_owner:false,organizations:[]};
let chosenOrg='',chosenSchool='',loading=false,mounted=false;
const byId=id=>document.getElementById(id);
function el(tag,content,cls){
 const n=document.createElement(tag);
 if(cls)n.className=cls;
 if(content!==undefined&&content!==null)n.textContent=String(content);
 return n;
}
function action(text,callback,cls='ss-sm-btn'){
 const b=el('button',text,cls);b.type='button';b.addEventListener('click',callback);return b;
}
function field(label,placeholder,value=''){
 const holder=el('label',null,'ss-sm-field'),span=el('span',label);
 const input=el('input');input.type='text';input.required=true;input.maxLength=100;
 input.placeholder=placeholder;input.value=value;
 holder.append(span,input);return {holder,input};
}
function formButton(label,handler,fields,opts={}){
 const form=el('form',null,'ss-sm-form');
 const row=el('div',null,'ss-sm-form-fields');
 for(const f of fields)row.append(f.holder);
 const submit=el('button',label,'ss-sm-btn ss-sm-primary');submit.type='submit';
 form.append(row,submit);
 form.addEventListener('submit',async ev=>{
  ev.preventDefault();
  if(loading)return;
  await perform(async()=>handler(...fields.map(f=>f.input.value.trim())),label);
 });
 return form;
}
function info(text){const n=byId('ssSchoolNotice');if(n){n.textContent=text||'';n.hidden=!text}}
function bridge(){const b=window.StudySpireSchoolBridge;if(!b?.ready?.())throw Error('Sign in to StudySpire Cloud first');return b}
function selectedOrg(){return state.organizations.find(o=>o.id===chosenOrg)||null}
function selectedSchool(org){return org?.schools?.find(s=>s.id===chosenSchool)||null}
function isPlatformLead(){const p=window.StudySpireSchoolBridge?.account?.();return ['owner','co_owner'].includes(p?.role)}
async function perform(fn,description){
 if(loading)return;loading=true;const root=byId(ID);root?.classList.add('ss-sm-busy');
 info('Saving '+description+'…');
 try{await fn();await refresh(true);info(description+' saved.')}
 catch(err){info('Could not save: '+String(err?.message||err))}
 finally{loading=false;root?.classList.remove('ss-sm-busy')}
}
function makeManager(){
 if(byId(ID))return;
 const root=el('div',null,'ss-sm-overlay');root.id=ID;root.hidden=true;
 root.innerHTML='<section class="ss-sm-panel" role="dialog" aria-modal="true" aria-labelledby="ssSchoolHeading" tabindex="-1">'+
 '<header class="ss-sm-heading"><div><small>STUDYSPIRE1 · SCHOOL CLOUD</small><h2 id="ssSchoolHeading">Organizations & Schools</h2><p>Owner-managed districts, schools and role permissions</p></div>'+
 '<button class="ss-sm-close" id="ssSchoolClose" type="button" aria-label="Close school management">✕ Close</button></header>'+
 '<p id="ssSchoolNotice" class="ss-sm-notice" role="status" aria-live="polite" hidden></p>'+
 '<div class="ss-sm-columns"><aside class="ss-sm-organizations" id="ssSchoolOrganizations"></aside><main class="ss-sm-content" id="ssSchoolDetails"></main></div></section>';
 document.body.append(root);
 byId('ssSchoolClose').onclick=close;
 root.addEventListener('click',e=>{if(e.target===root)close()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!root.hidden)close()});
}
function close(){const root=byId(ID);if(root)root.hidden=true}
function open(){
 makeManager();const root=byId(ID);root.hidden=false;
 root.querySelector('.ss-sm-panel').focus();void refresh(true);
}
function mountNav(){
 if(mounted)return;
 makeManager();
 const nav=document.querySelector('.sidebar .sd-nav-group .nav')||document.querySelector('.sidebar .nav');
 if(nav){
  const b=action('','');
  b.id='ssSchoolsNav';b.className='ss-sm-nav';b.innerHTML='<span class="navicon">🏫</span><span class="sd-navtext">Organizations & Schools</span>';
  b.replaceWith; // No-op property reference; nothing is inserted until after handler installation.
  b.addEventListener('click',open);nav.append(b);
 }
 const top=document.querySelector('.topright');
 if(top){const b=action('🏫 Schools',open,'btn secondary small');b.id='ssSchoolsTop';top.append(b)}
 const quick=document.querySelector('.sd-dashboard-actions');
 if(quick){
  const b=action('🏫 Organizations & Schools',open);b.id='ssSchoolsQuick';
  b.className='ss-sm-quick';quick.append(b);
 }
 mounted=true;showLaunchers(false);
}
function showLaunchers(show){
 for(const id of ['ssSchoolsNav','ssSchoolsTop','ssSchoolsQuick']){const n=byId(id);if(n)n.hidden=!show}
}
function heading(text,sub){
 const wrap=el('div',null,'ss-sm-section-heading');
 wrap.append(el('h3',text));
 if(sub)wrap.append(el('p',sub));return wrap;
}
function addPill(text,cls=''){
 return el('span',text,'ss-sm-pill '+cls);
}
function renderLeft(){
 const host=byId('ssSchoolOrganizations');if(!host)return;
 host.replaceChildren(heading('Organizations','Choose an organization to see its schools.'));
 for(const org of state.organizations){
  const b=action('',()=>{chosenOrg=org.id;chosenSchool=org.schools?.[0]?.id||'';render()});
  b.className='ss-sm-org '+(org.id===chosenOrg?'selected':'');
  b.append(el('strong',org.name),el('small',org.code));
  host.append(b);
 }
 if(!state.organizations.length)host.append(el('p',state.is_owner?'Create your first organization below.':'No schools are assigned to this account yet.','ss-sm-muted'));
 if(state.is_owner){
  host.append(heading('New organization','Only platform Owners and Co-Owners can create organizations.'));
  const a=field('Organization name','e.g. North District'),b=field('Organization code','e.g. north-district');
  host.append(formButton('＋ Create organization',async(name,code)=>{
   const id=await bridge().rpc('ss_school_create_organization',{p_name:name,p_code:code});
   if(id){chosenOrg=id;chosenSchool=''}
  },[a,b]));
 }
}
function renderAdminSection(host,org){
 if(!org.can_manage_org)return;
 const block=el('section',null,'ss-sm-card');
 block.append(heading('Organization administrators','Admins can manage schools and assign principals in this organization. They cannot become platform Owners.'));
 const admins=el('div',null,'ss-sm-lines');
 for(const admin of org.admins||[]){
  const row=el('div',null,'ss-sm-line');
  row.append(el('span','@'+admin.username));
  if(org.can_assign_admin)row.append(action('Remove admin',()=>perform(
   ()=>bridge().rpc('ss_school_set_admin',{p_organization:org.id,p_username:admin.username,p_enabled:false}),
   'admin removal'),'ss-sm-btn ss-sm-danger'));
  block.append(row);
 }
 if(!(org.admins||[]).length)block.append(el('p','No organization admins yet.','ss-sm-muted'));
 if(org.can_assign_admin){
  const u=field('StudySpire username','existing-username');
  block.append(formButton('＋ Appoint org admin',async username=>{
   if(!confirm('Give @'+username+' organization admin permissions for '+org.name+'?'))return;
   await bridge().rpc('ss_school_set_admin',{p_organization:org.id,p_username:username,p_enabled:true});
  },[u]));
 }
 host.append(block);
}
function renderSchoolTools(host,org){
 if(!org.can_manage_org)return;
 const block=el('section',null,'ss-sm-card');
 block.append(heading('Add a school','Organization admins and platform Owners can create schools.'));
 const n=field('School name','e.g. Central High School'),c=field('School code','central-high');
 block.append(formButton('＋ Create school',async(name,code)=>{
  const id=await bridge().rpc('ss_school_create_school',{p_organization:org.id,p_name:name,p_code:code});
  if(id)chosenSchool=id;
 },[n,c]));host.append(block);
}
function renderSchool(host,org,school){
 const block=el('section',null,'ss-sm-card');
 const h=heading(school.name,'School code: '+school.code);
 const cap=el('div',null,'ss-sm-tags');
 cap.append(addPill(school.my_role?'Your role: '+school.my_role:'School access via organization'));
 if(school.can_assign_principal)cap.append(addPill('Manage principals'));
 if(school.can_create_class)cap.append(addPill('Create classes'));
 block.append(h,cap);
 // The roster is returned ONLY for platform Owners, org admins and school principals.
 const roster=el('div',null,'ss-sm-roster');
 roster.append(heading('School staff & members','Assignments belong to this school only.'));
 if(!school.can_manage_members){
  roster.append(el('p','School leaders manage the private member list.','ss-sm-muted'));
 }else{
  if(!(school.members||[]).length)roster.append(el('p','No principal, teacher or student accounts assigned yet.','ss-sm-muted'));
  for(const member of school.members||[]){
   const row=el('div',null,'ss-sm-line');
   row.append(el('span','@'+member.username),addPill(member.role));
   if(member.role!=='principal'||school.can_assign_principal){
    row.append(action('Remove',()=>perform(
      ()=>bridge().rpc('ss_school_set_member',{p_school:school.id,p_username:member.username,p_role:'remove'}),
      'member removal'),'ss-sm-btn ss-sm-danger'));
   }
   roster.append(row);
  }
  const u=field('Existing StudySpire username','student-or-staff');
  const r=el('label',null,'ss-sm-field');r.append(el('span','School role'));
  const select=el('select');select.required=true;
  const roles=school.can_assign_principal?['principal','teacher','student']:['teacher','student'];
  for(const role of roles){const option=el('option',role==='principal'?'Principal':role==='teacher'?'Teacher':'Student');option.value=role;select.append(option)}
  r.append(select);
  roster.append(formButton('Assign school role',async(username)=>{
   const role=select.value;
   if(!confirm('Assign @'+username+' as '+role+' at '+school.name+'?'))return;
   await bridge().rpc('ss_school_set_member',{p_school:school.id,p_username:username,p_role:role});
  },[u,r]));
 }
 block.append(roster);
 const classes=el('div',null,'ss-sm-roster');
 classes.append(heading('Classes','Only school principals and platform Owners can create classes.'));
 for(const course of school.classes||[]){
  const line=el('div',null,'ss-sm-line');
  line.append(el('strong',course.title),el('small',course.subject||'General'));
  classes.append(line);
 }
 if(!(school.classes||[]).length)classes.append(el('p','No classes created yet.','ss-sm-muted'));
 if(school.can_create_class){
  const title=field('Class name','e.g. Algebra I'),subject=field('Subject','Mathematics');
  classes.append(formButton('＋ Create class',async(t,s)=>{
   await bridge().rpc('ss_school_create_class',{p_school:school.id,p_title:t,p_subject:s});
  },[title,subject]));
 }
 block.append(classes);host.append(block);
}
function renderRight(){
 const host=byId('ssSchoolDetails');if(!host)return;host.replaceChildren();
 const org=selectedOrg();
 if(!org){
  host.append(heading('School Management','Select an organization or create one to start.'));
  if(!state.is_owner)host.append(el('p','An Owner or organization administrator can assign your account to a school.','ss-sm-muted'));
  return;
 }
 const top=el('div',null,'ss-sm-org-head');
 top.append(heading(org.name,'Organization: '+org.code));
 top.append(addPill(org.can_manage_org?'Management access':'Member access'));
 host.append(top);
 renderAdminSection(host,org);
 const schools=el('section',null,'ss-sm-card');
 schools.append(heading('Schools','Each school has its own principals, teachers, students and classes.'));
 const buttons=el('div',null,'ss-sm-school-tabs');
 for(const s of org.schools||[]){
  const b=action(s.name,()=>{chosenSchool=s.id;render()});
  b.className='ss-sm-btn '+(s.id===chosenSchool?'ss-sm-selected':'');buttons.append(b);
 }
 if(!(org.schools||[]).length)buttons.append(el('p','No schools available yet.','ss-sm-muted'));
 schools.append(buttons);host.append(schools);
 renderSchoolTools(host,org);
 const current=selectedSchool(org);
 if(current)renderSchool(host,org,current);
}
function render(){
 renderLeft();renderRight();
}
async function refresh(force){
 const api=window.StudySpireSchoolBridge;
 if(!api?.ready?.()){
  state={is_owner:false,organizations:[]};showLaunchers(false);close();return;
 }
 try{
  const response=await api.rpc('ss_school_overview');
  state={is_owner:response?.is_owner===true,organizations:Array.isArray(response?.organizations)?response.organizations:[]};
  if(!state.organizations.some(o=>o.id===chosenOrg))chosenOrg=state.organizations[0]?.id||'';
  const org=selectedOrg();
  if(!org?.schools?.some(s=>s.id===chosenSchool))chosenSchool=org?.schools?.[0]?.id||'';
  showLaunchers(state.is_owner||state.organizations.length>0);
  render();
 }catch(err){
  showLaunchers(isPlatformLead());
  if(byId(ID)&&!byId(ID).hidden){
   info('School setup is not active: '+String(err?.message||err)+'. Run studyspire1-organizations-schools.sql in the correct Supabase project.');
  }
 }
}
function onAuth(){
 if(!mounted)mountNav();
 void refresh();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{mountNav();if(window.StudySpireSchoolBridge?.ready?.())onAuth()},{once:true});
else {mountNav();if(window.StudySpireSchoolBridge?.ready?.())onAuth()}
window.addEventListener('ss-cloud-auth-changed',onAuth);
window.StudySpireSchoolManager={open,refresh:()=>refresh(true)};
})();