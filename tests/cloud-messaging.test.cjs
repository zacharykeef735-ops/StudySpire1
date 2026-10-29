'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const html=read('index.html'),suite=read('suite.js'),cloud=read('cloud.js'),ui=read('messaging.js'),sql=read('cloud-messaging-migration.sql');

test('messaging scripts parse and load after study suite and Cloud auth',()=>{
 assert.doesNotThrow(()=>new Function(ui));
 assert.doesNotThrow(()=>new Function(cloud));
 assert.doesNotThrow(()=>new Function(suite));
 const starts=['suite.js?v=3.80','cloud.js?v=4.15','enhancements.js?v=3.81','messaging.js?v=3.95'].map(name=>html.indexOf('src="'+name+'"'));
 assert.ok(starts.every(x=>x>=0),'Missing messaging or Cloud source');
 assert.deepEqual(starts,[...starts].sort((a,b)=>a-b));
 assert.match(html,/messaging\.css\?v=3\.82/);
 assert.match(html,/data-suite-target="friends"/);
 assert.match(html,/data-pane="friends"/);
});

test('offline/local mode has no dependency on Cloud APIs',()=>{
 const fakeWindow={};
 const fakeDocument={querySelector:()=>{throw Error('Should not initialize cloud messaging when not configured')}};
 assert.doesNotThrow(()=>vm.runInNewContext(ui,{window:fakeWindow,document:fakeDocument}));
});

test('cloud bridge whitelists only social RPCs and requires verified account',async()=>{
 const start=cloud.indexOf('const SOCIAL_ALLOWED=new Set(['),end=cloud.indexOf('async function openStaff()',start);
 assert.ok(start>=0&&end>start);
 const block=cloud.slice(start,end);
 const factory=new Function('window','ready','person','profile','live','banned','rpc',block+';return window.StudySummitMessagingBridge;');
 const calls=[];
 const person={id:'test-canonical-id'},profile={username:'exampleuser',banned:false};
 const bridge=factory({},true,person,profile,true,()=>false,async(name,args)=>{calls.push([name,args]);return true});
 assert.deepEqual(bridge.account(),{id:'test-canonical-id',username:'exampleuser'});
 await assert.rejects(bridge.rpc('ss_change_role',{target_user:'victim'}),/Unsupported social operation/);
 await bridge.rpc('ss_social_send',{to_user:'friend-id',message:'Hello'});
 assert.deepEqual(calls,[['ss_social_send',{to_user:'friend-id',message:'Hello'}]]);
 const signedOut=factory({},true,person,profile,false,()=>false,async()=>true);
 await assert.rejects(signedOut.rpc('ss_social_send',{}),/Sign in to a Cloud account/);
});

test('private social tables have RLS and browser table privileges are revoked',()=>{
 const tables=['requests','friends','blocks','messages','decks'];
 for(const name of tables){
  assert.match(sql,new RegExp('create table if not exists ss_private\\.ss_social_'+name));
  assert.match(sql,new RegExp('alter table ss_private\\.ss_social_'+name+' enable row level security;'));
 }
 assert.match(sql,/revoke all on all tables in schema ss_private from public,anon,authenticated/);
 assert.match(sql,/revoke all on function public\.ss_social_send\(uuid,text\) from public,anon/);
 assert.match(sql,/grant execute on function public\.ss_social_send\(uuid,text\) to authenticated/);
 assert.match(sql,/public\.ss_current_profile_id\(\)/);
 assert.match(sql,/public\.ss_can_use\(\)/);
});

test('server validates friendship, blocking, identity and flood limits',()=>{
 assert.match(sql,/Only friends can view this conversation/);
 assert.match(sql,/You must be friends before messaging/);
 assert.match(sql,/Messages are blocked for this connection/);
 assert.match(sql,/Sending too fast; please wait a minute/);
 assert.match(sql,/Daily message limit reached/);
 assert.match(sql,/Daily request limit reached/);
 assert.match(sql,/recipient_id=me and status='pending'/);
 assert.match(sql,/Only recipients may report their messages/);
 assert.match(sql,/Daily report limit reached/);
 assert.match(sql,/char_length\(clean\)>2000/);
});

test('message content is rendered as plain text, never executable HTML',()=>{
 assert.match(ui,/function node\(tag,text,cls\)/);
 assert.match(ui,/el\.textContent=text/);
 assert.match(ui,/node\('div',String\(msg\.text\|\|''\)\)/);
 assert.doesNotMatch(ui,/innerHTML\s*=\s*msg\.text/);
 assert.match(ui,/ss_social_report_message/);
 assert.match(ui,/ss_social_block/);
 assert.match(ui,/ss_social_unblock/);
 assert.match(ui,/ss_social_respond/);
 assert.match(ui,/ss_social_cancel/);
});

test('Cloud no longer hides or disables friend and messaging buttons',()=>{
 assert.doesNotMatch(cloud,/Legacy local social activity cannot be represented as global messaging/);
 assert.doesNotMatch(cloud,/\.ss-cloud-active #sdFriendFind/);
 assert.doesNotMatch(cloud,/Local-only social features are disabled in Cloud mode/);
 assert.match(cloud,/ss-cloud-auth-changed/);
 assert.match(ui,/setEnabled\(true\);renderOverview\(\)/);
});

test('shared decks are added without replacing existing flashcards',()=>{
 assert.match(suite,/StudySummitStudyShare=/);
 assert.match(suite,/data\.cards\.push\(\.\.\.clean\)/);
 assert.match(suite,/3500-data\.cards\.length/);
 assert.match(ui,/\$\('sdShareDeck'\)\.onclick/);
 assert.match(sql,/jsonb_array_length\(shared_cards\) not between 1 and 25/);
 assert.match(sql,/octet_length\(shared_cards::text\)>30000/);
 assert.match(ui,/share\.importCards\(cards\)/);
});

test('the earlier offline demonstration remains available',()=>{
 assert.match(suite,/const SOCIALKEY='sd-tutor-local-social-v1'/);
 assert.match(suite,/if\(window\.StudySummitMessagingBridge\?\.configured\)/);
 assert.match(ui,/if\(!bridge\?\.configured\)return/);
});
