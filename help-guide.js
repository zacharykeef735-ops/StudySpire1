/* StudySpire Help / README guide. Standalone: no auth or AI dependencies. */
(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const README_START='<!-- STUDYSPIRE_GUIDE_START -->';
  const README_END='<!-- STUDYSPIRE_GUIDE_END -->';
  const FALLBACK_GUIDE="## How to use StudySpire\n\nWelcome! You can use most study tools right in your browser. Sign in to a Cloud account if you want account-based study storage, messaging, and staff features.\n\n### 1. Find your way around\n- **AI Tutor** is for questions, explanations, and help with practice.\n- **Home** shows your study tools. **Assignments** includes calendar and study planning, while **Documents** combines notes and saved files.\n- **Mini** is the small floating ✦ assistant. Open it from its launcher; if hidden, enable it in **Settings → AI & Mini**.\n- **Help (?)** in the top-right opens this guide any time.\n\n### 2. Ask the AI tutor\n1. Open **AI Tutor** and type a question or upload a worksheet.\n2. For on-device AI, go to **Settings → AI & Mini**, choose an available model, and select **Load browser AI**.\n3. Wait for the first model download and initialization, then ask your question. Smaller models work on more devices.\n4. If loading fails, open **Health** for a WebGPU check or try the smallest model. Browser AI is experimental.\n\n### 3. Make flashcards, notes, and plans\n1. Open **Flashcards** in the sidebar or Home to create and practice cards.\n2. Use **Documents** to create notes and manage saved documents, and **Assignments** to organize tasks, due dates, and study planning.\n3. Mark completed tasks and practice cards to build your study-progress history.\n4. Use **Progress** in the top bar for goals, study streaks, and the Quick Focus timer.\n\n### 4. Sign in and protect your work\n1. Open **Account** in the top-right to create a username/password Cloud account or sign in.\n2. A username account does not require an email. Use a unique username and a strong password.\n3. Use **Manage account** to switch accounts or change your password while signed in.\n4. If you forget a username-account password, select **Forgot password?** and request a six-digit, Owner-approved recovery code.\n5. Export important work as a backup. Browser-local work can disappear if your browser storage is cleared.\n\n### 5. Message friends and share flashcards\n1. Sign into Cloud, open **Messages & friends**, and search by an exact StudySpire username.\n2. Send a friend request. The recipient must **Accept** before either person can chat.\n3. Choose an accepted friend to exchange messages or share a copy of flashcards.\n4. Use **Block** or **Report** when necessary. Messaging isn't end-to-end encrypted; avoid sharing private information.\n\n### Profile pictures and reports\n1. Sign in to your Cloud account, open **Account → Profile picture**, or click your avatar at the top-right.\n2. Choose a JPG, PNG, or WebP image. StudySpire crops it to a square WebP thumbnail before uploading; the photo is visible to other signed-in users.\n3. Select **Save picture** to upload it, or **Remove picture** to restore your initials.\n4. To view or report another user's picture, open **Messages & friends**, search for their exact username, and select **View / report picture**. Choose **Report this profile picture**, write a reason, then send it.\n5. **Moderators** can review reports and remove Student pictures. **Admins** can also restrict uploads by Students and Moderators. **Owners** can manage all other accounts' pictures and restrictions. Restricted accounts can remove their own pictures but cannot upload new ones.\n6. Staff review reports under **Cloud staff → Profile pictures**. Reports include a snapshot of the reported image until reviewed. Upload restrictions and moderation actions are checked by Supabase, not just the website controls.\n\n### 6. Handy shortcuts and troubleshooting\n- **Ctrl/⌘ + K:** Open Quick Actions to find a feature.\n- **Ctrl/⌘ + B:** Collapse or expand the sidebar.\n- **Ctrl + Shift + Space:** Toggle the floating Mini, when enabled.\n- **Health:** See browser GPU compatibility, cloud connection, and AI loading errors.\n- If the site looks outdated, refresh after a deployment. If the AI won't load, check hardware acceleration, your connection, and the smallest model.";
  const README_URL='https://github.com/zacharykeef735-ops/StudySpire/blob/main/README.md';
  let button=null,overlay=null,returnFocus=null,readmeLoaded=false,fetching=false;

  function guideSection(markdown){
    const start=markdown.indexOf(README_START);
    const end=markdown.indexOf(README_END,start+README_START.length);
    if(start<0||end<=start)throw Error('README is missing its How to use StudySpire section.');
    const guide=markdown.slice(start+README_START.length,end).trim();
    if(!guide.startsWith('## How to use StudySpire'))throw Error('README help section has an unexpected heading.');
    return guide;
  }

  // Parse a small, safe subset of Markdown into DOM nodes. No user-supplied HTML.
  function writeInline(parent,value){
    for(const part of String(value).split(/(\*\*[^*]+\*\*)/g)){
      if(!part)continue;
      if(part.startsWith('**')&&part.endsWith('**')){
        const strong=document.createElement('strong');
        strong.textContent=part.slice(2,-2);
        parent.append(strong);
      }else parent.append(document.createTextNode(part));
    }
  }
  function renderGuide(markdown){
    const host=$('ssHelpBody');if(!host)return;
    const fragment=document.createDocumentFragment();
    let activeList=null,activeKind='';
    for(const raw of String(markdown).split(/\r?\n/)){
      const line=raw.trim();
      if(!line){activeList=null;activeKind='';continue}
      if(line==='## How to use StudySpire')continue;
      const heading=line.match(/^###\s+(.+)$/);
      if(heading){
        activeList=null;activeKind='';
        const h=document.createElement('h3');writeInline(h,heading[1]);fragment.append(h);
        continue;
      }
      const ordered=line.match(/^\d+\.\s+(.+)$/);
      const unordered=line.match(/^-\s+(.+)$/);
      if(ordered||unordered){
        const kind=ordered?'ol':'ul';
        if(!activeList||activeKind!==kind){
          activeList=document.createElement(kind);activeKind=kind;fragment.append(activeList);
        }
        const item=document.createElement('li');writeInline(item,(ordered||unordered)[1]);activeList.append(item);
        continue;
      }
      activeList=null;activeKind='';
      const paragraph=document.createElement('p');writeInline(paragraph,line);fragment.append(paragraph);
    }
    host.replaceChildren(fragment);
  }

  function ensureDialog(){
    if(overlay)return;
    overlay=document.createElement('div');
    overlay.id='ssHelpOverlay';overlay.hidden=true;
    overlay.innerHTML='<section class="ss-help-dialog" role="dialog" aria-modal="true" aria-labelledby="ssHelpTitle">'+
      '<header class="ss-help-head"><div><span class="ss-help-eyebrow">STUDYSPIRE GUIDE</span>'+
      '<h2 id="ssHelpTitle">How to use StudySpire</h2><p>Quick answers from the project README.</p></div>'+
      '<button type="button" id="ssHelpClose" aria-label="Close help">✕</button></header>'+
      '<div id="ssHelpBody" class="ss-help-body" tabindex="0"></div>'+
      '<footer class="ss-help-footer"><a id="ssHelpReadme" target="_blank" rel="noopener noreferrer">Read the full README ↗</a>'+
      '<span id="ssHelpSource">Press Esc to close</span></footer></section>';
    document.body.append(overlay);
    $('ssHelpReadme').href=README_URL;
    $('ssHelpClose').addEventListener('click',close);
    overlay.addEventListener('click',event=>{if(event.target===overlay)close()});
    renderGuide(FALLBACK_GUIDE);
  }

  function close(){
    if(!overlay||overlay.hidden)return;
    overlay.hidden=true;
    if(button)button.setAttribute('aria-expanded','false');
    if(returnFocus?.isConnected&&typeof returnFocus.focus==='function')returnFocus.focus({preventScroll:true});
  }

  async function syncReadme(){
    if(readmeLoaded||fetching)return;
    fetching=true;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),6500);
    try{
      const url=new URL('README.md',document.baseURI);
      const response=await fetch(url,{signal:controller.signal,cache:'no-cache'});
      if(!response.ok)throw Error('README is unavailable');
      const full=await response.text();
      const fromReadme=guideSection(full);
      renderGuide(fromReadme);
      readmeLoaded=true;
      const source=$('ssHelpSource');
      if(source)source.textContent='Current guide from README.md';
    }catch(_){
      // Built-in guide matches the README section at this release, even offline.
      const source=$('ssHelpSource');
      if(source)source.textContent='Built-in guide · full README linked';
    }finally{
      clearTimeout(timeout);fetching=false;
    }
  }

  function open(){
    ensureDialog();
    returnFocus=document.activeElement;
    overlay.hidden=false;
    button?.setAttribute('aria-expanded','true');
    const scroller=$('ssHelpBody');if(scroller)scroller.scrollTop=0;
    $('ssHelpClose')?.focus({preventScroll:true});
    void syncReadme();
  }

  function installButton(){
    if($('ssHelpTopButton'))return;
    const topRight=document.querySelector('.topbar .topright');
    if(!topRight)return;
    button=document.createElement('button');
    button.id='ssHelpTopButton';button.type='button';
    button.className='btn secondary small ss-help-trigger';
    button.setAttribute('aria-label','How to use StudySpire');
    button.setAttribute('aria-haspopup','dialog');
    button.setAttribute('aria-expanded','false');
    button.title='How to use StudySpire';
    button.innerHTML='<span class="ss-help-mark" aria-hidden="true">?</span><span class="ss-help-label">Help</span>';
    button.addEventListener('click',open);

    // If a notification bell exists, place Help directly next to it.
    // Older layouts lack a bell, so place Help alongside the top-right Settings button.
    const bell=topRight.querySelector(
      '[aria-label*="notification" i], [title*="notification" i], #notificationButton, #sdNotifications'
    );
    const settings=$('openSettings');
    if(bell)bell.insertAdjacentElement('afterend',button);
    else if(settings?.parentElement===topRight)settings.insertAdjacentElement('beforebegin',button);
    else topRight.append(button);
  }

  document.addEventListener('keydown',event=>{
    if(!overlay||overlay.hidden)return;
    if(event.key==='Escape'){
      event.preventDefault();event.stopImmediatePropagation();close();
      return;
    }
    if(event.key!=='Tab')return;
    const controls=[...overlay.querySelectorAll('button:not([disabled]),a[href]')];
    if(!controls.length)return;
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  },true);

  function init(){installButton()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();