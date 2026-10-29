/* StudySummit v3.80. Account-scoped study progress, compact UI and device health. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const scoped=name=>typeof window.sdAccountKey==='function'?window.sdAccountKey(name):name;
const key=()=>scoped('studydock-study-progress-v1');
const read=name=>{try{const o=JSON.parse(localStorage.getItem(scoped(name))||'{}');return o&&typeof o==='object'&&!Array.isArray(o)?o:{}}catch{return {}}};
const pad=n=>String(n).padStart(2,'0');
const dateKey=(d=new Date())=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const pRead=()=>{const p=read('studydock-study-progress-v1');if(!p.days||typeof p.days!=='object'||Array.isArray(p.days))p.days={};p.goal=Math.max(1,Math.min(8,Number(p.goal)||3));return p};
function pSave(p){try{const recent=Object.keys(p.days).sort().slice(-120);p.days=Object.fromEntries(recent.map(k=>[k,p.days[k]]));localStorage.setItem(key(),JSON.stringify(p))}catch(e){console.warn('Progress could not be saved',e)}}
function day(p,k=dateKey()){return p.days[k]||(p.days[k]={focus:0,minutes:0,cards:0,tasks:0})}
const number=n=>Math.max(0,Number(n)||0);
const points=b=>number(b?.focus)+Math.floor(number(b?.cards)/5)+number(b?.tasks);
function observeSuite(){
 const suite=read('studydock-suite-v1'),p=pRead(),now={focus:number(suite.stats?.focus),cards:number(suite.stats?.seen),tasks:Array.isArray(suite.tasks)?suite.tasks.filter(t=>t?.done).length:0};
 if(p.lastCounters){const d=day(p);for(const k of ['focus','cards','tasks'])d[k]+=Math.max(0,Math.min(100,now[k]-number(p.lastCounters[k])))}
 p.lastCounters=now;pSave(p);if(panel&&!panel.hidden&&activeTab==='progress')renderProgress();
}
function metric(title,value){const el=document.createElement('div');el.className='ssup-metric';const v=document.createElement('strong');v.textContent=String(value);const t=document.createElement('small');t.textContent=title;el.append(v,t);return el}
const validFocusMinutes=value=>{
 if(value===null||value===undefined||String(value).trim()==='')return null;
 const n=Number(value);
 return Number.isInteger(n)&&n>=1&&n<=180?n:null;
};
const focusTimeKey=()=>scoped('studydock-quick-focus-minutes-v1');
function storedFocusMinutes(){try{return validFocusMinutes(localStorage.getItem(focusTimeKey()))||25}catch{return 25}}
let panel=null,menu=null,activeTab='progress',running=false,endTime=0,chosenMinutes=storedFocusMinutes(),remaining=chosenMinutes*60,timer=null;
function streak(p){
 let count=0,d=new Date();d.setHours(12,0,0,0);if(!points(p.days[dateKey(d)]))d.setDate(d.getDate()-1);
 while(count<120&&points(p.days[dateKey(d)])){count++;d.setDate(d.getDate()-1)}return count;
}
function clock(){
 const s=Math.max(0,running?Math.ceil((endTime-Date.now())/1000):remaining);
 const formatted=pad(Math.floor(s/60))+':'+pad(s%60);
 const display=$('ssupClock');if(display)display.textContent=formatted;
 const home=$('ssHomeFocusOpen')?.querySelector('.ss-focus-dial strong');if(home)home.textContent=formatted;
 const b=$('ssupStart');if(b)b.textContent=running?'Pause':'Start focus';
 const presets=$('ssupLength');if(presets)presets.disabled=running;
 const custom=$('ssupCustomMinutes');if(custom)custom.disabled=running;
}
function pause(){if(running)remaining=Math.max(0,Math.ceil((endTime-Date.now())/1000));running=false;clearInterval(timer);timer=null;clock()}
function tick(){if(!running)return;remaining=Math.max(0,Math.ceil((endTime-Date.now())/1000));clock();if(remaining===0){pause();const p=pRead();day(p).focus++;day(p).minutes+=chosenMinutes;pSave(p);if($('ssupFocusNote'))$('ssupFocusNote').textContent='Nice work! Session saved. Time for a break 🎉';renderProgress()}}
function focusFieldMinutes(){
 const select=$('ssupLength');
 return validFocusMinutes(select?.value==='custom'?$('ssupCustomMinutes')?.value:select?.value);
}
function syncFocusFields(){
 const select=$('ssupLength'),input=$('ssupCustomMinutes'),field=$('ssupCustomField');
 if(!select||!input)return;
 select.value=[15,25,45].includes(chosenMinutes)?String(chosenMinutes):'custom';
 input.value=String(chosenMinutes);
 if(field)field.hidden=select.value!=='custom';
}
function resetTimer(){
 if(running)pause();
 const value=focusFieldMinutes();
 if(value===null){
  const input=$('ssupCustomMinutes');if(input)input.setAttribute('aria-invalid','true');
  const note=$('ssupFocusNote');if(note)note.textContent='Enter a whole number of minutes from 1 to 180.';
  return;
 }
 chosenMinutes=value;remaining=chosenMinutes*60;
 try{localStorage.setItem(focusTimeKey(),String(chosenMinutes))}catch(e){console.warn('Focus length could not be saved',e)}
 $('ssupCustomMinutes')?.removeAttribute('aria-invalid');
 clock();
 const note=$('ssupFocusNote');if(note)note.textContent='Ready for '+chosenMinutes+' minutes. Sessions count when finished.';
}
function startPause(){
 if(running){pause();return}
 if(focusFieldMinutes()===null){resetTimer();$('ssupCustomMinutes')?.focus();return}
 if(remaining<=0)remaining=chosenMinutes*60;
 running=true;endTime=Date.now()+remaining*1000;clearInterval(timer);timer=setInterval(tick,1000);clock();
}
function selectFocusLength(){
 if(running)return;
 const select=$('ssupLength'),field=$('ssupCustomField');
 if(field)field.hidden=select?.value!=='custom';
 resetTimer();
 if(select?.value==='custom')$('ssupCustomMinutes')?.focus();
}
function renderProgress(){
 if(!$('ssupMetrics'))return;const p=pRead(),d=day(p),suite=read('studydock-suite-v1'),lab=read('ss-study-lab-v374');
 const tasks=Array.isArray(suite.tasks)?suite.tasks:[],cards=Array.isArray(suite.cards)?suite.cards:[],assignments=Array.isArray(lab.assignments)?lab.assignments:[];
 const host=$('ssupMetrics');host.replaceChildren(metric('Flashcards',cards.length),metric('Finished tasks',tasks.filter(x=>x?.done).length+'/'+tasks.length),metric('Focus sessions',number(suite.stats?.focus)+Object.values(p.days).reduce((s,v)=>s+number(v.focus),0)),metric('Study streak',streak(p)+' days'));
 const value=points(d),pct=Math.min(100,Math.round(value/p.goal*100));$('ssupGoalLabel').textContent='Today: '+value+' / '+p.goal+' study points · '+pct+'%';$('ssupGoalBar').style.width=pct+'%';$('ssupGoal').value=String(p.goal);
 const chart=$('ssupWeek');chart.replaceChildren();
 for(let i=6;i>=0;i--){const dt=new Date();dt.setHours(12,0,0,0);dt.setDate(dt.getDate()-i);const score=points(p.days[dateKey(dt)]);const col=document.createElement('div');col.className='ssup-day';const bar=document.createElement('span');bar.style.height=Math.max(6,Math.min(100,100*score/p.goal))+'%';bar.title=dateKey(dt)+': '+score+' points';const label=document.createElement('small');label.textContent=dt.toLocaleDateString(undefined,{weekday:'short'});col.append(bar,label);chart.append(col)}
 const list=$('ssupUpcoming');list.replaceChildren();const open=assignments.filter(a=>!a?.done).sort((a,b)=>String(a.due||'').localeCompare(String(b.due||''))).slice(0,4);
 if(!open.length){const note=document.createElement('p');note.textContent='No upcoming assignments in your agenda.';list.append(note)}
 else for(const a of open){const el=document.createElement('div');el.className='ssup-assignment';const name=document.createElement('strong');name.textContent=String(a.name||'Assignment').slice(0,120);const due=document.createElement('small');due.textContent=String(a.due||'No due date');el.append(name,due);list.append(el)}
 const tip=$('ssupTip');tip.textContent=open.length?'📅 Next: '+String(open[0].name||'Assignment').slice(0,110):cards.length?'🧠 Review five flashcards for a study point.':'✨ Create a flashcard or finish a focus session to get started.';clock();
}
function button(label,fn,cls=''){const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=label;b.onclick=fn;return b}
function exportProgress(){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify({kind:'studysummit-progress',exportedAt:new Date().toISOString(),data:pRead()},null,2)],{type:'application/json'}));a.href=url;a.download='study-progress-'+dateKey()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1200)}
async function diagnostics(){
 const out=$('ssupDiagOutput');out.textContent='Checking your browser…';const parts=[];
 parts.push('Secure context: '+(window.isSecureContext?'yes':'no'));
 parts.push('WebGPU API: '+(navigator.gpu?'available':'unavailable'));
 if(navigator.gpu){try{const adapter=await Promise.race([navigator.gpu.requestAdapter(),new Promise((_,reject)=>setTimeout(()=>reject(Error('8-second timeout')),8000))]);parts.push('Compatible GPU adapter: '+(adapter?'yes':'no'));if(adapter)parts.push('Shader F16: '+(adapter.features?.has('shader-f16')?'yes':'no'))}catch(e){parts.push('GPU check: '+e.message)}}
 if(navigator.storage?.estimate){try{const e=await navigator.storage.estimate(),mb=n=>Math.round(number(n)/1048576);parts.push('Site storage used: '+mb(e.usage)+' MiB');parts.push('Browser storage quota estimate: '+mb(e.quota)+' MiB')}catch(e){parts.push('Storage: '+e.message)}}
 const cloud=typeof window.StudySummitCloudHealth==='function'?window.StudySummitCloudHealth():null;
 parts.push('Cloud: '+(cloud?.configured?(cloud.signedIn?'signed in ('+cloud.role+')':'configured, signed out'):'not configured'));
 if(cloud?.lastSyncAt)parts.push('Last cloud sync: '+new Date(cloud.lastSyncAt).toLocaleString());
 if(cloud?.syncError)parts.push('Sync issue: '+cloud.syncError.slice(0,180));
 parts.push('AI: '+String($('topMode')?.textContent||'not loaded').slice(0,100));
 parts.push('AI details: '+String($('localModelStatus')?.textContent||'none').slice(0,200));
 parts.push('Browser: '+navigator.userAgent.slice(0,160));
 out.textContent=parts.join('\n');
}
function showTab(which){
 activeTab=which;const diag=which==='health';$('ssupProgress').hidden=diag;$('ssupHealth').hidden=!diag;
 $('ssupTabProgress').setAttribute('aria-pressed',String(!diag));$('ssupTabHealth').setAttribute('aria-pressed',String(diag));
 if(!diag)renderProgress();
}
function createPanel(){
 if(panel)return;panel=document.createElement('section');panel.id='ssupShade';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Study progress and device health');
 panel.innerHTML='<div class="ssup-dialog"><header class="ssup-head"><div><small>STUDY SUMMIT</small><h2>✦ Your study hub</h2><p>Progress, focus and diagnostics in one place.</p></div><button id="ssupClose" type="button" aria-label="Close">✕</button></header>'+
 '<nav class="ssup-tabs"><button id="ssupTabProgress" aria-pressed="true" type="button">📈 Progress & Focus</button><button id="ssupTabHealth" aria-pressed="false" type="button">🩺 Health</button></nav>'+
 '<section id="ssupProgress"><div class="ssup-metrics" id="ssupMetrics"></div><div class="ssup-grid">'+
 '<article class="ssup-card"><h3>Daily goal</h3><p id="ssupGoalLabel"></p><div class="ssup-track"><span id="ssupGoalBar"></span></div><label for="ssupGoal">Points per day</label><select id="ssupGoal"><option>1</option><option>2</option><option selected>3</option><option>4</option><option>5</option><option>6</option><option>7</option><option>8</option></select><p class="ssup-muted">One session, finished task or five reviewed cards = one point.</p></article>'+
 '<article class="ssup-card"><h3>Last seven days</h3><div id="ssupWeek" class="ssup-week"></div><p class="ssup-muted">Activity is saved to your study account.</p></article>'+
 '<article class="ssup-card"><h3>Quick focus ⏱</h3><div id="ssupClock" class="ssup-clock">25:00</div><label for="ssupLength">Session length</label><select id="ssupLength"><option value="15">15 minutes</option><option value="25" selected>25 minutes</option><option value="45">45 minutes</option><option value="custom">Custom time…</option></select><div id="ssupCustomField" class="ssup-custom-duration" hidden><label for="ssupCustomMinutes">Custom minutes (1–180)</label><input id="ssupCustomMinutes" type="number" min="1" max="180" step="1" value="25" inputmode="numeric" aria-describedby="ssupFocusNote"/></div><div class="ssup-actions"><button id="ssupStart" type="button">Start focus</button><button id="ssupReset" type="button">Reset</button></div><p id="ssupFocusNote" class="ssup-muted" role="status" aria-live="polite">Sessions count when finished.</p></article>'+
 '<article class="ssup-card"><h3>Upcoming assignments</h3><div id="ssupUpcoming"></div></article></div>'+
 '<article class="ssup-card"><h3>Today’s suggestion</h3><p id="ssupTip"></p></article><button id="ssupExport" type="button">↓ Export progress</button></section>'+
 '<section id="ssupHealth" hidden><article class="ssup-card"><h3>Device & cloud diagnostics</h3><p>Safe browser information only; no credentials are shown.</p><div class="ssup-actions"><button id="ssupRun" type="button">Run diagnostics</button><button id="ssupCopy" type="button">Copy results</button></div><pre id="ssupDiagOutput" tabindex="0">Press Run diagnostics to check this device.</pre></article></section></div>';
 document.body.append(panel);syncFocusFields();clock();$('ssupClose').onclick=close;$('ssupTabProgress').onclick=()=>showTab('progress');$('ssupTabHealth').onclick=()=>showTab('health');
 $('ssupGoal').onchange=e=>{const p=pRead();p.goal=Number(e.target.value)||3;pSave(p);renderProgress()};
 $('ssupStart').onclick=startPause;$('ssupReset').onclick=resetTimer;$('ssupLength').onchange=selectFocusLength;
 $('ssupCustomMinutes').onchange=()=>{if(!running)resetTimer()};
 $('ssupExport').onclick=exportProgress;$('ssupRun').onclick=()=>diagnostics().catch(e=>{$('ssupDiagOutput').textContent='Diagnostics failed: '+e.message});
 $('ssupCopy').onclick=()=>navigator.clipboard?.writeText($('ssupDiagOutput').textContent).catch(()=>{$('ssupDiagOutput').focus()});
 panel.onclick=e=>{if(e.target===panel)close()};
}
function open(which='progress'){createPanel();panel.hidden=false;showTab(which);$('ssupClose').focus({preventScroll:true})}
function close(){if(panel)panel.hidden=true}
const commands=[
 ['📈 Study progress','goals dashboard',()=>open('progress')],
 ['⏱ Quick focus','timer',()=>{open('progress');$('ssupStart').focus()}],
 ['🩺 Device diagnostics','gpu cloud',()=>open('health')],
 ['⚙ Settings & AI','theme ai',()=>$('openSettings')?.click()],
 ['☁ Manage account','password switch sign in',()=>$('sdAccountOpen')?.click()],
 ['💬 Messages & friends','messages friends requests chat sharing',()=>document.querySelector('button[data-suite-target="friends"]')?.click()],
 ['📚 Saved work','history notes',()=>document.querySelector('button[data-page="saved"]')?.click()],
 ['✦ Ask the tutor','question',()=>document.querySelector('button[data-page="answer"]')?.click()]
];
function menuRender(){const list=$('ssupResults');if(!list)return;list.replaceChildren();const q=String($('ssupSearch')?.value||'').toLowerCase();for(const [label,words,fn] of commands.filter(c=>(c[0]+' '+c[1]).toLowerCase().includes(q))){list.append(button(label,()=>{menu.hidden=true;fn()},'ssup-result'))}if(!list.childElementCount)list.textContent='No matching actions.'}
function openMenu(){
 if(!menu){menu=document.createElement('section');menu.id='ssupCommands';menu.hidden=true;menu.setAttribute('role','dialog');menu.setAttribute('aria-modal','true');menu.setAttribute('aria-label','Quick actions');
 menu.innerHTML='<div class="ssup-menu"><label for="ssupSearch">⌘ Quick actions</label><input id="ssupSearch" type="search" placeholder="Search actions…" autocomplete="off"/><div id="ssupResults"></div><small>Escape to close · Ctrl/⌘+K to toggle</small></div>';document.body.append(menu);menu.onclick=e=>{if(e.target===menu)menu.hidden=true};$('ssupSearch').oninput=menuRender}
 menu.hidden=false;$('ssupSearch').value='';menuRender();$('ssupSearch').focus();
}
function compactSidebar(){
 // StudySummit already has an account-scoped collapsible sidebar. Reuse it.
 const existing=$('sdSidebarToggle');if(existing){existing.title+=' · Ctrl+B';return}
 const brand=document.querySelector('.sidebar .brand');if(!brand||$('ssupSidebar'))return;
 const btn=button('☰',()=>{
  const compact=!document.body.classList.contains('ssup-compact');document.body.classList.toggle('ssup-compact',compact);btn.setAttribute('aria-pressed',String(compact));
  try{localStorage.setItem('ss-compact-navigation-v1',String(compact))}catch{}
 },'ssup-sidebar-button');btn.id='ssupSidebar';btn.title='Toggle compact sidebar';btn.setAttribute('aria-label','Toggle compact sidebar');
 try{document.body.classList.toggle('ssup-compact',localStorage.getItem('ss-compact-navigation-v1')==='true')}catch{}
 btn.setAttribute('aria-pressed',String(document.body.classList.contains('ssup-compact')));brand.append(btn);
}
function simplifyAI(){
 const parent=$('localAiPanel');if(!parent||$('ssupAdvancedAI'))return;
 const details=document.createElement('details');details.id='ssupAdvancedAI';const summary=document.createElement('summary');summary.textContent='⚙ Advanced settings (subject and answer length)';details.append(summary);
 const subject=parent.querySelector('label[for="localSubjectChoice"]')?.closest('.fieldgroup');
 const speed=parent.querySelector('label[for="ssTutorSpeed"]')?.closest('.fieldgroup');
 if(subject)details.append(subject);if(speed)details.append(speed);
 const row=$('loadLocalModel')?.closest('.row');if(row)parent.insertBefore(details,row);else parent.append(details);
 if(row)row.append(button('🩺 Check GPU',()=>open('health'),'ssup-ai-gpu'));
 const status=$('localModelStatus');if(status&&typeof MutationObserver==='function'){
  const progress=document.createElement('progress');progress.id='ssupModelProgress';progress.max=100;progress.value=0;progress.hidden=true;status.insertAdjacentElement('afterend',progress);
  new MutationObserver(()=>{
    const text=status.textContent||'',pct=text.match(/\((\d{1,3})%\)/);
    if(pct){progress.value=Math.min(100,Number(pct[1]));progress.hidden=false}
    else if(/ready|disconnected|could not load|not loaded|stalled/i.test(text))progress.hidden=true;
  }).observe(status,{childList:true,subtree:true,characterData:true});
 }
}
function init(){
 compactSidebar();const header=document.querySelector('.topbar');
 if(header&&!$('ssupTopActions')){const actions=document.createElement('div');actions.id='ssupTopActions';actions.append(button('📈 Progress',()=>open('progress')),button('🩺 Health',()=>open('health')),button('⌘ K',openMenu));header.append(actions)}
 document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(menu&&!menu.hidden)menu.hidden=true;else openMenu()}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='b'){const toggle=$('sdSidebarToggle');if(toggle){e.preventDefault();toggle.click()}}
  else if(e.key==='Escape'){if(menu)menu.hidden=true;close()}
  else if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.target?.matches?.('input,textarea,select,[contenteditable]')){e.preventDefault();openMenu()}
 });
 let pendingProgress=0;
 window.addEventListener('ss-suite-updated',()=>{clearTimeout(pendingProgress);pendingProgress=setTimeout(observeSuite,180)});
 window.addEventListener('storage',e=>{if(e.key===key()||e.key===scoped('studydock-suite-v1')||e.key===scoped('ss-study-lab-v374')){if(panel&&!panel.hidden)renderProgress()}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){tick();if(panel&&!panel.hidden)renderProgress()}});
 observeSuite();simplifyAI();
 // Home is inserted by its own DOMContentLoaded handler, so update its timer after mount.
 requestAnimationFrame(clock);
 window.StudySummitEnhancements={openProgress:()=>open('progress'),openDiagnostics:()=>open('health'),openCommands:openMenu,observeSuite};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();