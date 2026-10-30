/* StudySpire1 Schools — same StudySpire experience, optional school integration.
 * Permissions are enforced server-side by Supabase, not by button visibility. */
(()=>{'use strict';
const ID='ssSchoolManager',KEY='ss1-active-school';
const $=id=>document.getElementById(id);
const make=(tag,value,cls)=>{const n=document.createElement(tag);if(value!=null)n.textContent=String(value);if(cls)n.className=cls;return n};
const btn=(label,fn,cls='ss-sm-btn')=>{const b=make('button',label,cls);b.type='button';b.onclick=fn;return b};
const P={
 manage_schools:'Create and manage schools',
 appoint_principals:'Appoint school principals',
 manage_enrollment:'Manage student enrollment',
 view_analytics:'View school analytics',
 publish_announcements:'Publish school announcements',
 manage_settings:'Manage school settings'
};
let data={is_owner:false,schools:[]},schoolId='',applications=[],pending=[],busy=false,sequence=0,mounted=false;
const api=()=>{const b=window.StudySpireSchoolBridge;if(!b?.ready?.())throw Error('Sign in to StudySpire Cloud first');return b};
const school=()=>data.schools.find(s=>s.id===schoolId)||null;
function note(message=''){const el=$('ssSchoolNotice');if(el){el.textContent=message;el.hidden=!message}}
function heading(label,subtitle){const n=make('div',null,'ss-sm-section-heading');n.append(make('h3',label));if(subtitle)n.append(make('p',subtitle));return n}
function field(label,placeholder='',value='',type='text'){
 const wrap=make('label',null,'ss-sm-field'),name=make('span',label);
 const input=document.createElement(type==='textarea'?'textarea':'input');
 if(type!=='textarea')input.type=type;
 input.value=String(value||'');input.placeholder=placeholder;input.maxLength=type==='textarea'?2000:160;input.required=true;
 wrap.append(name,input);return {wrap,input};
}
function form(label,fields,submit){
 const f=make('form',null,'ss-sm-form'),area=make('div',null,'ss-sm-form-fields');
 for(const {wrap} of fields)area.append(wrap);
 const b=btn(label,null,'ss-sm-btn ss-sm-primary');b.type='submit';
 f.append(area,b);
 f.onsubmit=e=>{e.preventDefault();void perform(label,()=>submit(...fields.map(x=>x.input.value.trim())))};
 return f;
}
async function perform(label,callback){
 if(busy)return;busy=true;const root=$(ID);root?.classList.add('ss-sm-busy');note(label+'…');
 try{const res=await callback();if(res===false){note('No changes made.');return}
  await refresh();note(label+' completed.')}
 catch(e){note('Could not complete '+label+': '+String(e?.message||e))}
 finally{busy=false;root?.classList.remove('ss-sm-busy')}
}
function mount(){
 if(mounted)return;mounted=true;
 const root=make('div',null,'ss-sm-overlay');root.id=ID;root.hidden=true;
 root.innerHTML='<section class="ss-sm-panel" role="dialog" aria-modal="true" aria-labelledby="ssSchoolHeading" tabindex="-1"><header class="ss-sm-heading"><div><small>STUDYSPIRE1 · CONNECTED SCHOOLS</small><h2 id="ssSchoolHeading">🏫 Schools</h2><p>All your normal StudySpire tools, plus classes and school features</p></div><button id="ssSchoolClose" type="button">✕ Close</button></header><p class="ss-sm-notice" id="ssSchoolNotice" role="status" aria-live="polite" hidden></p><div class="ss-sm-columns"><aside class="ss-sm-organizations" id="ssSchoolList"></aside><main class="ss-sm-content" id="ssSchoolDetail"></main></div></section>';
 document.body.append(root);$('ssSchoolClose').onclick=close;
 root.addEventListener('click',e=>{if(e.target===root)close()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!root.hidden)close()});
 const add=(host,label,cls)=>{if(!host)return;const b=btn(label,open,cls);b.id=cls==='ss-sm-nav'?'ssSchoolsNav':cls==='ss-sm-quick'?'ssSchoolsQuick':'ssSchoolsTop';host.append(b)};
 add(document.querySelector('.sidebar .sd-nav-group .nav')||document.querySelector('.sidebar .nav'),'🏫 Schools','ss-sm-nav');
 add(document.querySelector('.sd-dashboard-actions'),'🏫 My School','ss-sm-quick');
 add(document.querySelector('.topright'),'🏫 Schools','btn secondary small');
 showLaunchers(false);
}
function showLaunchers(show){
 for(const id of ['ssSchoolsNav','ssSchoolsTop','ssSchoolsQuick']){const node=$(id);if(node)node.hidden=!show}
}
function open(){if(!mounted)mount();$(ID).hidden=false;$(ID).querySelector('.ss-sm-panel').focus();void refresh()}
function close(){if($(ID))$(ID).hidden=true}
function side(){
 const host=$('ssSchoolList');if(!host)return;host.replaceChildren();
 host.append(heading('My Schools',data.is_owner?'Manage any school':'Your school accounts'));
 for(const s of data.schools){
  const b=btn('',()=>{schoolId=s.id;try{localStorage.setItem(KEY,schoolId)}catch{}draw();void loadPending()});
  b.className='ss-sm-org'+(s.id===schoolId?' selected':'');
  b.append(make('strong',s.name),make('small',s.my_role?'Member · '+s.my_role:s.is_admin?'School admin':'School management'));
  host.append(b);
 }
 if(!data.schools.length)host.append(make('p','You are not part of a school yet. Apply using a school code.','ss-sm-muted'));
 if(data.is_owner){
  const card=make('section',null,'ss-sm-card');
  card.append(heading('Create school','Only the platform Owner creates schools. No organization setup required.'));
  const n=field('School name','e.g. Central High School'),c=field('School join code','e.g. central-high');
  card.append(form('＋ Create school',[n,c],async(name,code)=>{
   const result=await api().rpc('ss1_school_create',{p_name:name,p_code:code});
   if(result)schoolId=result;
  }));
  host.append(card);
 }
}
function join(){
 const host=make('section',null,'ss-sm-card');
 host.append(heading('Join a School','Enter one code. A school leader must approve your request.'));
 const code=field('School code','e.g. central-high'),reason=field('Message (optional)','Why you are requesting access');
 reason.input.required=false;reason.input.maxLength=300;
 const wrap=make('label',null,'ss-sm-field');wrap.append(make('span','Join as'));
 const role=make('select');for(const val of ['student','teacher']){const opt=make('option',val==='student'?'Student':'Teacher');opt.value=val;role.append(opt)}wrap.append(role);
 const f=form('Request to join',[code,{wrap,input:role},reason],async(c,r,n)=>api().rpc('ss1_school_request_join',{p_code:c,p_role:r,p_note:n}));
 host.append(f);
 const section=make('div',null,'ss-sm-roster');section.append(heading('My applications','Applications are not enrollments until approved.'));
 for(const request of applications){
  const row=make('div',null,'ss-sm-line');row.append(make('strong',request.school_name||'School'),make('span',request.status||'pending'));
  if(request.status==='pending')row.append(btn('Cancel',()=>perform('Cancel request',()=>api().rpc('ss_school_cancel_join',{p_request:request.id})),'ss-sm-btn ss-sm-danger'));
  section.append(row);
 }
 if(!applications.length)section.append(make('p','No applications yet.','ss-sm-muted'));
 host.append(section);
 return host;
}
function getRights(s){return s.permissions||{}}
function adminTools(s){
 if(!data.is_owner)return null;
 const host=make('section',null,'ss-sm-card'),h=heading('School administrators','Assign existing StudySpire accounts, then customize what each admin can do.');
 host.append(h);
 const username=field('Existing username','studyspire-username');
 host.append(form('＋ Appoint school admin',[username],async u=>{
  if(!confirm('Appoint @'+u+' as a school admin at '+s.name+'?'))return false;
  return api().rpc('ss1_school_set_admin',{p_school:s.id,p_username:u,p_enabled:true});
 }));
 for(const admin of s.admins||[]){
  const panel=make('div',null,'ss-sm-admin-permissions');
  const line=make('div',null,'ss-sm-line');
  line.append(make('strong','🛡 @'+admin.username));
  line.append(btn('Remove admin',()=>{if(confirm('Revoke school administrator access for @'+admin.username+'?'))void perform('Remove school admin',()=>api().rpc('ss1_school_set_admin',{p_school:s.id,p_username:admin.username,p_enabled:false}))},'ss-sm-btn ss-sm-danger'));
  panel.append(line);
  const grid=make('div',null,'ss-sm-permission-grid');
  for(const [name,label] of Object.entries(P)){
   const wrap=make('label',null,'ss-sm-permission-row'),check=make('input');
   check.type='checkbox';check.checked=admin.permissions?.[name]===true;
   wrap.append(make('span',label),check);
   check.onchange=()=>{
    const enabled=check.checked;check.disabled=true;
    void perform('Update permission',()=>api().rpc('ss1_school_set_permission',{
     p_school:s.id,p_username:admin.username,p_permission:name,p_enabled:enabled
    })).finally(()=>{check.disabled=false});
   };
   grid.append(wrap);
  }
  panel.append(grid);host.append(panel);
 }
 return host;
}
function roster(s){
 const rights=getRights(s);
 if(!(rights.manage_enrollment||rights.appoint_principals||s.my_role==='principal'))return null;
 const host=make('section',null,'ss-sm-card');
 host.append(heading('School members','Principals, teachers, and students are assigned to this school only.'));
 for(const member of s.members||[]){
  const row=make('div',null,'ss-sm-line');row.append(make('strong','@'+member.username),make('small',member.role));
  const mayRemove=member.role==='principal'?rights.appoint_principals:(rights.manage_enrollment||s.my_role==='principal');
  if(mayRemove)row.append(btn('Remove',()=>{if(confirm('Remove @'+member.username+' from this school?'))void perform('Remove school member',()=>api().rpc('ss1_school_set_member',{p_school:s.id,p_username:member.username,p_role:'remove'}))},'ss-sm-btn ss-sm-danger'));
  host.append(row);
 }
 if(rights.manage_enrollment||rights.appoint_principals||s.my_role==='principal'){
  const username=field('Existing username','school-user');
  const wrap=make('label',null,'ss-sm-field');wrap.append(make('span','School role'));
  const role=make('select');
  const opts=rights.appoint_principals?['principal','teacher','student']:['teacher','student'];
  for(const item of opts){const o=make('option',item);o.value=item;role.append(o)}
  wrap.append(role);
  host.append(form('Assign school role',[username,{wrap,input:role}],(u,r)=>api().rpc('ss1_school_set_member',{
   p_school:s.id,p_username:u,p_role:r
  })));
 }
 return host;
}
function applicationsPanel(s){
 if(!(getRights(s).manage_enrollment||s.my_role==='principal'))return null;
 const host=make('section',null,'ss-sm-card');
 host.append(heading('Join requests','Approve applications before giving anyone access.'));
 if(!pending.length)host.append(make('p','No pending requests for this school.','ss-sm-muted'));
 for(const req of pending){
  const row=make('div',null,'ss-sm-line');
  row.append(make('strong','@'+req.username+' · '+req.role),make('small',req.note||'No message'));
  row.append(btn('Approve',()=>perform('Approve request',()=>api().rpc('ss1_school_review_join',{p_request:req.id,p_approve:true})),'ss-sm-btn ss-sm-primary'));
  row.append(btn('Decline',()=>perform('Decline request',()=>api().rpc('ss1_school_review_join',{p_request:req.id,p_approve:false})),'ss-sm-btn ss-sm-danger'));
  host.append(row);
 }
 return host;
}
function announcementPanel(s){
 const rights=getRights(s),host=make('section',null,'ss-sm-card');
 host.append(heading('School announcements','Updates are visible only to school members and authorized staff.'));
 for(const item of s.announcements||[]){
  const card=make('div',null,'ss-sm-announcement');
  card.append(make('strong',item.title),make('small',new Date(item.created_at).toLocaleDateString()),make('p',item.body));
  host.append(card);
 }
 if(!(s.announcements||[]).length)host.append(make('p','No announcements yet.','ss-sm-muted'));
 if(rights.publish_announcements||s.my_role==='principal'){
  const title=field('Announcement title','Event or school update'),body=field('Message','What should members know?','','textarea');
  host.append(form('Publish announcement',[title,body],(t,b)=>api().rpc('ss1_school_announce',{p_school:s.id,p_title:t,p_body:b})));
 }
 return host;
}
function settingsPanel(s){
 const rights=getRights(s),h=make('section',null,'ss-sm-card');
 h.append(heading('School branding & settings','Customize this school without changing other schools.'));
 if(rights.manage_schools){
  const name=field('School name','School name',s.name);
  h.append(form('Rename school',[name],n=>api().rpc('ss1_school_rename',{p_school:s.id,p_name:n})));
 }
 if(rights.manage_settings){
  const tagline=field('Welcome message','Welcome to our school',s.branding?.tagline||'');
  tagline.input.required=false;
  const color=field('Accent color','#3478f6',s.branding?.accent||'#3478f6');
  color.input.pattern='^#[0-9a-fA-F]{6}$';
  const logo=field('HTTPS logo URL (optional)','https://school.example/logo.png',s.branding?.logo_url||'');
  logo.input.required=false;
  h.append(form('Save school appearance',[tagline,color,logo],(t,a,l)=>api().rpc('ss1_school_settings',{
   p_school:s.id,p_name:s.name,p_tagline:t,p_accent:a,p_logo_url:l
  })));
 }
 return rights.manage_schools||rights.manage_settings?h:null;
}
function analyticsPanel(s){
 if(!(getRights(s).view_analytics||s.my_role==='principal'))return null;
 const host=make('section',null,'ss-sm-card');host.append(heading('School analytics','Only aggregate numbers; no individual student work.'));
 const metrics=make('div',null,'ss-sm-metrics');host.append(metrics);
 host.append(btn('Refresh analytics',()=>void loadAnalytics(s.id,metrics)));
 void loadAnalytics(s.id,metrics);return host;
}
async function loadAnalytics(id,host){
 if(!host.isConnected)return;host.textContent='Loading school statistics…';
 try{const result=await api().rpc('ss1_school_analytics',{p_school:id});
  if(!host.isConnected||id!==schoolId)return;
  host.replaceChildren();
  for(const key of ['students','teachers','principals','classes','assignments','submissions']){
   const card=make('div',null,'ss-sm-metric');card.append(make('strong',Number(result?.[key]||0)),make('small',key));host.append(card);
  }
 }catch(e){if(host.isConnected)host.textContent=String(e?.message||e)}
}
function shareInvite(s){
 const u=new URL(location.href);u.searchParams.set('join_school',s.code);
 const link=u.href;
 if(navigator.clipboard?.writeText)navigator.clipboard.writeText(link).then(()=>note('School join link copied. All joins still require approval.')).catch(()=>prompt('Copy invite link:',link));
 else prompt('Copy invite link:',link);
}
function details(){
 const host=$('ssSchoolDetail');if(!host)return;host.replaceChildren(join());
 const s=school();if(!s)return;
 const panel=make('section',null,'ss-sm-card');
 const title=make('div',null,'ss-sm-org-head');
 const h=heading('🏫 '+s.name,s.branding?.tagline||'A connected StudySpire school');
 title.append(h);title.append(make('span',s.my_role||s.is_admin?'School '+(s.my_role||'admin'):'School Leader','ss-sm-pill'));
 panel.append(title);
 const code=make('p','Join code: '+s.code,'ss-sm-muted');panel.append(code,btn('Copy school invite',()=>shareInvite(s)));
 host.prepend(panel);
 const courses=make('section',null,'ss-sm-card');
 courses.append(heading('Classes','Your school classes connect to assignments, quizzes and gradebook.'));
 for(const cls of s.classes||[]){
  const row=make('div',null,'ss-sm-line');
  row.append(make('strong',cls.title),make('small',cls.subject||''));
  row.append(btn('Open classroom',()=>window.StudySpireClassroom?.open?.(cls.id,cls.title)));
  courses.append(row);
 }
 if(!(s.classes||[]).length)courses.append(make('p','No classes yet. A principal or Owner can create one.','ss-sm-muted'));
 if(getRights(s).manage_schools||s.my_role==='principal'||data.is_owner){
  const name=field('Class name','English I'),subject=field('Subject','English');
  subject.input.required=false;
  courses.append(form('Create class',[name,subject],(n,sub)=>api().rpc('ss_school_create_class',{p_school:s.id,p_title:n,p_subject:sub})));
 }
 host.append(courses);
 for(const card of [adminTools(s),roster(s),applicationsPanel(s),announcementPanel(s),settingsPanel(s),analyticsPanel(s)]){if(card)host.append(card)}
}
function draw(){side();details()}
async function loadPending(){
 const s=school();pending=[];
 if(!s||!(getRights(s).manage_enrollment||s.my_role==='principal')){draw();return}
 try{const rows=await api().rpc('ss1_school_pending',{p_school:s.id});if(schoolId===s.id){pending=Array.isArray(rows)?rows:[];draw()}}
 catch(e){note('Could not load school applications: '+String(e?.message||e))}
}
async function refresh(){
 const serial=++sequence;
 const connected=window.StudySpireSchoolBridge?.ready?.();
 showLaunchers(!!connected);
 if(!connected){data={is_owner:false,schools:[]};close();return}
 try{
  const [result,requests]=await Promise.all([
   api().rpc('ss1_school_overview'),api().rpc('ss_school_my_join_requests')
  ]);
  if(serial!==sequence)return;
  data={is_owner:result?.is_owner===true,schools:Array.isArray(result?.schools)?result.schools:[]};
  applications=Array.isArray(requests)?requests:[];
  if(!data.schools.some(s=>s.id===schoolId)){
   let saved='';try{saved=localStorage.getItem(KEY)||''}catch{}
   schoolId=data.schools.some(s=>s.id===saved)?saved:data.schools[0]?.id||'';
  }
  pending=[];draw();void loadPending();
 }catch(e){if(serial===sequence)note('School access unavailable: '+String(e?.message||e)+'. Check the school-only SQL migration.')}
}
function initialize(){
 mount();window.addEventListener('ss-cloud-auth-changed',()=>{void refresh()});
 if(window.StudySpireSchoolBridge?.ready?.())void refresh();
 const qs=new URLSearchParams(location.search);
 if(qs.has('join_school')){
  const c=qs.get('join_school');
  if(/^[a-z0-9-]{3,40}$/.test(c||'')){
   open();
   const select=()=>{const candidates=[...document.querySelectorAll('#ssSchoolDetail input')];const target=candidates.find(x=>x.placeholder.includes('central-high'));if(target){target.value=c||'';return true}return false};
   setTimeout(select,350);
  }
 }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
window.StudySpireSchoolManager={open,refresh};
})();