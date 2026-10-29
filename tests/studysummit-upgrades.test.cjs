'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const load=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=load('index.html');
const cloud=load('cloud.js');
const suite=load('suite.js');
const extra=load('enhancements.js');
const sql=load('self-service-password-change-migration.sql');

test('all extracted and newly added scripts have valid JavaScript',()=>{
  assert.doesNotThrow(()=>new Function(suite));
  assert.doesNotThrow(()=>new Function(extra));
  assert.doesNotThrow(()=>new Function(cloud));
  for(const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(!m[2].trim()||/\bsrc\s*=/.test(m[1])||/application\/json/.test(m[1]))continue;
    assert.doesNotThrow(()=>new Function(m[2]));
  }
});
test('external scripts load in dependency order and cache-busting version',()=>{
  const suitePos=html.indexOf('src="suite.js?v=3.80"'),cloudPos=html.indexOf('src="cloud.js?v=4.14"'),enhancementsPos=html.indexOf('src="enhancements.js?v=3.81"');
  assert.ok(suitePos>0&&cloudPos>suitePos&&enhancementsPos>cloudPos);
  assert.match(html,/enhancements\.css\?v=3\.84/);
  assert.ok(html.indexOf('src="help-guide.js?v=3.94"')>enhancementsPos,'Help should load after the study enhancements');
  assert.doesNotMatch(html,/<script id="sd-suite-script">/);
});
test('suite writes notify account-scoped progress without modifying study data format',()=>{
  assert.match(suite,/sdAccountKey\('studydock-suite-v1'\)/);
  assert.match(suite,/localStorage\.setItem\(SKEY,JSON\.stringify\(data\)\)/);
  assert.match(suite,/dispatchEvent\(new Event\('ss-suite-updated'\)\)/);
});
test('password-change requires old password, mapped session and server authorization',()=>{
  assert.match(sql,/m\.session_uid=auth_session/);
  assert.match(sql,/crypt\(current_password,old_hash\)/);
  assert.match(sql,/auth\.jwt\(\)->>'is_anonymous'/);
  assert.match(sql,/delete from ss_private\.username_sessions/);
  assert.match(sql,/revoke all on function public\.ss_username_change_password\(text,text\) from public,anon/);
  assert.match(sql,/grant execute on function public\.ss_username_change_password\(text,text\) to authenticated/);
  assert.match(cloud,/current_password:old,new_password:next/);
  assert.match(cloud,/data!==true/);
  assert.match(cloud,/RECENT_USERNAMES/);
  assert.match(cloud,/never passwords|Only usernames|Only usernames are remembered/i);
});
test('progress is calculated from existing suite data and separated per account',()=>{
  const saved=new Map(),window={sdAccountKey:name=>window.account+'::'+name,addEventListener:()=>{},dispatchEvent:()=>{},account:'A'};
  const document={readyState:'loading',addEventListener:()=>{}};
  const localStorage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
  const code=extra.replace(/\}\)\(\);\s*$/, 'window.testHelpers={pRead,observeSuite,day,points,dateKey};})();');
  assert.notEqual(code,extra,'Test instrumentation must attach to the IIFE');
  vm.runInNewContext(code,{window,document,localStorage,console,Event:class {},Date,Math,Number,String,Object,Array,JSON,setInterval,clearInterval,setTimeout,clearTimeout});
  const h=window.testHelpers;
  const data={stats:{seen:3,focus:1},cards:[{front:'A',back:'B'}],tasks:[{id:'1',done:false}]};
  saved.set('A::studydock-suite-v1',JSON.stringify(data));
  h.observeSuite(); // establish baseline without treating old data as a new session
  data.stats.seen+=5;data.stats.focus+=1;data.tasks[0].done=true;
  saved.set('A::studydock-suite-v1',JSON.stringify(data));
  h.observeSuite();
  const a=h.pRead();
  assert.equal(h.points(a.days[h.dateKey()]),3);
  window.account='B';
  const b=h.pRead();
  assert.equal(h.points(b.days[h.dateKey()]),0);
  assert.equal(b.goal,3);
  assert.ok(saved.has('A::studydock-study-progress-v1'));
  assert.equal(saved.has('B::studydock-study-progress-v1'),false);
});
test('dashboard includes diagnostics, keyboard actions and real-data source',()=>{
  assert.match(extra,/navigator\.gpu\.requestAdapter/);
  assert.match(extra,/navigator\.storage\.estimate/);
  assert.match(extra,/StudySummitCloudHealth/);
  assert.match(extra,/studydock-suite-v1/);
  assert.match(extra,/ss-study-lab-v374/);
  assert.match(extra,/openMenu/);
  assert.match(extra,/ssupClock/);
  assert.match(extra,/ssupAdvancedAI/);
  assert.doesNotMatch(extra,/service_role|sb_secret_/);
});
test('cloud uploads are pinned to original account and never overwrite later session state',()=>{
  assert.match(cloud,/const uploadFor=person\.id/);
  assert.match(cloud,/user_id:uploadFor/);
  assert.match(cloud,/if\(person\?\.id===uploadFor\)/);
  assert.match(cloud,/StudySummitCloudHealth/);
});
