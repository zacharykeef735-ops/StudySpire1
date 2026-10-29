/* StudySpire1 Classroom — secure RPC-backed classwork, submissions and grading. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const text=(tag,value,cls)=>{const n=document.createElement(tag);if(value!=null)n.textContent=String(value);if(cls)n.className=cls;return n};
const btn=(label,handler,cls='')=>{const b=text('button',label,'ssc-btn '+cls);b.type='button';b.onclick=handler;return b};
let classId='',classTitle='',snapshot=null,busy=false,request=0;
function api(){const a=window.StudySpireSchoolBridge;if(!a?.ready?.())throw Error('Sign in to StudySpire Cloud first');return a}
function notice(value){const n=$('sscNotice');if(n){n.textContent=value||'';n.hidden=!value}}
function date(value){if(!value)return 'No due date';const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString():'Unknown date'}
function formatScore(s,max){return s==null?'Not graded':Number(s)+' / '+Number(max)}
function getAssignment(id){return snapshot?.assignments?.find(a=>a.id===id)}
function downloadCalendar(){
 const escape=v=>String(v).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
 const rows=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//StudySpire1//Classroom//EN'];
 (snapshot?.assignments||[]).filter(a=>a.due_at).forEach(a=>{
  const d=new Date(a.due_at);if(!Number.isFinite(d.getTime()))return;
  const stamp=d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  rows.push('BEGIN:VEVENT','UID:'+escape(a.id)+'@studyspire1','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''),
   'DTSTART:'+stamp,'SUMMARY:'+escape(classTitle+' — '+a.title),'DESCRIPTION:'+escape(a.description||''),'END:VEVENT');
 });
 rows.push('END:VCALENDAR');
 const url=URL.createObjectURL(new Blob([rows.join('\r\n')+'\r\n'],{type:'text/calendar'}));
 const a=document.createElement('a');a.href=url;a.download='studyspire1-'+classTitle.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,32)+'-class.ics';
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);
}
function makeForm(title,fields,submit,callback){
 const f=document.createElement('form');f.className='ssc-form';const h=text('h4',title);f.append(h);
 const controls={};
 for(const spec of fields){
  const wrap=text('label',null,'ssc-field');wrap.append(text('span',spec.label));
  const input=document.createElement(spec.type==='textarea'?'textarea':spec.type==='select'?'select':'input');
  if(spec.type!=='textarea'&&spec.type!=='select')input.type=spec.type||'text';
  input.name=spec.name;input.required=spec.required!==false;
  if(spec.maxlength)input.maxLength=spec.maxlength;
  if(spec.min!=null)input.min=String(spec.min);
  if(spec.max!=null)input.max=String(spec.max);
  if(spec.value!=null)input.value=String(spec.value);
  if(spec.placeholder)input.placeholder=spec.placeholder;
  if(spec.type==='select')for(const o of spec.options||[]){const option=document.createElement('option');option.value=o;option.textContent=o[0].toUpperCase()+o.slice(1);input.append(option)}
  wrap.append(input);f.append(wrap);controls[spec.name]=input;
 }
 const b=btn(submit,null,'primary');b.type='submit';f.append(b);
 f.addEventListener('submit',async e=>{e.preventDefault();if(busy)return;const values={};for(const k of Object.keys(controls))values[k]=controls[k].value.trim();
  const ok=await perform(()=>callback(values),submit);if(ok)f.reset();
 });
 return f;
}
async function perform(fn,label){
 if(busy)return false;busy=true;const root=$('sscRoot');root?.classList.add('ssc-busy');notice(label+'…');
 try{await fn();await refresh();notice(label+' saved.');return true}
 catch(e){notice(String(e?.message||e));return false}
 finally{busy=false;root?.classList.remove('ssc-busy')}
}
async function refresh(){
 if(!classId)return;
 const serial=++request;
 try{
  const data=await api().rpc('ss_school_classroom',{p_class:classId});
  if(serial!==request||!classId)return;
  snapshot=data;render();notice('');
 }catch(e){if(serial===request){snapshot=null;render();notice('Classroom unavailable: '+String(e?.message||e))}}
}
function open(id,title='Classroom'){
 if(!id)return;mount();classId=id;classTitle=String(title).slice(0,160);snapshot=null;
 $('sscRoot').hidden=false;$('sscPanel').focus();
 $('sscTitle').textContent=classTitle;notice('Loading class…');void refresh();
}
function close(){classId='';snapshot=null;request++;const r=$('sscRoot');if(r)r.hidden=true}
function renderRoster(host){
 const panel=text('section',null,'ssc-card');panel.append(text('h3','Class roster'));
 const members=snapshot.members||[];
 if(!snapshot.can_teach){panel.append(text('p','Your classmates’ accounts are private.','ssc-muted'));host.append(panel);return}
 if(!members.length)panel.append(text('p','No one has been assigned to this class yet.','ssc-muted'));
 members.forEach(m=>{
  const row=text('div',null,'ssc-line');
  row.append(text('strong','@'+m.username),text('small',m.role));
  if(snapshot.can_manage)row.append(btn('Remove',()=>{if(confirm('Remove @'+m.username+' from this class?'))void perform(
   ()=>api().rpc('ss_school_class_enroll',{p_class:classId,p_username:m.username,p_role:'remove'}),'Remove enrollment')},'danger'));
  panel.append(row);
 });
 if(snapshot.can_manage)panel.append(makeForm('Add a class member',[
  {label:'Existing school username',name:'username',maxlength:32,placeholder:'username'},
  {label:'Role',name:'role',type:'select',options:['teacher','student']}
 ],'Enroll',v=>api().rpc('ss_school_class_enroll',{p_class:classId,p_username:v.username,p_role:v.role})));
 else panel.append(text('p','Only the principal or platform owner can change class enrollments.','ssc-muted'));
 host.append(panel);
}
function renderAnnouncements(host){
 const panel=text('section',null,'ssc-card');panel.append(text('h3','Class announcements'));
 if(snapshot.can_teach)panel.append(makeForm('Post an announcement',[{label:'Message',name:'body',type:'textarea',maxlength:1000,placeholder:'What should students know?'}],'Post announcement',v=>api().rpc('ss_school_post_announcement',{p_class:classId,p_body:v.body})));
 const items=(snapshot.announcements||[]).slice(0,20);
 if(!items.length)panel.append(text('p','No announcements yet.','ssc-muted'));
 items.forEach(a=>{const post=text('article',null,'ssc-post');post.append(text('p',a.body),text('small','@'+a.username+' · '+date(a.created_at)));panel.append(post)});
 host.append(panel);
}
function renderGrades(host){
 const panel=text('section',null,'ssc-card');panel.append(text('h3','Grade summary'));
 const assignments=snapshot.assignments||[],submissions=snapshot.submissions||[];
 if(!submissions.length){panel.append(text('p','Grades will appear after work is submitted.','ssc-muted'));host.append(panel);return}
 if(snapshot.can_teach){
  const students=(snapshot.members||[]).filter(m=>m.role==='student');
  students.forEach(s=>{
   const graded=submissions.filter(x=>x.student_id===s.profile_id&&x.score!=null);
   const points=graded.reduce((n,x)=>n+Number(x.score),0);
   const max=graded.reduce((n,x)=>n+Number(getAssignment(x.assignment_id)?.max_points||0),0);
   const row=text('div',null,'ssc-line');row.append(text('span','@'+s.username),text('strong',max?Math.round(points/max*100)+'% ('+graded.length+' graded)':'No graded work'));panel.append(row);
  });
  if(!students.length)panel.append(text('p','Enroll students to see grade summaries.','ssc-muted'));
 }else{
  const graded=submissions.filter(x=>x.score!=null),points=graded.reduce((n,x)=>n+Number(x.score),0);
  const max=graded.reduce((n,x)=>n+Number(getAssignment(x.assignment_id)?.max_points||0),0);
  panel.append(text('p',max?'Your graded average: '+Math.round(points/max*100)+'% across '+graded.length+' assignments':'You have no graded work yet.'));
 }
 panel.append(text('p','Only graded submissions count toward these averages. This is not an official report card.','ssc-muted'));
 host.append(panel);
}
function renderAssignment(host,assignment){
 const box=text('article',null,'ssc-assignment');
 const head=text('div',null,'ssc-assignment-head');
 head.append(text('h4',assignment.title),text('small',date(assignment.due_at)+' · '+Number(assignment.max_points)+' pts'));
 box.append(head);
 if(assignment.description)box.append(text('p',assignment.description,'ssc-description'));
 const submissions=(snapshot.submissions||[]).filter(s=>s.assignment_id===assignment.id);
 if(snapshot.can_submit){
  const mine=submissions[0];
  box.append(text('p',mine?'Submitted '+date(mine.submitted_at)+' · '+formatScore(mine.score,assignment.max_points):'Not submitted yet','ssc-muted'));
  if(mine?.feedback)box.append(text('p','Teacher feedback: '+mine.feedback,'ssc-feedback'));
  if(!mine?.graded_at)box.append(makeForm(mine?'Update your submission':'Submit your work',[
   {label:'Written response',name:'body',type:'textarea',maxlength:10000,placeholder:'Write your answer here',value:mine?.body||''}
  ],mine?'Update submission':'Submit assignment',v=>api().rpc('ss_school_submit_assignment',{p_assignment:assignment.id,p_body:v.body})));
 }else if(snapshot.can_teach){
  box.append(text('h4','Student submissions ('+submissions.length+')'));
  if(!submissions.length)box.append(text('p','No submissions yet.','ssc-muted'));
  submissions.forEach(s=>{
   const entry=text('div',null,'ssc-submission');
   entry.append(text('strong','@'+s.username),text('small','Submitted '+date(s.submitted_at)+' · '+formatScore(s.score,assignment.max_points)),text('p',s.body));
   if(s.feedback)entry.append(text('p','Feedback: '+s.feedback,'ssc-feedback'));
   entry.append(makeForm('Grade submission',[
    {label:'Score',name:'score',type:'number',min:0,max:assignment.max_points,required:true,value:s.score==null?'':s.score},
    {label:'Feedback',name:'feedback',type:'textarea',required:false,maxlength:3000,value:s.feedback||''}
   ],'Save grade',v=>api().rpc('ss_school_grade_assignment',{p_assignment:assignment.id,p_student:s.student_id,p_score:Number(v.score),p_feedback:v.feedback})));
   box.append(entry);
  });
 }
 host.append(box);
}
function renderAssignments(host){
 const panel=text('section',null,'ssc-card');const header=text('div',null,'ssc-line');
 header.append(text('h3','Assignments'),btn('Export due dates (.ics)',downloadCalendar));panel.append(header);
 if(snapshot.can_teach)panel.append(makeForm('Create an assignment',[
  {label:'Title',name:'title',maxlength:160,placeholder:'Unit 1 practice'},
  {label:'Instructions',name:'description',type:'textarea',required:false,maxlength:3000},
  {label:'Due date & time',name:'due',type:'datetime-local',required:false},
  {label:'Maximum points',name:'points',type:'number',min:1,max:1000,value:100}
 ],'Create assignment',v=>api().rpc('ss_school_create_assignment',{
  p_class:classId,p_title:v.title,p_description:v.description,p_due_at:v.due?new Date(v.due).toISOString():null,p_max_points:Number(v.points)
 })));
 const assignments=snapshot.assignments||[];
 if(!assignments.length)panel.append(text('p','No assignments have been posted.','ssc-muted'));
 assignments.forEach(a=>renderAssignment(panel,a));
 host.append(panel);
}
function render(){
 const host=$('sscContent');if(!host)return;host.replaceChildren();if(!snapshot)return;
 const meta=text('div',null,'ssc-meta');
 meta.append(text('span',snapshot.can_manage?'School leader':snapshot.can_teach?'Assigned teacher':'Enrolled student','ssc-pill'),
  text('span',(snapshot.assignments||[]).length+' assignments','ssc-pill'));
 host.append(meta);
 const grid=text('div',null,'ssc-grid');
 const left=text('div',null,'ssc-column'),right=text('div',null,'ssc-column');
 renderAssignments(left);renderAnnouncements(right);renderRoster(right);renderGrades(right);
 grid.append(left,right);host.append(grid);
}
function mount(){
 if($('sscRoot'))return;
 const root=text('div',null,'ssc-overlay');root.id='sscRoot';root.hidden=true;
 root.innerHTML='<section id="sscPanel" class="ssc-panel" role="dialog" aria-modal="true" aria-labelledby="sscTitle" tabindex="-1"><header><div><small>STUDYSPIRE1 · CLASSROOM</small><h2 id="sscTitle">Classroom</h2><p>Assignments, class updates, submissions, and gradebook</p></div><div class="ssc-actions"><button id="sscReload" type="button" class="ssc-btn">↻ Refresh</button><button id="sscClose" type="button" class="ssc-btn">✕ Close</button></div></header><p id="sscNotice" role="status" class="ssc-notice" hidden></p><div id="sscContent"></div></section>';
 document.body.append(root);$('sscClose').onclick=close;$('sscReload').onclick=()=>void refresh();
 root.addEventListener('click',e=>{if(e.target===root)close()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!root.hidden)close()});
 window.addEventListener('ss-cloud-auth-changed',()=>{if(!window.StudySpireSchoolBridge?.ready?.())close()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
window.StudySpireClassroom={open,refresh};
})();