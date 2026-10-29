/* StudySpire Smart Planner — account-scoped, device-local learning tools. */
(()=>{'use strict';
const KEY='studyspire-smart-planner-v1', $=id=>document.getElementById(id);
const scoped=()=>typeof window.sdAccountKey==='function'?window.sdAccountKey(KEY):KEY;
const iso=(d=new Date())=>{const dt=new Date(d.getTime()-d.getTimezoneOffset()*60000);return dt.toISOString().slice(0,10)};
const later=(days)=>{const d=new Date();d.setDate(d.getDate()+days);return iso(d)};
const id=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():'s'+Date.now()+Math.random().toString(36).slice(2);
const txt=(tag,value,cls)=>{const e=document.createElement(tag);if(value!=null)e.textContent=String(value);if(cls)e.className=cls;return e};
const btn=(label,fn,cls='')=>{const b=txt('button',label,'ssp-button '+cls);b.type='button';b.onclick=fn;return b};
const clean=(v,n=160)=>String(v||'').trim().slice(0,n);
const num=(v,min,max,fallback)=>{const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):fallback};
const empty=()=>({version:1,tasks:[],cards:[],history:[]});
let db=empty(),tab='plan',shown=false,cardId='',revealed=false;
const diff=(date)=>{if(!date)return 365;const a=new Date(date+'T12:00:00'),b=new Date(iso()+'T12:00:00');return Number.isFinite(a.getTime())?Math.round((a-b)/86400000):365};
function validate(input){
 const out=empty();if(!input||typeof input!=='object')return out;
 out.tasks=(Array.isArray(input.tasks)?input.tasks:[]).slice(0,500).map(t=>({id:clean(t.id,80)||id(),title:clean(t.title),subject:clean(t.subject,60),due:/^\d{4}-\d\d-\d\d$/.test(t.due||'')?t.due:'',priority:['high','normal','low'].includes(t.priority)?t.priority:'normal',minutes:num(t.minutes,5,240,25),done:!!t.done})).filter(t=>t.title);
 out.cards=(Array.isArray(input.cards)?input.cards:[]).slice(0,500).map(c=>({id:clean(c.id,80)||id(),question:clean(c.question,240),answer:clean(c.answer,600),subject:clean(c.subject,60),due:/^\d{4}-\d\d-\d\d$/.test(c.due||'')?c.due:iso(),interval:num(c.interval,1,180,1)})).filter(c=>c.question&&c.answer);
 out.history=(Array.isArray(input.history)?input.history:[]).slice(-500).map(h=>({date:clean(h.date,10),kind:h.kind==='review'?'review':'task'})).filter(h=>/^\d{4}-\d\d-\d\d$/.test(h.date));
 return out;
}
function load(){try{db=validate(JSON.parse(localStorage.getItem(scoped())||'null'))}catch{db=empty()}}
function save(){try{localStorage.setItem(scoped(),JSON.stringify(db))}catch{notice('Could not save locally. Export your work now.')}}
function track(kind){db.history.push({date:iso(),kind});db.history=db.history.slice(-500)}
function notice(message){const n=$('sspNotice');if(n){n.hidden=!message;n.textContent=message||''}}
function rank(task){const d=diff(task.due);return (task.priority==='high'?70:task.priority==='normal'?35:0)+(d<0?120:Math.max(0,90-d*13))-Math.min(25,task.minutes/10)}
function pending(){return db.tasks.filter(t=>!t.done).sort((a,b)=>rank(b)-rank(a)||a.title.localeCompare(b.title))}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200)}
function open(target='plan'){load();shown=true;tab=target;$('sspOverlay').hidden=false;$('sspDialog').focus();render()}
function close(){shown=false;$('sspOverlay').hidden=true}
function render(){
 if(!shown)return;
 document.querySelectorAll('[data-ssp-tab]').forEach(b=>{const on=b.dataset.sspTab===tab;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on))});
 for(const name of ['plan','review','insights','backup'])$('ssp-'+name).hidden=name!==tab;
 if(tab==='plan')renderPlan();if(tab==='review')renderReview();if(tab==='insights')renderInsights();if(tab==='backup')renderBackup();
}
function renderPlan(){
 const host=$('sspTasks');host.replaceChildren();
 const q=String($('sspSearch').value||'').toLowerCase();
 const tasks=[...pending(),...db.tasks.filter(t=>t.done)].filter(t=>(t.title+' '+t.subject).toLowerCase().includes(q));
 if(!tasks.length)host.append(txt('p','No tasks here yet. Add an exam or assignment above.','ssp-muted'));
 tasks.forEach(t=>{
  const row=txt('div',null,'ssp-item'+(t.done?' completed':''));
  const check=document.createElement('input');check.type='checkbox';check.checked=t.done;check.setAttribute('aria-label','Mark '+t.title+' complete');
  check.onchange=()=>{if(check.checked&&!t.done)track('task');t.done=check.checked;save();render()};
  const desc=txt('div',null,'ssp-item-info');desc.append(txt('strong',t.title),txt('small',[(t.subject||'General'),(t.due?'Due '+t.due+(diff(t.due)<0?' · overdue':''):'No due date'),t.priority+' priority',t.minutes+' min'].join(' · ')));
  row.append(check,desc,btn('Remove',()=>{if(!confirm('Remove '+t.title+'?'))return;db.tasks=db.tasks.filter(x=>x.id!==t.id);save();render()},'quiet'));host.append(row);
 });
 const plan=$('sspSchedule');plan.replaceChildren();
 let budget=120;const next=pending().slice(0,8);
 next.forEach((t,i)=>{if(budget<=0)return;const minutes=Math.min(budget,t.minutes);budget-=minutes;
  const item=txt('div',null,'ssp-session');item.append(txt('b',String(i+1).padStart(2,'0')),txt('span',t.title+' · '+minutes+' minutes'+(t.due?' · due '+t.due:'')));plan.append(item);
 });
 if(!next.length)plan.append(txt('p','All caught up. Your next plan appears when you add a task.','ssp-muted'));
 $('sspPlanSummary').textContent='Suggested next '+(120-budget)+' minutes, prioritized by due date and importance.';
}
function renderReview(){
 const eligible=db.cards.filter(c=>diff(c.due)<=0);
 const host=$('sspReviewCurrent');host.replaceChildren();
 let card=eligible.find(c=>c.id===cardId)||eligible[0];if(!card||card.id!==cardId){cardId=card?.id||'';revealed=false}
 $('sspReviewCount').textContent=eligible.length+' topic'+(eligible.length===1?'':'s')+' ready';
 if(card){
  const flash=txt('div',null,'ssp-flash');
  flash.append(txt('small',card.subject||'Recall practice'),txt('h3',card.question));
  if(revealed){flash.append(txt('p',card.answer));const row=txt('div',null,'ssp-actions');
   [['Again',1],['Good',2],['Easy',3]].forEach(([label,factor])=>row.append(btn(label,()=>{card.interval=factor===1?1:Math.min(180,Math.max(factor+1,card.interval*factor));card.due=later(card.interval);track('review');save();cardId='';revealed=false;render()})));
   flash.append(row);
  }else flash.append(btn('Reveal answer',()=>{revealed=true;renderReview()},'primary'));
  host.append(flash);
 }else host.append(txt('p','No reviews due. Come back when the next one is ready.','ssp-muted'));
 const list=$('sspCards');list.replaceChildren();
 db.cards.forEach(c=>{const row=txt('div',null,'ssp-item');const label=txt('div',null,'ssp-item-info');
  label.append(txt('strong',c.question),txt('small',(c.subject||'General')+' · '+(diff(c.due)<=0?'Review now':'Next '+c.due)));
  row.append(label,btn('Remove',()=>{if(!confirm('Remove this review topic?'))return;db.cards=db.cards.filter(x=>x.id!==c.id);save();render()},'quiet'));list.append(row);
 });
 if(!db.cards.length)list.append(txt('p','Add a question and answer to start spaced review.','ssp-muted'));
}
function renderInsights(){
 const host=$('sspInsights');host.replaceChildren();
 const completed=db.tasks.filter(t=>t.done).length,reviewed=db.history.filter(h=>h.kind==='review').length;
 const metrics=txt('div',null,'ssp-metrics');
 [['Tasks finished',completed],['Tasks open',db.tasks.length-completed],['Overdue',db.tasks.filter(t=>!t.done&&t.due&&diff(t.due)<0).length],['Reviews completed',reviewed]].forEach(([label,value])=>{const box=txt('div',null,'ssp-metric');box.append(txt('strong',value),txt('small',label));metrics.append(box)});
 host.append(metrics,txt('h3','Your last seven days'));
 const chart=txt('div',null,'ssp-chart');for(let i=6;i>=0;i--){const date=later(-i),count=db.history.filter(x=>x.date===date).length;
  const col=txt('div',null,'ssp-col');const bar=txt('span',null,'ssp-bar');bar.style.height=Math.min(100,Math.max(5,count*20))+'%';bar.title=count+' actions on '+date;
  col.append(bar,txt('small',date.slice(5)));chart.append(col);
 }host.append(chart);
 host.append(txt('p','Achievements: '+(completed?'First finish ✓ · ':'')+(completed>=10?'Task master ✓ · ':'')+(reviewed>=20?'Recall champion ✓':'Keep learning to unlock more.'),'ssp-muted'));
}
function exportCalendar(){
 const esc=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//StudySpire//Smart Planner//EN'];
 db.tasks.filter(t=>t.due&&!t.done).forEach(t=>lines.push('BEGIN:VEVENT','UID:'+esc(t.id)+'@studyspire','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''),'DTSTART;VALUE=DATE:'+t.due.replace(/-/g,''),'SUMMARY:'+esc(t.title),'DESCRIPTION:'+esc((t.subject||'General')+' / '+t.minutes+' minutes'),'END:VEVENT'));
 download('studyspire-deadlines.ics',lines.concat('END:VCALENDAR').join('\r\n')+'\r\n','text/calendar');
}
function renderBackup(){
 const host=$('sspBackup');host.replaceChildren();
 host.append(txt('p','Your planner is private to this browser and StudySpire account. It does not sync to the cloud. Export a file to keep a backup.','ssp-muted'));
 const row=txt('div',null,'ssp-actions');
 row.append(btn('Download JSON backup',()=>download('studyspire-planner.json',JSON.stringify(db,null,2),'application/json'),'primary'),
 btn('Calendar (.ics)',exportCalendar),
 btn('Tasks (.csv)',()=>{const quote=x=>'"'+String(x).replace(/"/g,'""')+'"';const rows=[['Title','Subject','Due','Minutes','Priority','Complete'],...db.tasks.map(t=>[t.title,t.subject,t.due,t.minutes,t.priority,t.done])];download('studyspire-tasks.csv',rows.map(r=>r.map(quote).join(',')).join('\r\n'),'text/csv')}));
 host.append(row);
 const label=txt('label','Import an existing planner backup (.json)');const file=document.createElement('input');file.type='file';file.accept='.json,application/json';
 file.onchange=async()=>{const f=file.files?.[0];if(!f)return;if(f.size>1000000){notice('Backup is larger than 1 MB.');return}
  try{const raw=JSON.parse(await f.text());if(raw.version!==1||!Array.isArray(raw.tasks)||!Array.isArray(raw.cards))throw Error('This is not a StudySpire planner backup.');
   const next=validate(raw);if(!confirm('Replace your planner with '+next.tasks.length+' tasks and '+next.cards.length+' review topics?'))return;
   db=next;save();notice('Planner restored.');render();
  }catch(e){notice('Import failed: '+e.message)}
 };
 label.append(file);host.append(label);
}
function mount(){
 if($('sspOverlay'))return;
 const overlay=txt('div',null,'ssp-overlay');overlay.id='sspOverlay';overlay.hidden=true;
 overlay.innerHTML='<section id="sspDialog" class="ssp-dialog" role="dialog" aria-modal="true" aria-labelledby="sspTitle" tabindex="-1">'+
 '<header><div><small>STUDYSPIRE · STUDY TOOLS</small><h2 id="sspTitle">Smart Study Planner</h2><p>Priority planning, review practice, and progress</p></div><button id="sspClose" type="button" class="ssp-close">✕ Close</button></header><p id="sspNotice" role="status" class="ssp-notice" hidden></p>'+
 '<nav class="ssp-tabs" role="tablist"><button data-ssp-tab="plan" role="tab">Plan</button><button data-ssp-tab="review" role="tab">Spaced review</button><button data-ssp-tab="insights" role="tab">Insights</button><button data-ssp-tab="backup" role="tab">Backup</button></nav>'+
 '<div id="ssp-plan"><form id="sspTaskForm" class="ssp-form"><label>Assignment or exam<input name="title" required maxlength="160" placeholder="Study for biology"></label><label>Subject<input name="subject" maxlength="60"></label><label>Due date<input name="due" type="date"></label><label>Minutes<input name="minutes" type="number" min="5" max="240" value="25"></label><label>Priority<select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></label><button class="ssp-button primary" type="submit">Add task</button></form><div class="ssp-grid"><section><h3>Your tasks</h3><input id="sspSearch" aria-label="Search tasks" placeholder="Find a task…"><div id="sspTasks"></div></section><section><h3>Next study blocks</h3><p id="sspPlanSummary" class="ssp-muted"></p><div id="sspSchedule"></div></section></div></div>'+
 '<div id="ssp-review" hidden><form id="sspCardForm" class="ssp-form"><label>Question<input name="question" required maxlength="240" placeholder="What is photosynthesis?"></label><label>Answer<input name="answer" required maxlength="600"></label><label>Subject<input name="subject" maxlength="60"></label><button class="ssp-button primary" type="submit">Add review topic</button></form><h3 id="sspReviewCount"></h3><div id="sspReviewCurrent"></div><h3>Your topics</h3><div id="sspCards"></div></div>'+
 '<div id="ssp-insights" hidden><div id="sspInsights"></div></div><div id="ssp-backup" hidden><div id="sspBackup"></div></div></section>';
 document.body.append(overlay);$('sspClose').onclick=close;overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&shown)close()});
 overlay.querySelectorAll('[data-ssp-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.sspTab;notice('');render()});
 $('sspSearch').oninput=renderPlan;
 $('sspTaskForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget),title=clean(f.get('title'));if(!title)return;
  db.tasks.push({id:id(),title,subject:clean(f.get('subject'),60),due:clean(f.get('due'),10),priority:clean(f.get('priority')),minutes:num(f.get('minutes'),5,240,25),done:false});e.currentTarget.reset();save();notice('Task added.');render()};
 $('sspCardForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget),question=clean(f.get('question'),240),answer=clean(f.get('answer'),600);if(!question||!answer)return;
  db.cards.push({id:id(),question,answer,subject:clean(f.get('subject'),60),due:iso(),interval:1});e.currentTarget.reset();save();notice('Review topic added.');render()};
 const nav=document.querySelector('.sidebar .sd-nav-group .nav')||document.querySelector('.sidebar .nav');
 if(nav){const b=txt('button');b.id='sspNav';b.type='button';b.innerHTML='<span class="navicon" aria-hidden="true">◷</span><span class="sd-navtext">Study Planner</span>';b.onclick=()=>open();nav.append(b)}
 const top=document.querySelector('.topright');if(top){const b=btn('◷ Planner',()=>open());b.id='sspTop';top.append(b)}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
window.StudySpirePlanner={open};
})();