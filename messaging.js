/* StudySpire Cloud messaging v3.82.
   Uses narrow server-checked RPCs; no browser-local pretend conversations or auth secrets. */
(()=>{
'use strict';
const bridge=window.StudySummitMessagingBridge;
if(!bridge?.configured)return; // Preserve the existing offline/local demo when Cloud is not configured.
const $=id=>document.getElementById(id);
const account=()=>bridge.account();
const pane=document.querySelector('.sd-suite-pane[data-pane="friends"]');
if(!pane)return;
const emptyOverview=()=>({friends:[],incoming:[],outgoing:[],blocked:[],decks:[]});
let state=emptyOverview(),selected='',busy=false,fetching=false,threadToken=0,lastThreadKey='',refreshQueued=false,lastFetch=0;
let messagingRestricted=false,messagingRestrictionReason='';
let pendingSearch=null;
const rpc=(name,args)=>bridge.rpc(name,args||{});
const dateText=value=>{
 const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString():'';
};
function status(message,tone='info'){
 const box=$('sdFriendStatus');if(!box)return;
 box.textContent=String(message||'');box.dataset.tone=tone;
}
function node(tag,text,cls){
 const el=document.createElement(tag);if(typeof text==='string')el.textContent=text;if(cls)el.className=cls;return el;
}
function action(label,callback,cls='btn secondary small'){
 const button=node('button',label,cls);button.type='button';button.addEventListener('click',callback);return button;
}
function errorText(error){return String(error?.message||error||'Unknown error').slice(0,280)}
function noItems(container,message){
 if(!container)return;
 container.replaceChildren(node('p',message,'sd-social-empty'));
}
function isVisible(){
 return !document.hidden && pane.classList.contains('active')
    && pane.closest('.page')?.classList.contains('active');
}
function setEnabled(yes){
 for(const id of ['sdFriendFind','sdFriendSearch','sdMessageFriend','sdFriendMessage','sdSendMessage','sdShareDeck']){
  const element=$(id);if(element)element.disabled=!yes;
 }
 if(yes)updateComposer();
}
function updateComposer(){
 const can=!!account()&&!!selected&&state.friends.some(friend=>friend.id===selected);
 const send=$('sdSendMessage'),share=$('sdShareDeck'),message=$('sdFriendMessage');
 if(send)send.disabled=!can||busy||messagingRestricted;
 if(share)share.disabled=!can||busy||messagingRestricted;
 if(message){message.disabled=!can||messagingRestricted;message.placeholder=messagingRestricted?'Messaging restricted by an Owner':'Write a message…';}
}
function selectedName(){
 return state.friends.find(f=>f.id===selected)?.username||'friend';
}
function signedOut(){
 messagingRestricted=false;messagingRestrictionReason='';
 state=emptyOverview();selected='';lastThreadKey='';threadToken++;
 for(const id of ['sdFriendResults','sdFriendRequests','sdFriendsList','sdMessageThread','sdSharedDeckInbox']){
  const el=$(id);if(el)noItems(el,'Sign in to StudySpire Cloud to use messaging.');
 }
 $('sdMessageFriend')?.replaceChildren(new Option('Sign in first',''));
 noItems($('sdOutgoingRequests'),'Sign in to view outgoing requests.');
 noItems($('sdBlockedUsers'),'Sign in to view blocked users.');
 setEnabled(false);
 status('☁ Cloud messaging requires a signed-in account. Messages are private to accepted friends.');
}
async function run(button,work){
 if(busy)return;
 busy=true;if(button)button.disabled=true;updateComposer();
 try{await work()}catch(error){status(errorText(error),'error')}
 finally{busy=false;if(button)button.disabled=false;updateComposer()}
}
function renderRequests(){
 const incoming=$('sdFriendRequests'),outgoing=$('sdOutgoingRequests');
 incoming.replaceChildren();outgoing.replaceChildren();
 if(!state.incoming.length)noItems(incoming,'No incoming friend requests.');
 for(const req of state.incoming){
  const row=node('div',null,'sd-social-row');
  const main=node('div',null,'sd-social-text');
  const requestLabel=node('strong','@'+req.username);main.append(requestLabel,node('small','Requested '+dateText(req.created_at)));
  window.StudySpireRoles?.decorateLabel(requestLabel,req.username);
  const controls=node('div',null,'sd-social-actions');
  controls.append(action('Accept',e=>run(e.currentTarget,async()=>{
   await rpc('ss_social_respond',{request_id:req.id,accept_request:true});
   status('You and @'+req.username+' are now friends!','good');await refresh();
  }),'btn primary small'),
  action('Decline',e=>run(e.currentTarget,async()=>{
   await rpc('ss_social_respond',{request_id:req.id,accept_request:false});
   status('Request declined.','info');await refresh();
  })));
  controls.append(action('View picture',()=>window.StudySpireAvatars?.openProfile(req.username),'btn secondary small'));
  row.append(main,controls);incoming.append(row);
 }
 if(!state.outgoing.length)noItems(outgoing,'No outgoing requests.');
 for(const req of state.outgoing){
  const row=node('div',null,'sd-social-row');
  row.append(node('span','@'+req.username+' · Awaiting response'));
  row.append(action('Cancel',e=>run(e.currentTarget,async()=>{
   await rpc('ss_social_cancel',{request_id:req.id});status('Invitation cancelled.');await refresh();
  })));
  outgoing.append(row);
 }
}
function renderFriends(){
 const host=$('sdFriendsList'),sel=$('sdMessageFriend'),blocked=$('sdBlockedUsers');
 host.replaceChildren();blocked.replaceChildren();
 const active=state.friends||[];
 if(!active.some(f=>f.id===selected)){selected='';lastThreadKey='';threadToken++;}
 const previously=sel.value;
 sel.replaceChildren(new Option('Choose a friend',''),...active.map(f=>new Option('@'+f.username,f.id)));
 if(selected)sel.value=selected;
 else if(active.some(f=>f.id===previously)){selected=previously;sel.value=previously}
 if(!active.length)noItems(host,'No friends yet. Search an exact Cloud username and send an invitation.');
 for(const friend of active){
  const row=node('div',null,'sd-social-row');
  const label=node('strong','@'+friend.username);
  window.StudySpireRoles?.decorateLabel(label,friend.username);
  const controls=node('div',null,'sd-social-actions');
  const open=action('Message',()=>{
   selected=friend.id;sel.value=selected;lastThreadKey='';loadThread();
   $('sdFriendMessage')?.focus();
  },'btn primary small');
  const remove=action('Remove',e=>run(e.currentTarget,async()=>{
   if(!confirm('Remove @'+friend.username+' from your friends? You will no longer be able to view this conversation.'))return;
   await rpc('ss_social_unfriend',{friend_id:friend.id});
   if(selected===friend.id)selected='';
   status('@'+friend.username+' removed from friends.');await refresh();
  }));
  const block=action('Block',e=>run(e.currentTarget,async()=>{
   if(!confirm('Block @'+friend.username+'? You will no longer be friends and this person cannot message or invite you.'))return;
   await rpc('ss_social_block',{blocked_user:friend.id});
   if(selected===friend.id)selected='';
   status('@'+friend.username+' blocked.');await refresh();
  }),'btn ghost small');
  controls.append(open,action('View / report picture',()=>window.StudySpireAvatars?.openProfile(friend.username),'btn secondary small'),remove,block);row.append(label,controls);host.append(row);
 }
 if(!state.blocked.length)noItems(blocked,'No blocked users.');
 for(const person of state.blocked){
  const row=node('div',null,'sd-social-row');
  row.append(node('span','@'+person.username),action('Unblock',e=>run(e.currentTarget,async()=>{
   if(!confirm('Unblock @'+person.username+'? Friendship does not resume automatically.'))return;
   await rpc('ss_social_unblock',{blocked_user:person.id});status('Account unblocked.');await refresh();
  })));
  blocked.append(row);
 }
 updateComposer();
}
function renderDecks(){
 const host=$('sdSharedDeckInbox');host.replaceChildren();
 if(!state.decks.length)return noItems(host,'No shared flashcard decks yet.');
 for(const deck of state.decks){
  const cards=Array.isArray(deck.cards)?deck.cards:[];
  const row=node('div',null,'sd-social-row');
  const summary=node('span',cards.length+' flashcards from @'+deck.username+' · '+dateText(deck.created_at));
  const importBtn=action('Add to my library',e=>run(e.currentTarget,async()=>{
   if(!cards.length)throw Error('Deck does not contain any cards.');
   const share=window.StudySummitStudyShare;
   if(!share?.importCards)throw Error('Flashcard library is still loading. Refresh StudySpire and try again.');
   if(!confirm('Add '+cards.length+' cards from @'+deck.username+' to your library? Your existing cards will not be replaced.'))return;
   const count=share.importCards(cards);
   status('Added '+count+' flashcards from @'+deck.username+'.','good');
  }),'btn primary small');
  row.append(summary,importBtn);host.append(row);
 }
}
async function loadThread(){
 const a=account(),friend=state.friends.find(f=>f.id===selected),host=$('sdMessageThread');
 const token=++threadToken;
 if(!a||!friend)return noItems(host,'Select an accepted friend to start a conversation.');
 if(!lastThreadKey)host.textContent='Loading conversation…';
 try{
  const entries=await rpc('ss_social_messages',{with_user:friend.id});
  if(token!==threadToken||!account()||selected!==friend.id)return;
  const messages=Array.isArray(entries)?entries:[];
  const nextKey=friend.id+':'+messages.map(m=>m.id).join(',');
  if(nextKey===lastThreadKey)return;
  const nearBottom=host.scrollHeight-host.scrollTop-host.clientHeight<85;
  lastThreadKey=nextKey;host.replaceChildren();
  if(!messages.length)return noItems(host,'No messages yet. Say hello!');
  for(const msg of messages){
   const mine=msg.from===a.id,bubble=node('div',null,'sd-message-bubble'+(mine?' mine':''));
   const label=node('small',(mine?'You':'@'+friend.username)+' · '+dateText(msg.at));
   window.StudySpireRoles?.decorateLabel(label,mine?a.username:friend.username);
   const body=node('div',String(msg.text||''));body.className='sd-social-message-body';
   bubble.append(label,body);
   if(!mine){
    const report=action('Report',e=>run(e.currentTarget,async()=>{
     const why=prompt('Why are you reporting this message? (10–280 characters)');
     if(why===null)return;
     const reason=why.trim();
     if(reason.length<10||reason.length>280)throw Error('Please enter 10–280 characters.');
     if(!confirm('Send this message text and your report to StudySpire moderators for review?'))return;
     await rpc('ss_social_report_message',{message_id:msg.id,why:reason});
     e.currentTarget.textContent='Reported';
     status('Message reported to StudySpire staff.','good');
    }),'ss-msg-report');
    bubble.append(report);
   }
   host.append(bubble);
  }
  if(nearBottom||!host.dataset.loaded||!host.scrollTop)host.scrollTop=host.scrollHeight;
  host.dataset.loaded='true';
 }catch(error){
  if(token===threadToken)status('Could not load messages: '+errorText(error),'error');
 }
}
function renderOverview(){
 renderRequests();renderFriends();renderDecks();
 if(!selected)noItems($('sdMessageThread'),'Choose a friend to view messages.');
}
async function refresh(silent=false){
 if(!account())return signedOut();
 if(fetching){refreshQueued=true;return}
 fetching=true;
 try{
  const [response,restriction]=await Promise.all([rpc('ss_social_overview'),rpc('ss_my_messaging_status')]);
  if(!account())return signedOut();
  state={
   friends:Array.isArray(response?.friends)?response.friends:[],
   incoming:Array.isArray(response?.incoming)?response.incoming:[],
   outgoing:Array.isArray(response?.outgoing)?response.outgoing:[],
   blocked:Array.isArray(response?.blocked)?response.blocked:[],
   decks:Array.isArray(response?.decks)?response.decks:[]
  };
  const wasRestricted=messagingRestricted;
  messagingRestricted=restriction?.restricted===true;
  messagingRestrictionReason=messagingRestricted?String(restriction?.reason||''):'';
  setEnabled(true);renderOverview();if(selected)await loadThread();lastFetch=Date.now();
  if(messagingRestricted&&(!silent||!wasRestricted))status('🔇 Study Spire staff restricted outgoing messages and study-room posts'+(messagingRestrictionReason?': '+messagingRestrictionReason:'.')+' You can still read your conversations.','error');
  else if(!silent)status('☁ Messaging synced. Conversations are private to accepted friends.','good');
  else if(wasRestricted)status('🔊 Your messaging access has been restored.','good');
 }catch(error){status('Messaging could not sync: '+errorText(error),'error')}
 finally{
  fetching=false;
  if(refreshQueued){refreshQueued=false;setTimeout(()=>refresh(true),150)}
 }
}
async function findFriend(){
 const search=$('sdFriendSearch')?.value.trim().toLowerCase()||'';
 const host=$('sdFriendResults');host.replaceChildren();
 if(!account())return noItems(host,'Sign in to search Cloud accounts.');
 if(!/^[a-z0-9_-]{3,32}$/.test(search))return noItems(host,'Enter an exact username (3–32 letters, numbers, _ or -).');
 if(pendingSearch===search)return;
 pendingSearch=search;
 try{
  const result=await rpc('ss_social_lookup',{chosen_username:search});
  if(pendingSearch!==search)return;
  if(!result)return noItems(host,'No available account with that exact username.');
  const row=node('div',null,'sd-social-row');
  const foundLabel=node('strong','@'+result.username);row.append(foundLabel);
  window.StudySpireRoles?.decorateLabel(foundLabel,result.username);
  let caption='Send friend request',disabled=false;
  if(result.relation==='friend'){caption='Already friends';disabled=true}
  if(result.relation==='outgoing'){caption='Request pending';disabled=true}
  if(result.relation==='incoming'){caption='Check incoming requests';disabled=true}
  if(result.relation==='blocked'){caption='Unblock in your blocked list';disabled=true}
  const btn=action(caption,e=>run(e.currentTarget,async()=>{
    const outcome=await rpc('ss_social_request',{chosen_username:search});
    status(outcome==='sent'?'Friend request sent to @'+search+'.':'Request status: '+outcome,'good');
    await refresh();pendingSearch=null;await findFriend();
  }),'btn primary small');btn.disabled=disabled;row.append(btn,action('View / report picture',()=>window.StudySpireAvatars?.openProfile(result.username),'btn secondary small'));host.append(row);
 }catch(error){noItems(host,'Search failed: '+errorText(error))}
 finally{if(pendingSearch===search)pendingSearch=null}
}
function init(){
 const note=pane.querySelector('.sd-notice');
 const composer=$('sdFriendMessage');if(composer)composer.setAttribute('aria-describedby','sdFriendStatus');
 if(note)note.textContent='☁ StudySpire Cloud messaging: only people who accept friend requests can message you. You can remove or block anyone. Reports share the reported message with staff; other conversations stay private. Avoid sharing personal information.';
 const intro=pane.querySelector('.sd-feature-head p');
 if(intro)intro.textContent='Search by exact StudySpire username, accept requests, chat across devices, and share flashcards privately.';
 const chip=pane.querySelector('.sd-feature-head .sd-chip');
 if(chip)chip.textContent='☁ Cloud messaging';
 const safetyNote=pane.querySelector('.sd-suite-pane[data-pane="friends"] > .note');
 if(safetyNote)safetyNote.textContent='Friends must both be signed into StudySpire Cloud. Invitations require approval, and messages are not publicly visible.';
 const search=$('sdFriendSearch');if(search)search.placeholder='Exact StudySpire username (no email)';
 const requests=$('sdFriendRequests'),friends=$('sdFriendsList');
 const outHeading=node('div','Sent invitations','cardtitle'),outgoing=node('div',null,'sd-agenda-list');outgoing.id='sdOutgoingRequests';
 requests.insertAdjacentElement('afterend',outHeading);outHeading.insertAdjacentElement('afterend',outgoing);
 const blockedHeading=node('div','Blocked accounts','cardtitle'),blocked=node('div',null,'sd-agenda-list');blocked.id='sdBlockedUsers';
 friends.insertAdjacentElement('afterend',blockedHeading);blockedHeading.insertAdjacentElement('afterend',blocked);
 const reload=action('↻ Refresh',()=>refresh(),'btn secondary small');reload.id='sdRefreshMessages';reload.title='Refresh your friend list and conversation';
 pane.querySelector('.sd-feature-head')?.append(reload);
 $('sdFriendFind').onclick=()=>findFriend();
 $('sdFriendSearch').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();findFriend()}};
 $('sdMessageFriend').onchange=()=>{
  selected=$('sdMessageFriend').value;lastThreadKey='';updateComposer();loadThread();
 };
 $('sdFriendMessage').onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('sdSendMessage').click()}};
 $('sdSendMessage').onclick=e=>run(e.currentTarget,async()=>{
  const text=$('sdFriendMessage').value.trim();
  if(!text)throw Error('Write a message before sending.');
  if(text.length>2000)throw Error('Messages must be under 2000 characters.');
  if(!selected)throw Error('Choose an accepted friend.');
  await window.StudySpireContentSafety.review('message',text);
  const sentId=await rpc('ss_social_send',{to_user:selected,message:text});
  if(!sentId)throw Error('⚑ Message blocked by StudySpire safety rules. Edit your message and try again.');
  $('sdFriendMessage').value='';lastThreadKey='';await loadThread();
  status('Message delivered to your shared conversation.','good');
 });
 $('sdShareDeck').onclick=e=>run(e.currentTarget,async()=>{
  if(!selected)throw Error('Choose a friend first.');
  const share=window.StudySummitStudyShare;
  if(!share?.getCards)throw Error('Study library is still loading.');
  const cards=share.getCards();
  if(!cards.length)throw Error('Create some flashcards before sharing.');
  if(!confirm('Share your first '+cards.length+' flashcards with @'+selectedName()+'? They will receive a separate copy.'))return;
  await rpc('ss_social_share_deck',{to_user:selected,shared_cards:cards});
  status('Shared '+cards.length+' flashcards with @'+selectedName()+'.','good');
 });
 window.addEventListener('ss-cloud-auth-changed',()=>{
  if(account())refresh();else signedOut();
 });
 window.addEventListener('focus',()=>{if(isVisible()&&account())refresh(true)});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&isVisible()&&account())refresh(true)});
 setInterval(()=>{if(isVisible()&&account()&&Date.now()-lastFetch>7500)refresh(true)},10000);
 window.StudySummitCloudMessaging={refreshOnVisit:()=>{if(account()&&Date.now()-lastFetch>2500)refresh(true);else if(!account())signedOut()}};
 if(account())refresh();else signedOut();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
})();