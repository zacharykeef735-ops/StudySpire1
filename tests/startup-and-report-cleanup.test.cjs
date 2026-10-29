'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const html=read('index.html');
const layout=read('studyspire-layout.js');
const cloud=read('cloud.js');
const sql=read('studyspire-auto-delete-reviewed-reports.sql');

test('first paint shows loading shell until the new dashboard is complete',()=>{
 assert.match(html,/<html lang="en" class="ss-ui-boot">/);
 assert.match(html,/<style id="ss-ui-boot-style">/);
 assert.match(html,/html\.ss-ui-boot \.app\s*\{\s*visibility:hidden!important/);
 assert.match(html,/id="ssBootScreen" role="status"/);
 assert.match(html,/<noscript><style>html\.ss-ui-boot \.app\{visibility:visible!important/);
 assert.ok(html.indexOf('id="ss-ui-boot-style"')<html.indexOf('<body>'));
 assert.ok(html.indexOf('id="ssBootScreen"')<html.indexOf('<div class="app">'));
 assert.match(html,/StudySpire dashboard initializer failed; using basic layout/);
 assert.doesNotThrow(()=>new Function(layout));
 const refine=layout.indexOf('refineHome();installSidebar();installTopbar();updateMini()');
 const apply=layout.indexOf("document.body.classList.add('ss-screenshot-layout')");
 const unveil=layout.indexOf("document.documentElement.classList.remove('ss-ui-boot')");
 assert.ok(refine>=0 && apply>refine && unveil>apply,
  'New layout must be fully applied before revealing the app');
});

test('cloud staff report review removes the item only after successful RPC',()=>{
 assert.match(cloud,/await rpc\('ss_review_report',\{report_id:r\.id\}\);await renderStaff\(\);staffMsg\('Report reviewed and automatically deleted/);
 assert.match(cloud,/review\.disabled=true/);
 assert.match(cloud,/No open reports\./);
 assert.doesNotMatch(cloud,/<option value="reviewed">Reviewed reports<\/option>/);
 assert.match(cloud,/ss_staff_audit/);
});

test('general and avatar reports are deleted only when closed, with audit retained',()=>{
 assert.match(sql,/old\.status='open' and new\.status in \('reviewed','dismissed'\)/);
 assert.match(sql,/delete from public\.ss_reports where id=new\.id and status=new\.status/);
 assert.match(sql,/delete from ss_private\.ss_profile_avatar_reports where id=new\.id and status=new\.status/);
 assert.match(sql,/after update of status on public\.ss_reports/);
 assert.match(sql,/after update of status on ss_private\.ss_profile_avatar_reports/);
 assert.doesNotMatch(sql,/delete from public\.ss_admin_audit/);
 assert.match(cloud,/ss_staff_audit/);
});

test('local moderation removes reviewed reports without deleting other reports',()=>{
 const from=html.indexOf('function mark(id){');
 const to=html.indexOf('function restrict(user,on,',from);
 assert.ok(from>=0&&to>from);
 let data=[{id:'a',status:'open'},{id:'b',status:'open'},{id:'c',status:'reviewed'}],calls=0;
 const context={
  admin:()=>true,
  KEYS:{reports:'reports'},
  read:()=>data,
  write:(_k,newData)=>{data=newData},
  window:{dispatchEvent:()=>{calls++}},
  Event:function Event(){}
 };
 vm.runInNewContext(html.slice(from,to)+';this.mark=mark',context);
 assert.equal(context.mark('a'),true);
 assert.equal(data.length,2);
 assert.equal(data.some(x=>x.id==='a'),false);
 assert.equal(data.some(x=>x.id==='b'),true);
 assert.equal(calls,1);
 assert.equal(context.mark('a'),false);
 assert.equal(context.mark('b'),true);
 assert.equal(data.some(x=>x.id==='b'),false);
 assert.match(html,/ss-summit-mod-v361-reports',all\.filter\(x=>x\.id!==r\.id\)/);
});
