/* StudySpire v3.91 — Screenshot-faithful dashboard presentation.
   This layer reuses the existing, tested study suite, Mini, Help and Cloud account handlers.
   It does not introduce demo profiles, fabricated online states or paywalls. */
(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const suite=()=>window.__KEEP_STUDYSYNCKSUITE__;
  const getData=()=>{try{return suite()?.getData()||{}}catch{return {}}};
  const arr=a=>Array.isArray(a)?a:[];
  const icons={
    tutor:'<svg viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8.3 8.3 0 0 1-3.2-.6L4 20l1.4-4.1A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" stroke-width="2.7" stroke-linecap="round"/></svg>',
    cards:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="14" rx="2"/><path d="M8 8h8M8 12h6M7 21h10"/></svg>',
    assignment:'<svg viewBox="0 0 24 24"><path d="M7 3h8l4 4v13a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
    notes:'<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    planner:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 18h2"/></svg>',
    friends:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v1"/></svg>',
    cloud:'<svg viewBox="0 0 24 24"><path d="M7 19h12a4 4 0 0 0 .1-8A6.5 6.5 0 0 0 6.5 9 5 5 0 0 0 7 19Z"/></svg>',
    topic:'<svg viewBox="0 0 24 24"><path d="M5 4h13a2 2 0 0 1 2 2v14H7a3 3 0 0 1-3-3V6a2 2 0 0 1 1-2Z"/><path d="M4 17a3 3 0 0 1 3-3h13M8 8h8"/></svg>',
    writing:'<svg viewBox="0 0 24 24"><path d="m4 20 4.8-1.2L20 7.6 16.4 4 5.2 15.2 4 20ZM14 6.4l3.6 3.6M4 22h16"/></svg>',
    progress:'<svg viewBox="0 0 24 24"><path d="M4 20V4M4 20h17M8 16v-4M13 16V8M18 16V5"/></svg>',
    saved:'<svg viewBox="0 0 24 24"><path d="M5 3h14a1 1 0 0 1 1 1v17l-8-5-8 5V4a1 1 0 0 1 1-1Z"/></svg>',
    shield:'<svg viewBox="0 0 24 24"><path d="m12 2 8 4v5c0 5-3.3 8.5-8 11-4.7-2.5-8-6-8-11V6l8-4Z"/><path d="M12 7v6M12 17h.01"/></svg>',
    settings:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.3"/><path d="M9.5 2h5l.6 2.6 2 1.1 2.5-.9 2.5 4.4-2 1.8v2.2l2 1.8-2.5 4.4-2.5-.9-2 1.1-.6 2.4h-5l-.6-2.4-2-1.1-2.5.9L2 15l2-1.8V11L2 9.2l2.4-4.4 2.5.9 2-1.1L9.5 2Z"/></svg>',
    search:'<svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.7"/><path d="m16 16 5 5"/></svg>',
    bell:'<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>',
    plus:'<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'
  };
  const svg=k=>icons[k]||icons.notes;
  let searchInput=null,searchPopup=null,noticeButton=null,noticePopup=null;
  let friendLastFetch=0,friendRequestKey='',friendsCache=[];
  let lastSearchActions=[];

  function navTo(target){
    if(target==='answer')return document.querySelector('.sidebar .nav button[data-page="answer"]')?.click();
    const match=document.querySelector('.sidebar .nav button[data-suite-target="'+target+'"]');
    if(match)return match.click();
    // 'files' has no original sidebar route. Navigate through a real Suite
    // button so the page is activated, then open the document workspace.
    const suiteEntry=document.querySelector('.sidebar .nav button[data-suite-target="agenda"]');
    if(suiteEntry)suiteEntry.click();
    else if(typeof window.switchPage==='function')window.switchPage('suite');
    suite()?.showPane(target);
  }
  function actionNav(label,icon,target){
    const b=document.createElement('button');b.type='button';b.className='ss-screenshot-nav-button';
    b.title=label;b.setAttribute('aria-label',label);b.dataset.ssNavRoute=target;
    b.innerHTML='<span class="navicon" aria-hidden="true"></span><span class="sd-navtext"></span>';
    b.querySelector('.navicon').innerHTML=svg(icon);
    b.querySelector('.sd-navtext').textContent=label;
    b.addEventListener('click',()=>{navTo(target);setNavActive(b)});
    return b;
  }
  function setNavActive(button){
    document.querySelectorAll('.ss-primary-nav button').forEach(b=>b.classList.toggle('active',b===button));
  }
  function moveOriginal(nav,selector,label,icon){
    const btn=document.querySelector('.sidebar .sd-nav-group .nav '+selector);
    if(!btn)return null;
    const text=btn.querySelector('.sd-navtext');
    const count=text?.querySelector('#ssAdminSideCount');
    if(text){text.textContent=label;if(count)text.append(' ',count)}
    const pict=btn.querySelector('.navicon');if(pict)pict.innerHTML=svg(icon);
    btn.title=label;btn.setAttribute('aria-label',label);nav.append(btn);
    btn.addEventListener('click',()=>setNavActive(btn));
    return btn;
  }
  function installSidebar(){
    const side=document.querySelector('.sidebar');if(!side||$('ssScreenshotNav'))return;
    const groups=[...side.querySelectorAll(':scope > .sd-nav-group')];if(!groups.length)return;
    const nav=document.createElement('nav');nav.id='ssScreenshotNav';nav.className='nav ss-primary-nav';nav.setAttribute('aria-label','Main StudySpire navigation');
    groups[0].insertAdjacentElement('beforebegin',nav);
    const homeBtn=$('ssHomeNav');if(homeBtn){nav.append(homeBtn);homeBtn.title='Home';homeBtn.setAttribute('aria-label','Home');homeBtn.querySelector('.navicon').innerHTML='<svg viewBox="0 0 24 24"><path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></svg>';homeBtn.addEventListener('click',()=>setNavActive(homeBtn))}
    // One flat, always-visible column: keep the original page handlers and access checks.
    moveOriginal(nav,'button[data-page="answer"]','AI Tutor','tutor');
    moveOriginal(nav,'button[data-suite-target="topic"]','Topic lessons','topic');
    moveOriginal(nav,'button[data-suite-target="quiz"]','Flashcards','cards');
    moveOriginal(nav,'button[data-page="essay"]','Writing feedback','writing');
    moveOriginal(nav,'button[data-suite-target="agenda"]','Assignments','assignment');
    moveOriginal(nav,'button[data-suite-target="learning"]','Skills & progress','progress');
    nav.append(actionNav('Documents','notes','files'));
    moveOriginal(nav,'button[data-suite-target="friends"]','Friends','friends');
    moveOriginal(nav,'button[data-page="saved"]','Saved work','saved');
    moveOriginal(nav,'button[data-suite-target="admin"]','Admin moderation','shield');
    // Preserve any future sidebar tabs rather than burying them in another menu.
    groups.forEach(group=>{
      group.querySelectorAll('.nav > button').forEach(button=>nav.append(button));
      group.remove();
    });
    const settings=$('openSettingsSide');
    if(settings){
      settings.className='ss-sidebar-settings';
      settings.innerHTML='<span class="navicon" aria-hidden="true"></span><span class="sd-navtext">Settings</span>';
      settings.querySelector('.navicon').innerHTML=svg('settings');
      settings.title='Settings';settings.setAttribute('aria-label','Settings');
      nav.append(settings);
    }
    setNavActive(homeBtn);
  }
  function formatDate(value){
    if(!value)return 'Task';
    const day=String(value).slice(0,10);
    const d=new Date(day+'T12:00:00');
    return Number.isNaN(d.getTime())?day:d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  }
  function refineHome(){
    const home=$('page-home');if(!home||home.dataset.ssScreenshotReady)return;
    home.dataset.ssScreenshotReady='true';
    const hero=home.querySelector('.ss-home-hero');
    hero?.querySelector('.ss-home-art')?.remove();
    hero?.querySelector('h2')?.replaceChildren('Your AI-powered study partner',' for a brighter future.');
    const description=hero?.querySelector('p');
    if(description)description.textContent='Learn smarter. Stay organized. Achieve more. StudySpire combines powerful study tools and AI to help you reach your goals.';
    const artLabel=document.createElement('span');artLabel.className='ss-hero-art-alt';artLabel.setAttribute('role','img');artLabel.setAttribute('aria-label','Open book rising into a blue spire with the words Higher Learning, Brighter Tomorrows');
    hero?.append(artLabel);
    const tools=$('ssHomeTools');if(tools){
      tools.querySelectorAll('.ss-tool-card').forEach((b,i)=>{
        const graphic=b.querySelector('.ss-tool-icon');
        if(graphic)graphic.innerHTML=svg(['tutor','cards','assignment','notes','friends'][i]);
        const subtitle=b.querySelector('small');
        const copy=[
          'Get instant help, explanations, and step-by-step solutions.',
          'Create and study flashcards with AI in seconds.',
          'Track, manage, and get help with your assignments.',
          'Write notes, organize documents, and keep your materials together.',
          'Study together and keep each other accountable.'
        ][i];
        if(subtitle)subtitle.textContent=copy;
      });
    }
    const plan=home.querySelector('#ssHomePlanList')?.closest('.ss-home-panel');
    if(plan){
      plan.classList.add('ss-screenshot-plan');
      const title=plan.querySelector('.ss-panel-title');if(title)title.innerHTML='<span aria-hidden="true" class="ss-panel-heading-icon">▦</span> Today’s Plan';
      const header=plan.querySelector('.ss-panel-header');
      const date=document.createElement('time');date.className='ss-plan-today-date';date.id='ssHomeDate';
      date.dateTime=new Date().toISOString().slice(0,10);
      date.textContent=new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'});
      header?.append(date);
    }
    const focus=$('ssHomeFocusOpen')?.closest('.ss-home-panel');
    if(focus){
      focus.classList.add('ss-screenshot-focus');
      const title=focus.querySelector('.ss-panel-title');if(title)title.innerHTML='<span class="ss-panel-heading-icon" aria-hidden="true">◎</span> Focus Mode';
      const label=focus.querySelector('.ss-panel-meta');if(label)label.textContent='';
      const caption=focus.querySelector('.ss-panel-hint');if(caption)caption.textContent='“Small steps lead to big progress.”';
    }
    const right=home.querySelector('#ssHomeFriendsOpen')?.closest('.ss-home-panel');
    if(right){
      const lower=right.parentElement;
      const stack=document.createElement('div');stack.className='ss-home-right-stack';
      const friends=document.createElement('section');friends.className='ss-home-panel ss-screenshot-friends';
      friends.innerHTML='<div class="ss-panel-header"><h2 class="ss-panel-title"><span aria-hidden="true" class="ss-panel-heading-icon">♧</span> StudySpire Friends</h2></div><div id="ssHomeFriendList" class="ss-home-friend-list"></div>';
      const friendsBtn=$('ssHomeFriendsOpen');friendsBtn.className='ss-home-panel-link';friendsBtn.textContent='View all ↗';
      friends.querySelector('.ss-panel-header').append(friendsBtn);
      const drive=document.createElement('section');drive.className='ss-home-panel ss-screenshot-drive';
      drive.innerHTML='<div class="ss-panel-header"><h2 class="ss-panel-title"><span class="ss-panel-heading-icon" aria-hidden="true">☁</span> Cloud Drive</h2></div><div id="ssHomeDocumentList" class="ss-home-document-list"></div>';
      const filesBtn=$('ssHomeFilesOpen');filesBtn.textContent='View all ↗';filesBtn.className='ss-home-panel-link';
      drive.querySelector('.ss-panel-header').append(filesBtn);
      const summary=$('ssHomeDocuments');
      if(summary){summary.classList.add('ss-visually-hidden');drive.append(summary)}
      stack.append(friends,drive);
      lower.replaceChild(stack,right);
    }
    const homeTitle=$('ssHomeToolsHeading');if(homeTitle)homeTitle.classList.add('ss-visually-hidden');
  }
  function renderDocuments(){
    const listHost=$('ssHomeDocumentList');if(!listHost)return;
    const docs=arr(getData().docs).slice(0,3);
    listHost.replaceChildren();
    if(!docs.length){const p=document.createElement('p');p.className='ss-compact-empty';p.textContent='No documents yet. Save a note to see it here.';listHost.append(p);return}
    for(const doc of docs){
      const row=document.createElement('button');row.type='button';row.className='ss-document-row';
      const icon=document.createElement('span');icon.className='ss-document-icon';icon.textContent='▤';
      const name=document.createElement('span');name.className='ss-document-name';name.textContent=String(doc.name||'Untitled document').slice(0,70);
      row.append(icon,name);row.addEventListener('click',()=>navTo('files'));listHost.append(row);
    }
  }
  function showFriends(){
    const host=$('ssHomeFriendList');if(!host)return;
    host.replaceChildren();
    if(!friendsCache.length){
      const note=document.createElement('p');note.className='ss-compact-empty';
      const cloud=window.StudySummitMessagingBridge;
      note.textContent=cloud?.account?.()?'No friends yet. Find classmates to study together.':'Sign in to see your StudySpire friends.';
      host.append(note);return;
    }
    for(const friend of friendsCache.slice(0,4)){
      const row=document.createElement('button');row.type='button';row.className='ss-friend-row';
      const avatar=document.createElement('span');avatar.className='ss-friend-avatar';avatar.textContent=String(friend.username||'?')[0].toUpperCase();
      // Friend thumbnails are fetched by exact username; only approved WebP images render.
      window.StudySpireAvatars?.decorate(avatar,friend.username);
      const text=document.createElement('span');text.className='ss-friend-name';text.textContent='@'+String(friend.username||'').slice(0,32);
      window.StudySpireRoles?.decorateLabel(text,friend.username);
      const small=document.createElement('span');small.className='ss-friend-hint';small.textContent='Open conversation';
      const labels=document.createElement('span');labels.className='ss-friend-labels';labels.append(text,small);row.append(avatar,labels);
      row.addEventListener('click',()=>navTo('friends'));host.append(row);
    }
  }
  async function refreshFriends(force=false){
    const bridge=window.StudySummitMessagingBridge;
    const acct=bridge?.account?.();
    const key=acct?.id||'';
    if(key!==friendRequestKey){friendRequestKey=key;friendsCache=[];friendLastFetch=0;showFriends()}
    if(!key||!bridge?.configured||typeof bridge.rpc!=='function'){showFriends();return}
    if(!force&&Date.now()-friendLastFetch<45000)return;
    friendLastFetch=Date.now();
    try{
      const overview=await bridge.rpc('ss_social_overview');
      if(bridge.account?.()?.id!==key)return;
      friendsCache=arr(overview?.friends).filter(f=>f&&typeof f.username==='string');
      showFriends();
      const incoming=arr(overview?.incoming).length;
      if(noticeButton)noticeButton.classList.toggle('ss-has-notifications',incoming>0);
    }catch(err){console.warn('StudySpire friend preview unavailable:',String(err?.message||err));showFriends()}
  }
  function refreshOverview(){
    if(!$('page-home')?.classList.contains('active'))return;
    renderDocuments();showFriends();void refreshFriends();
  }
  function filterResults(query){
    const terms=String(query||'').toLowerCase().trim();if(!terms)return [];
    const results=[];
    const add=(title,kind,action)=>{if(results.length<8)results.push({title,kind,action})};
    const navigation=[['Home',()=> $('ssHomeNav')?.click()],['AI Tutor',()=>navTo('answer')],['Flashcards',()=>navTo('quiz')],['Assignments',()=>navTo('agenda')],['Documents',()=>navTo('files')],['Friends',()=>navTo('friends')],['Settings',()=> $('openSettings')?.click()],['How to Use',()=> $('ssHelpTopButton')?.click()]];
    navigation.forEach(([name,action])=>{if(name.toLowerCase().includes(terms))add(name,'StudySpire tool',action)});
    const data=getData();
    arr(data.docs).forEach(doc=>{if(String(doc?.name||'').toLowerCase().includes(terms))add(String(doc.name).slice(0,85),'Saved document',()=>navTo('files'))});
    arr(data.cards).forEach(card=>{if(String(card?.front||'').toLowerCase().includes(terms))add(String(card.front).slice(0,85),'Flashcard',()=>navTo('quiz'))});
    arr(data.assignments).forEach(item=>{if(String(item?.name||'').toLowerCase().includes(terms))add(String(item.name).slice(0,85),'Assignment',()=>navTo('agenda'))});
    return results;
  }
  function closeSearch(){if(searchPopup)searchPopup.hidden=true}
  function askTutor(value){
    navTo('answer');
    const field=$('questionInput');
    if(field){field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));field.focus()}
  }
  function renderSearch(){
    if(!searchPopup||!searchInput)return;
    const query=searchInput.value.trim();
    searchPopup.replaceChildren();lastSearchActions=filterResults(query);
    if(query){
      lastSearchActions.forEach(item=>{
        const b=document.createElement('button');b.type='button';b.className='ss-search-result';
        const title=document.createElement('strong');title.textContent=item.title;
        const kind=document.createElement('small');kind.textContent=item.kind;
        b.append(title,kind);
        b.addEventListener('click',()=>{closeSearch();item.action()});searchPopup.append(b);
      });
      const ai=document.createElement('button');ai.type='button';ai.className='ss-search-result ss-search-ask';
      ai.textContent='Ask AI Tutor: “'+query.slice(0,90)+'”';
      ai.addEventListener('click',()=>{closeSearch();askTutor(query)});searchPopup.append(ai);
    }else{
      const hint=document.createElement('p');hint.textContent='Search your flashcards, documents, and tools. Press Ctrl/⌘ + K to focus.';searchPopup.append(hint);
    }
    searchPopup.hidden=false;
  }
  function notifyItems(){
    const date=new Date(),today=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
    return arr(getData().assignments).filter(a=>a&&!a.done&&a.due&&String(a.due)<=today).slice(0,6);
  }
  function refreshNotificationBadge(){
    if(noticeButton)noticeButton.classList.toggle('ss-has-notifications',notifyItems().length>0);
  }
  function renderNotifications(){
    if(!noticePopup)return;noticePopup.replaceChildren();
    const heading=document.createElement('h2');heading.textContent='Notifications';noticePopup.append(heading);
    const due=notifyItems();
    if(!due.length){
      const p=document.createElement('p');p.className='ss-compact-empty';p.textContent='You’re all caught up. Upcoming tasks will appear here.';noticePopup.append(p);
    }else due.forEach(item=>{
      const b=document.createElement('button');b.type='button';b.className='ss-notification-item';
      const title=document.createElement('strong');title.textContent=String(item.name||'Assignment').slice(0,120);
      const caption=document.createElement('small');caption.textContent='Due '+formatDate(item.due);
      b.append(title,caption);b.addEventListener('click',()=>{noticePopup.hidden=true;navTo('agenda')});noticePopup.append(b);
    });
  }
  function installTopbar(){
    const bar=document.querySelector('.topbar'),actions=bar?.querySelector('.topright');
    if(!bar||!actions||$('ssTopSearch'))return;
    const search=document.createElement('div');search.className='ss-top-search';search.id='ssTopSearch';
    search.innerHTML='<span class="ss-search-icon" aria-hidden="true"></span><input id="ssSearchInput" type="search" autocomplete="off" spellcheck="false" aria-label="Search documents, flashcards and StudySpire tools" placeholder="Search your documents, flashcards, assignments, or ask StudySpire anything…"><kbd>⌘ K</kbd><div id="ssSearchPopup" class="ss-search-popup" role="group" aria-label="Search suggestions" hidden></div>';
    search.querySelector('.ss-search-icon').innerHTML=svg('search');
    bar.insertBefore(search,bar.firstChild);
    searchInput=$('ssSearchInput');searchPopup=$('ssSearchPopup');
    searchInput.addEventListener('input',renderSearch);
    searchInput.addEventListener('focus',()=>{if(searchInput.value.trim())renderSearch()});
    searchInput.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();const result=lastSearchActions[0];closeSearch();if(result)result.action();else if(searchInput.value.trim())askTutor(searchInput.value.trim());}
      if(e.key==='Escape')closeSearch();
    });
    const bell=document.createElement('button');bell.id='ssNotificationButton';bell.type='button';bell.className='ss-notification-button';
    bell.title='Notifications';bell.setAttribute('aria-label','Notifications');bell.setAttribute('aria-haspopup','dialog');bell.setAttribute('aria-expanded','false');bell.innerHTML=svg('bell')+'<span class="ss-bell-dot" aria-hidden="true"></span>';
    const popup=document.createElement('section');popup.className='ss-notification-popup';popup.id='ssNotificationPopup';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Notifications');popup.hidden=true;
    actions.append(popup);noticePopup=popup;noticeButton=bell;
    const help=$('ssHelpTopButton'),account=$('sdTopAccount');
    if(help){
      const helpLabel=help.querySelector('.ss-help-label');if(helpLabel)helpLabel.textContent='How to Use';
      if(account)actions.insertBefore(help,account);
      help.insertAdjacentElement('afterend',bell);
    }else if(account)account.insertAdjacentElement('beforebegin',bell);
    else actions.prepend(bell);
    bell.addEventListener('click',()=>{closeSearch();renderNotifications();popup.hidden=!popup.hidden;bell.setAttribute('aria-expanded',String(!popup.hidden))});
    const avatar=document.createElement('span');avatar.className='ss-account-avatar';avatar.setAttribute('aria-hidden','true');avatar.textContent='👤';
    const label=$('sdTopAccountLabel');
    if(account&&label){account.replaceChildren(avatar,label);account.classList.add('ss-profile-top');}
    document.addEventListener('click',e=>{
      if(search&&!search.contains(e.target))closeSearch();
      if(!popup.hidden&&!popup.contains(e.target)&&e.target!==bell&&!bell.contains(e.target)){popup.hidden=true;bell.setAttribute('aria-expanded','false')}
    });
    document.addEventListener('keydown',e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){
        if(e.target===searchInput)return;
        e.preventDefault();e.stopImmediatePropagation();searchInput.focus();searchInput.select();
        if(searchInput.value.trim())renderSearch();
      }else if(e.key==='Escape'){
        closeSearch();popup.hidden=true;bell.setAttribute('aria-expanded','false');
      }
    },true);
    refreshNotificationBadge();
  }
  function updateMini(){
    const launcher=$('miniLauncher');if(!launcher)return;
    launcher.title='Open Mini';launcher.setAttribute('aria-label','Open StudySpire Mini assistant');
    const text=launcher.querySelector('.mini-launcher-label');if(text)text.textContent='Mini';
    const icon=launcher.querySelector('.mini-launcher-icon');if(icon)icon.textContent='✦';
  }
  function init(){
    if(!$('page-home'))return;
    // Finish both dashboard DOM passes before displaying the app. The page
    // starts with the boot class in HTML, so legacy layout never gets painted.
    refineHome();installSidebar();installTopbar();updateMini();
    document.body.classList.add('ss-screenshot-layout');
    document.documentElement.classList.remove('ss-ui-boot');
    refreshOverview();refreshNotificationBadge();
    window.addEventListener('ss-suite-updated',()=>{refreshOverview();refreshNotificationBadge()});
    window.addEventListener('ss-cloud-auth-changed',()=>{friendLastFetch=0;refreshOverview()});
    window.addEventListener('storage',()=>{refreshOverview();refreshNotificationBadge()});
    // Cloud login boot may finish after DOMContentLoaded.
    setTimeout(()=>{refreshOverview();refreshNotificationBadge()},2200);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  window.StudySpireLayout={refresh:()=>{refreshOverview();refreshNotificationBadge()},search:filterResults};
})();