/* StudySpire home v3.90: adds a real dashboard without replacing existing study features. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const suite=()=>window.__KEEP_STUDYSYNCKSUITE__;
const list=v=>Array.isArray(v)?v:[];
let home;
const specs=[
  ['AI Tutor','✦','Get explanations and study help.','answer'],
  ['Flashcards','▤','Create and review flashcards.','quiz'],
  ['Assignments','☑','Manage due dates and tasks.','agenda'],
  ['Documents','▧','Create notes, organize files, and save documents.','files'],
  ['Friends','♧','Chat and share study materials.','friends']
];
function navigate(target){
  if(target==='answer'){document.querySelector('.sidebar .nav button[data-page="answer"]')?.click();return}
  // Prefer the visible Documents tab when Home cards open the merged workspace,
  // so the active sidebar highlight agrees with the opened page.
  if(target==='files'){
    const docsButton=document.querySelector('.ss-primary-nav [data-ss-nav-route="files"]');
    if(docsButton){docsButton.click();return}
  }
  const btn=document.querySelector('.sidebar .nav button[data-suite-target="'+target+'"]');
  if(btn){btn.click();return}
  // Documents is a Study Suite pane, but has no legacy sidebar button of its own.
  // Activate the existing Suite route first; then select the requested pane.
  const suiteEntry=document.querySelector('.sidebar .nav button[data-suite-target="agenda"]');
  if(suiteEntry)suiteEntry.click();
  else if(typeof window.switchPage==='function')window.switchPage('suite');
  suite()?.showPane(target);
}
function updateBrand(){
  document.title='StudySpire | Academic AI';
  const brand=document.querySelector('.brandname');
  if(brand&&!brand.querySelector('.ss-word-spire')){
    const spire=document.createElement('span');spire.className='ss-word-spire';spire.textContent='Spire';
    brand.replaceChildren(document.createTextNode('Study'),spire);
  }
  const mobile=document.querySelector('.sd-mobile-brand');
  if(mobile)mobile.textContent='✦ StudySpire';
  const crumb=document.querySelector('.topbar .crumb');
  if(crumb?.firstChild?.nodeType===3)crumb.firstChild.nodeValue='StudySpire ';
  document.querySelectorAll('img[alt*="Study Summit" i], img[alt*="StudySummit" i]').forEach(img=>{
    img.src='studyspire-mark.svg';img.alt='StudySpire spire-and-book icon';
  });
  const launcher=$('miniLauncher');
  if(launcher){
    launcher.title='Open StudySpire Mini';launcher.setAttribute('aria-label','Open floating StudySpire Mini');
    const label=launcher.querySelector('.mini-launcher-label');
    if(label)label.textContent='StudySpire Mini';
  }
  const eyebrow=$('page-suite')?.querySelector('.hero .eyebrow');
  if(eyebrow)eyebrow.textContent='StudySpire · all-in-one';
  const subtitle=document.querySelector('.brandsub');
  if(subtitle)subtitle.textContent='ACADEMIC AI';
}
function addTool(spec){
  const btn=document.createElement('button');btn.type='button';btn.className='ss-tool-card';btn.setAttribute('aria-label','Open '+spec[0]);
  const icon=document.createElement('span');icon.className='ss-tool-icon';icon.setAttribute('aria-hidden','true');icon.textContent=spec[1];
  const title=document.createElement('strong');title.textContent=spec[0];
  const desc=document.createElement('small');desc.textContent=spec[2];
  btn.append(icon,title,desc);btn.addEventListener('click',()=>navigate(spec[3]));return btn;
}
function createHome(){
  home=document.createElement('section');home.id='page-home';home.className='page ss-page-home';home.setAttribute('aria-label','StudySpire Home');
  home.innerHTML=[
    "<header class='ss-home-hero'>",
      "<div class='ss-home-hero-copy'><span class='ss-hero-eyebrow'>ACADEMIC AI</span>",
      "<h1>Study<span class='ss-word-spire'>Spire</span></h1>",
      "<h2>Your AI-powered study partner for a brighter future.</h2>",
      "<p>Learn smarter. Stay organized. Achieve more. Everything you need to study, in one calm space.</p></div>",
      "<div class='ss-home-art'><img src='studyspire-mark.svg' alt='StudySpire spire rising from an open book' width='215' height='228'></div>",
    "</header>",
    "<h2 class='ss-home-section-label' id='ssHomeToolsHeading'>Your study tools</h2>",
    "<div class='ss-home-tools' role='group' aria-labelledby='ssHomeToolsHeading' id='ssHomeTools'></div>",
    "<div class='ss-home-lower'>",
      "<section class='ss-home-panel' aria-labelledby='ssHomePlanTitle'>",
        "<div class='ss-panel-header'><h2 id='ssHomePlanTitle' class='ss-panel-title'>Today’s Plan</h2>",
        "<span class='ss-panel-meta' id='ssHomePlanMeta'></span></div>",
        "<div class='ss-home-plan-list' id='ssHomePlanList'></div>",
      "</section>",
      "<section class='ss-home-panel' aria-labelledby='ssHomeFocusTitle'>",
        "<div class='ss-panel-header'><h2 id='ssHomeFocusTitle' class='ss-panel-title'>Focus Mode</h2>",
        "<span class='ss-panel-meta'>Study at your pace</span></div>",
        "<button class='ss-focus-link' type='button' id='ssHomeFocusOpen' aria-label='Open the focus timer'>",
          "<span class='ss-focus-dial'><span><strong>25:00</strong><br><small>Focus time</small></span></span>",
          "<span class='ss-panel-hint'>Open your focus timer ↗</span>",
        "</button>",
      "</section>",
      "<section class='ss-home-panel' aria-labelledby='ssHomeFriendsTitle'>",
        "<div class='ss-panel-header'><h2 id='ssHomeFriendsTitle' class='ss-panel-title'>Friends &amp; Files</h2>",
        "<span class='ss-panel-meta'>Your workspace</span></div>",
        "<button class='ss-friends-link' id='ssHomeFriendsOpen' type='button'>",
          "<strong>♧ &nbsp;StudySpire Friends</strong><span>Message friends and share flashcards ↗</span></button>",
        "<div class='ss-home-drive'><strong>☁ &nbsp;Saved Documents</strong>",
          "<p id='ssHomeDocuments'>Your documents will appear here.</p>",
          "<button class='ss-home-panel-link' id='ssHomeFilesOpen' type='button'>Open your files ↗</button>",
        "</div>",
      "</section>",
    "</div>"
  ].join('');
  const first=$('page-answer');
  if(!first?.parentElement)return false;
  first.parentElement.insertBefore(home,first);
  for(const s of specs)$('ssHomeTools').append(addTool(s));
  $('ssHomeFriendsOpen').addEventListener('click',()=>navigate('friends'));
  $('ssHomeFilesOpen').addEventListener('click',()=>navigate('files'));
  $('ssHomeFocusOpen').addEventListener('click',()=>{
    const progress=$('ssupTopActions')?.querySelector('button');
    if(progress)progress.click();else navigate('focus');
  });
  return true;
}
function createNav(){
  const nav=document.querySelector('.sidebar .sd-nav-group .nav');
  if(!nav||$('ssHomeNav'))return;
  const btn=document.createElement('button');btn.type='button';btn.id='ssHomeNav';btn.dataset.page='home';btn.title='Home';
  btn.innerHTML='<span class="navicon" aria-hidden="true">⌂</span><span class="sd-navtext">Home</span>';
  nav.prepend(btn);
  btn.addEventListener('click',()=>{
    if(typeof window.switchPage==='function')window.switchPage('home');
    else{
      document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p===home));
      document.querySelectorAll('.sidebar .nav button').forEach(b=>b.classList.toggle('active',b===btn));
      if($('crumbPage'))$('crumbPage').textContent='Home';
    }
    syncHome();
  });
  // Home replaces the redundant legacy Study Center menu entry.
  // Keep the suite's internal welcome pane so existing tools stay functional.
  nav.querySelector('button[data-suite-target="welcome"]')?.remove();
  btn.click();
}
function createPlanRow(item,kind){
  const row=document.createElement('label');row.className='ss-plan-row';
  const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=!!item.done;
  checkbox.setAttribute('aria-label','Mark '+String(item.name||'Task').slice(0,100)+' completed');
  checkbox.addEventListener('change',()=>{
    item.done=checkbox.checked;
    try{suite()?.refreshData()}catch(e){console.warn('Could not save task completion',e)}
    renderData();
  });
  const title=document.createElement('span');title.className='ss-plan-title';title.textContent=String(item.name||'Study task').slice(0,150);
  const date=document.createElement('span');date.className='ss-plan-date';date.textContent=kind==='assignment'?String(item.due||'').slice(0,10):'Task';
  row.append(checkbox,title,date);return row;
}
function renderData(){
  if(!home?.classList.contains('active'))return;
  const out=$('ssHomePlanList');if(!out)return;
  let data={};try{data=suite()?.getData()||{}}catch{}
  const tasks=list(data.tasks).filter(x=>x&&typeof x==='object');
  const assignments=list(data.assignments).filter(x=>x&&typeof x==='object');
  const chosen=[
    ...assignments.filter(a=>!a.done).sort((a,b)=>String(a.due||'').localeCompare(String(b.due||''))).slice(0,4).map(item=>[item,'assignment']),
    ...tasks.filter(t=>!t.done).slice(0,5).map(item=>[item,'task']),
    ...tasks.filter(t=>t.done).slice(-5).reverse().map(item=>[item,'task'])
  ].slice(0,5);
  out.replaceChildren();
  if(!chosen.length){
    const p=document.createElement('p');p.className='ss-home-empty';
    p.textContent='Nothing planned yet. Open Assignments to add due dates or Study Planner to make a task.';
    out.append(p);
  }else for(const [item,kind] of chosen)out.append(createPlanRow(item,kind));
  const total=tasks.length+assignments.length;
  const done=tasks.filter(t=>t.done).length+assignments.filter(a=>a.done).length;
  const meta=$('ssHomePlanMeta');
  if(meta)meta.textContent=total?done+'/'+total+' completed':new Date().toLocaleDateString(undefined,{month:'short',day:'numeric'});
  const docs=list(data.docs);
  const files=$('ssHomeDocuments');
  if(files)files.textContent=docs.length
    ?docs.length+' saved document'+(docs.length===1?'':'s')+' in your study workspace.'
    :'No saved documents yet. Open your files to create one.';
}
function syncHome(){
  document.body.classList.toggle('ss-home-active',!!home?.classList.contains('active'));
  renderData();
}
function init(){
  updateBrand();
  if(!createHome())return;
  document.body.classList.add('ss-brand-ready');
  createNav();
  window.addEventListener('ss-suite-updated',renderData);
  window.addEventListener('storage',e=>{if(e.key?.includes('studydock-suite-v1'))renderData()});
  if(typeof MutationObserver==='function'){
    new MutationObserver(syncHome).observe(home,{attributeFilter:['class'],attributes:true});
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
})();