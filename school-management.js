/* StudySpire1 School Hub: familiar StudySpire + optional school integration.
   All actions use authenticated Supabase RPCs, never client-side role claims. */
(()=>{'use strict';
const id=x=>document.getElementById(x);
const make=(tag,text,cl)=>{const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=String(text);if(cl)e.className=cl;return e};
const button=(txt,fn,cl='ss-sm-btn')=>{const b=make('button',txt,cl);b.type='button';b.onclick=fn;return b};
const head=(txt,desc)=>{const h=make('div',null,'ss-sm-section-heading');h.append(make('h3',txt));if(desc)h.append(make('p',desc));return h};
const pill=txt=>make('span',txt,'ss-sm-pill');
const wrap=()=>id('ssSchoolManager');
const api=()=>{const a=window.StudySpireSchoolBridge;if(!a?.ready?.())throw Error('Sign in to StudySpire Cloud first.');return a};
const val=(field)=>field?.value?.trim()??'';
const permissions=[
 ['manage_schools','Manage school information'],
 ['appoint_principals','Appoint school principals'],
 ['manage_enrollment','Manage student enrollment'],
 ['view_analytics','View school analytics and history'],
 ['publish_announcements','Publish school announcements'],
 ['manage_settings','Manage school settings and calendar']
];
let data={is_owner:false,schools:[]},schoolID='',waiting=false,serial=0,joinRequests=[],pending=[],parentData=null;
const active=()=>data.schools.find(s=>s.id===schoolID)||null;
const asDate=v=>{if(!v)return '';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString():'Unknown'};
const notice=(s,bad=false)=>{const n=id('ssSchoolNotice');if(n){n.hidden=!s;n.textContent=s||'';n.className='ss-sm-notice'+(bad?' ss-sm-error':'')}};
function input(label,opts={}){
 const lab=make('label',null,'ss-sm-field');lab.append(make('span',label));
 let ctl=make(opts.kind==='textarea'?'textarea':opts.kind==='select'?'select':'input');
 if(opts.kind!=='textarea'&&opts.kind!=='select')ctl.type=opts.kind||'text';
 ctl.required=opts.required!==false;ctl.maxLength=opts.max||100;
 if(opts.placeholder)ctl.placeholder=opts.placeholder;
 if(opts.value!==undefined)ctl.value=opts.value;
 if(opts.options){for(const [v,caption] of opts.options){const op=make('option',caption);op.value=v;ctl.append(op)}}
 lab.append(ctl);return {lab,ctl};
}
function form(title,items,submit,fn,cls=''){
 const f=make('form',null,'ss-sm-form '+cls);
 if(title)f.append(make('h4',title));
 const fields=make('div',null,'ss-sm-form-fields');
 for(const field of items)fields.append(field.lab);
 f.append(fields);
 const b=make('button',submit,'ss-sm-btn ss-sm-primary');b.type='submit';f.append(b);
 f.addEventListener('submit',ev=>{
  ev.preventDefault();if(waiting)return;
  const values=items.map(i=>val(i.ctl));
  void actionTask(submit,()=>fn(...values));
 });
 return f;
}
async function actionTask(label,task){
 if(waiting)return;
 waiting=true;wrap()?.classList.add('ss-sm-busy');notice('Saving '+label+'...');
 try{const result=await task();if(result===false){notice('No changes made.');return}await refresh();notice(label+' saved.')}
 catch(e){notice((e?.message||String(e)),true)}
 finally{waiting=false;wrap()?.classList.remove('ss-sm-busy')}
}
function ensure(){
 if(wrap())return;
 const root=make('div',null,'ss-sm-overlay');root.id='ssSchoolManager';root.hidden=true;
 root.innerHTML='<section class="ss-sm-panel" tabindex="-1" aria-label="StudySpire Schools" role="dialog" aria-modal="true">'+
 '<header class="ss-sm-heading"><div><small>STUDYSPIRE1 · YOUR STUDY SPACE + SCHOOL</small><h2>🏫 Schools</h2>'+
 '<p>Your normal StudySpire workspace, connected to your school when you choose.</p></div>'+
 '<button id="ssSchoolClose" class="ss-sm-btn" type="button">✕ Close</button></header>'+
 '<p id="ssSchoolNotice" class="ss-sm-notice" role="status" hidden></p>'+
 '<div class="ss-sm-columns"><aside id="ssSchoolOrganizations" class="ss-sm-organizations"></aside>'+
 '<main id="ssSchoolDetails" class="ss-sm-content"></main></div></section>';
 document.body.append(root);
 id('ssSchoolClose').onclick=close;
 root.onclick=e=>{if(e.target===root)close()};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!root.hidden)close()});
}
function close(){if(wrap())wrap().hidden=true}
function open(){ensure();wrap().hidden=false;wrap().querySelector('.ss-sm-panel').focus();void refresh()}
function mount(){
 ensure();if(id('ssSchoolsTop'))return;
 const label='🏫 Schools';
 const top=id('sdAccountOpen')||id('sdTopAccount');
 if(top?.parentElement){const b=button(label,open,'btn secondary small');b.id='ssSchoolsTop';top.parentElement.append(b)}
 const quick=document.querySelector('.sd-dashboard-actions');
 if(quick){const b=button(label,open,'ss-sm-quick');b.id='ssSchoolsQuick';quick.append(b)}
 // Accessible on mobile even when top-navigation variants are absent.
 if(!id('ssSchoolsTop')){const b=button(label,open,'ss-sm-floating');b.id='ssSchoolsTop';document.body.append(b)}
 showLaunchers(false);
}
function showLaunchers(visible){for(const tag of ['ssSchoolsTop','ssSchoolsQuick'])if(id(tag))id(tag).hidden=!visible}
function linkFor(s){const u=new URL(location.href);u.searchParams.set('join_school',s.code);u.hash='';return u.toString()}
function copyLink(s){const str=linkFor(s);if(navigator.clipboard?.writeText)navigator.clipboard.writeText(str).then(()=>notice('School invitation link copied. Admission still needs approval.')).catch(()=>prompt('Copy school invitation:',str));else prompt('Copy school invitation:',str)}
function schoolHeading(s){const x=head((s.symbol||'🏫')+' '+s.name,'School code: '+s.code);x.classList.add('ss-sm-org-head');return x}
function renderAside(){
 const pane=id('ssSchoolOrganizations');if(!pane)return;
 pane.replaceChildren(head('My schools','Schools you belong to; Owners see every school.'));
 for(const school of data.schools){
  const b=button((school.symbol||'🏫')+' '+school.name,()=>{schoolID=school.id;pending=[];void refresh()},'ss-sm-org'+(school.id===schoolID?' selected':''));
  b.append(make('small',school.role==='guardian'?'Verified guardian':school.role.replace('_',' ')));
  pane.append(b);
 }
 if(!data.schools.length)pane.append(make('p','You have not joined a school yet. Your personal StudySpire features still work.','ss-sm-muted'));
 if(data.is_owner){
  const n=input('School name',{placeholder:'Central High School',max:100});
  const c=input('Unique school code',{placeholder:'central-high',max:40});
  pane.append(head('Create school','Platform Owners control which schools exist.'));
  pane.append(form('',[n,c],'＋ Create school',async(name,code)=>{
   const out=await api().rpc('ss1_create_school',{p_name:name,p_code:code});schoolID=out;
  }));
 }
}
function renderJoin(host){
 const block=make('section',null,'ss-sm-card');
 block.append(head('Join a school','Use a school invitation code. Approval is required; your private StudySpire notes are not shared.'));
 const c=input('School code',{placeholder:'e.g. central-high',max:40,value:new URLSearchParams(location.search).get('join_school')||''});
 const r=input('Joining as',{kind:'select',options:[['student','Student'],['teacher','Teacher']]});
 const n=input('Optional note',{required:false,max:300,kind:'textarea',placeholder:'Only share what staff need to review the request'});
 block.append(form('',[c,r,n],'Request school access',async(code,role,note)=>{
  await api().rpc('ss1_join_school',{p_code:code,p_role:role,p_note:note});
 }));
 if(joinRequests.length){
  block.append(head('My school applications'));
  for(const req of joinRequests){
   const row=make('div',null,'ss-sm-line');
   row.append(make('span',req.school+' · '+req.role),pill(req.status));
   block.append(row);
  }
 }
 host.append(block);
}
function renderAnnouncements(host,s){
 const box=make('section',null,'ss-sm-card');box.append(head('School announcements','Official notices for this school. Personal notes remain private.'));
 for(const a of s.announcements||[]){
  const row=make('article',null,'ss-sm-line ss-sm-announcement');
  row.append(make('p',a.body),make('small','@'+a.author+' · '+asDate(a.created_at)));box.append(row);
 }
 if(!(s.announcements||[]).length)box.append(make('p','No school announcements yet.','ss-sm-muted'));
 if(s.can_publish_announcements){
  const b=input('Announcement',{kind:'textarea',max:1200,placeholder:'School news and updates'});
  box.append(form('Publish announcement',[b],'Publish',async body=>api().rpc('ss1_announce',{p_school:s.id,p_body:body})));
 }
 host.append(box);
}
function renderSchedule(host,s){
 const box=make('section',null,'ss-sm-card');box.append(head('School schedule & calendar','Upcoming events, holidays, exams, and meetings.'));
 for(const e of s.events||[]){
  const row=make('div',null,'ss-sm-line');
  const main=make('span',e.title+' · '+e.category);main.append(make('small',' '+asDate(e.starts_at)));row.append(main);
  if(e.detail)row.append(make('small',e.detail));box.append(row);
 }
 if(!(s.events||[]).length)box.append(make('p','No events on the school calendar.','ss-sm-muted'));
 if(s.can_manage_settings){
  const title=input('Event title',{max:100,placeholder:'Parent meeting'});
  const category=input('Type',{kind:'select',options:[['school','School'],['exam','Exam'],['holiday','Holiday'],['meeting','Meeting'],['class','Class']]});
  const start=input('Start',{kind:'datetime-local'});
  const end=input('End',{kind:'datetime-local'});
  const details=input('Details',{kind:'textarea',max:700,required:false});
  box.append(form('Add calendar event',[title,category,start,end,details],'Add event',
   async(name,cat,startVal,endVal,detail)=>{
    const a=new Date(startVal),b=new Date(endVal);
    if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime()))throw Error('Enter valid start and end times');
    return api().rpc('ss1_schedule_event',{p_school:s.id,p_title:name,p_category:cat,
     p_start:a.toISOString(),p_end:b.toISOString(),p_details:detail});
   }));
 }
 host.append(box);
}
function renderClasses(host,s){
 const box=make('section',null,'ss-sm-card');box.append(head('Classes & assignments','Open a class for assignments, submissions, grading, and class notices.'));
 for(const course of s.classes||[]){
  const row=make('div',null,'ss-sm-line');row.append(make('strong',course.title),make('small',course.subject||'General'));
  row.append(button('Open class',()=>window.StudySpireClassroom?.open(course.id,course.title)));
  row.append(button('Substitute plan',()=>void substitute(course,s),'ss-sm-btn ss-sm-subtle'));box.append(row);
 }
 if(!(s.classes||[]).length)box.append(make('p','No classes yet.','ss-sm-muted'));
 if(data.is_owner||s.role==='principal'){
  const title=input('Class title',{placeholder:'Algebra I',max:100});
  const subject=input('Subject',{required:false,max:80,placeholder:'Mathematics'});
  box.append(form('Create principal-managed class',[title,subject],'Create class',
  async(t,sub)=>api().rpc('ss_school_create_class',{p_school:s.id,p_title:t,p_subject:sub})));
 }
 host.append(box);
}
async function substitute(course,s){
 try{
  const data=await api().rpc('ss1_substitute_plan',{p_class:course.id,p_content:null});
  const changed=prompt('Substitute handoff for '+course.title+' (assigned teacher or principal only):',data?.content||'');
  if(changed!==null&&changed!==(data?.content||''))void actionTask('Substitute plan',()=>api().rpc('ss1_substitute_plan',{p_class:course.id,p_content:changed}));
 }catch(e){notice(e?.message||String(e),true)}
}
function renderMemberControls(host,s){
 if(!s.can_manage_enrollment&&!data.is_owner)return;
 const box=make('section',null,'ss-sm-card');box.append(head('School people & approvals','Verified school accounts. Permissions do not affect roles in regular StudySpire.'));
 for(const person of s.members||[]){
  const row=make('div',null,'ss-sm-line');row.append(make('span','@'+person.username),pill(person.role.replace('_',' ')));
  if(s.is_owner||(['student','teacher'].includes(person.role)&&s.can_manage_enrollment)||
    (person.role==='principal'&&s.can_appoint_principals)){
   row.append(button('Remove',()=>{if(confirm('Remove @'+person.username+' from this school?'))
    void actionTask('Remove member',()=>api().rpc('ss1_set_school_role',{p_school:s.id,p_username:person.username,p_role:'remove'}));
   },'ss-sm-btn ss-sm-danger'));
  }
  box.append(row);
 }
 const name=input('Existing username',{placeholder:'studyspire-username',max:32});
 const opts=[];
 if(s.is_owner)opts.push(['school_admin','School admin']);
 if(s.can_appoint_principals)opts.push(['principal','Principal']);
 if(s.can_manage_enrollment)opts.push(['teacher','Teacher'],['student','Student']);
 if(opts.length){
  const role=input('School role',{kind:'select',options:opts});
  box.append(form('Assign a verified account',[name,role],'Assign role',
    async(username,assigned)=>{
      if(!confirm('Assign @'+username+' as '+assigned.replace('_',' ')+' at '+s.name+'?'))return false;
      return api().rpc('ss1_set_school_role',{p_school:s.id,p_username:username,p_role:assigned});
    }));
 }
 box.append(button('Copy school join link',()=>copyLink(s),'ss-sm-btn'));
 host.append(box);
}
function renderAdminPermissions(host,s){
 if(!s.is_owner)return;
 const admins=(s.members||[]).filter(m=>m.role==='school_admin');
 const box=make('section',null,'ss-sm-card');box.append(head('Owner permission builder','Give each school admin exactly the permissions they need. Changes are enforced by Supabase.'));
 if(!admins.length){box.append(make('p','Appoint a school admin above to configure their permissions.','ss-sm-muted'));host.append(box);return}
 for(const person of admins){
  const formEl=make('form',null,'ss-sm-permissions');
  formEl.append(make('h4','@'+person.username));
  const fields=[];
  for(const [key,label] of permissions){
   const row=make('label',null,'ss-sm-toggle');
   const input=make('input');input.type='checkbox';input.checked=person.permissions?.[key]===true;
   row.append(make('span',label),input);formEl.append(row);fields.push([key,input]);
  }
  const save=make('button','Save @'+person.username+' permissions','ss-sm-btn ss-sm-primary');save.type='submit';formEl.append(save);
  formEl.onsubmit=ev=>{ev.preventDefault();const flags=Object.fromEntries(fields.map(([key,input])=>[key,input.checked]));
   if(confirm('Save school permissions for @'+person.username+'?'))
    void actionTask('Admin permissions',()=>api().rpc('ss1_set_admin_permissions',{
     p_school:s.id,p_username:person.username,p_permissions:flags}));
  };
  box.append(formEl);
 }
 host.append(box);
}
function renderEnrollment(host,s){
 if(!s.can_manage_enrollment)return;
 const box=make('section',null,'ss-sm-card');box.append(head('School enrollment requests','Review applications. Applicants cannot appoint themselves staff.'));
 if(!pending.length)box.append(make('p','No pending requests.','ss-sm-muted'));
 for(const request of pending){
  const line=make('div',null,'ss-sm-line');line.append(make('span','@'+request.username+' · '+request.role));
  if(request.note)line.append(make('small',request.note));
  line.append(button('Approve',()=>void actionTask('Approve application',()=>api().rpc('ss1_review_join',{p_request:request.id,p_approve:true}))));
  line.append(button('Decline',()=>void actionTask('Decline application',()=>api().rpc('ss1_review_join',{p_request:request.id,p_approve:false})),'ss-sm-btn ss-sm-danger'));
  box.append(line);
 }
 host.append(box);
}
function renderBranding(host,s){
 if(!s.can_manage_settings&&!s.can_manage_schools)return;
 const box=make('section',null,'ss-sm-card');box.append(head('School branding & settings','Give this school its own look. No external image hosting required.'));
 const n=input('School name',{value:s.name,max:100});
 const d=input('School description',{value:s.description||'',kind:'textarea',max:400,required:false});
 const icon=input('School symbol / logo',{value:s.symbol||'🏫',max:8});
 const color=input('Accent color',{kind:'color',value:s.accent_color||'#397ed4'});
 box.append(form('',[n,d,icon,color],'Save school appearance',async(name,description,symbol,accent)=>
  api().rpc('ss1_update_school',{p_school:s.id,p_name:name,p_description:description,p_symbol:symbol,p_accent:accent})));
 host.append(box);
}
function renderAttendance(host,s){
 if(!s.can_manage_enrollment)return;
 const box=make('section',null,'ss-sm-card');box.append(head('Attendance','Record daily attendance for students enrolled in this school.'));
 const u=input('Student username',{max:32,placeholder:'student'});
 const day=input('Date',{kind:'date',value:new Date().toISOString().slice(0,10)});
 const status=input('Status',{kind:'select',options:[['present','Present'],['absent','Absent'],['tardy','Tardy'],['excused','Excused']]});
 const note=input('Note',{kind:'textarea',max:250,required:false});
 box.append(form('',[u,day,status,note],'Save attendance',async(username,date,st,comment)=>
   api().rpc('ss1_record_attendance',{p_school:s.id,p_username:username,p_day:date,p_status:st,p_note:comment})));
 host.append(box);
}
function renderGuardians(host,s){
 if(!s.can_manage_enrollment)return;
 const box=make('section',null,'ss-sm-card');box.append(head('Parent / guardian access','School staff must verify guardianship outside the app before granting access.'));
 const st=input('Student username',{max:32});const gd=input('Verified guardian username',{max:32});
 const enabled=input('Action',{kind:'select',options:[['true','Verify / grant access'],['false','Revoke access']]});
 box.append(form('',[st,gd,enabled],'Update guardian access',async(student,guardian,on)=>{
  if(!confirm('Have you verified the guardian’s identity and relationship to this student?'))return false;
  return api().rpc('ss1_verify_guardian',{p_school:s.id,p_student:student,p_guardian:guardian,p_enabled:on==='true'});
 }));
 host.append(box);
}
async function loadProtected(s,kind,holder){
 holder.textContent='Loading…';
 try{
  const result=await api().rpc(kind==='analytics'?'ss1_school_analytics':'ss1_school_audit',{p_school:s.id});
  holder.replaceChildren();
  if(kind==='analytics'){
   const labels=[['students','Students'],['teachers','Teachers'],['principals','Principals'],['classes','Classes'],
    ['assignments','Assignments'],['graded_count','Graded submissions'],['average_score_percent','Average score (%)'],['pending_applications','Pending applications']];
   const grid=make('div',null,'ss-sm-stats');
   for(const [key,label] of labels){const box=make('div',null,'ss-sm-stat');box.append(make('strong',result?.[key]??'—'),make('small',label));grid.append(box)}
   holder.append(grid);
   if(result?.attendance_last_30_days)holder.append(make('p','30-day attendance totals: '+JSON.stringify(result.attendance_last_30_days),'ss-sm-muted'));
  }else{
   if(!Array.isArray(result)||!result.length)holder.append(make('p','No school audit entries.','ss-sm-muted'));
   for(const entry of Array.isArray(result)?result:[]){
    const row=make('div',null,'ss-sm-line');row.append(make('span',entry.action+' · '+(entry.actor||'system')),make('small',asDate(entry.created_at)));holder.append(row);
   }
  }
 }catch(e){holder.textContent='Unable to load: '+String(e?.message||e)}
}
function renderInsights(host,s){
 if(!s.can_view_analytics)return;
 const box=make('section',null,'ss-sm-card');box.append(head('School analytics & audit','Permission-controlled school summaries and administration history.'));
 const analytics=make('div');const history=make('div');
 box.append(button('View school analytics',()=>void loadProtected(s,'analytics',analytics)));
 box.append(analytics);
 box.append(button('View audit history',()=>void loadProtected(s,'audit',history)));
 box.append(history);host.append(box);
}
async function loadParent(host){
 host.replaceChildren(make('p','Loading verified guardian records...'));
 try{
  const all=await api().rpc('ss1_parent_portal');
  host.replaceChildren();
  if(!Array.isArray(all)||!all.length){host.append(make('p','No verified student links. School staff must approve a guardian relationship first.','ss-sm-muted'));return}
  for(const child of all){
   const card=make('div',null,'ss-sm-card');card.append(head(child.student+' · '+child.school,'Grades and attendance are visible only to verified guardians.'));
   for(const grade of child.grades||[])card.append(make('p',grade.class+' — '+grade.assignment+': '+(grade.score??'Not graded')+' / '+grade.max_points));
   for(const att of child.attendance||[])card.append(make('p',att.day+': '+att.status));
   const exportRows=[['type','item','result'],...(child.grades||[]).map(g=>['grade',g.assignment,(g.score??'—')+'/'+g.max_points]),...(child.attendance||[]).map(a=>['attendance',a.day,a.status])];
   card.append(button('Export report CSV',()=>{
    const csv=exportRows.map(row=>row.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    const a=make('a');a.href=url;a.download='studyspire1-parent-report.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   }));
   host.append(card);
  }
 }catch(e){host.textContent='Parent portal unavailable: '+String(e?.message||e)}
}
function renderParent(host){
 const box=make('section',null,'ss-sm-card');box.append(head('Parent portal','Only school-verified parent or guardian links can display a student’s records.'));
 const list=make('div');
 box.append(button('View my verified students',()=>void loadParent(list)),list);host.append(box);
}
function renderSchool(host,s){
 const brand=make('section',null,'ss-sm-school-hero');
 brand.style.borderLeft='5px solid '+(/^#[0-9a-fA-F]{6}$/.test(s.accent_color||'')?s.accent_color:'#397ed4');
 brand.append(schoolHeading(s));
 brand.append(pill(s.is_owner?'Platform Owner':s.role.replace('_',' ')));
 if(s.description)brand.append(make('p',s.description));
 brand.append(button('🔗 Copy school invitation',()=>copyLink(s)));
 host.append(brand);
 renderAnnouncements(host,s);
 renderSchedule(host,s);
 renderClasses(host,s);
 renderEnrollment(host,s);
 renderMemberControls(host,s);
 renderAdminPermissions(host,s);
 renderBranding(host,s);
 renderAttendance(host,s);
 renderGuardians(host,s);
 renderInsights(host,s);
}
function render(){
 renderAside();const host=id('ssSchoolDetails');if(!host)return;host.replaceChildren();
 renderJoin(host);renderParent(host);
 const s=active();
 if(s)renderSchool(host,s);else host.append(head('Your personal study space stays yours','Join a school to unlock school assignments, announcements and classes.'));
}
async function refresh(){
 const req=++serial;
 const a=window.StudySpireSchoolBridge;
 if(!a?.ready?.()){showLaunchers(false);close();return}
 showLaunchers(true);
 try{
  const [overview,requests]=await Promise.all([
   api().rpc('ss1_school_overview'),api().rpc('ss1_my_join_requests')]);
  if(req!==serial)return;
  data={is_owner:overview?.is_owner===true,schools:Array.isArray(overview?.schools)?overview.schools:[]};
  joinRequests=Array.isArray(requests)?requests:[];
  if(!data.schools.some(s=>s.id===schoolID))schoolID=data.schools[0]?.id||'';
  const s=active();pending=[];
  if(s?.can_manage_enrollment){
   pending=await api().rpc('ss1_pending_join_requests',{p_school:s.id});
   if(req!==serial)return;
   if(!Array.isArray(pending))pending=[];
  }
  render();
 }catch(e){if(req!==serial)return;notice('School dashboard unavailable: '+String(e?.message||e)+'. Check school-first SQL installation.',true)}
}
function boot(){
 mount();
 if(window.StudySpireSchoolBridge?.ready?.())void refresh();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
window.addEventListener('ss-cloud-auth-changed',()=>void refresh());
window.StudySpireSchoolManager={open,refresh};
})();
