'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('school hub opens for cloud accounts and uses one school code',()=>{
 const js=read('school-management.js');
 assert.match(js,/showLaunchers\(!!connected\)/);
 assert.match(js,/ss1_school_request_join/);
 assert.match(js,/ss_school_my_join_requests/);
 assert.match(js,/ss_school_cancel_join/);
 assert.match(js,/join_school/);
 assert.doesNotMatch(js,/Create organization|organization code|Organizations & Schools/);
 const env={window:{addEventListener(){}},document:{readyState:'loading',addEventListener(){}}};
 vm.runInNewContext(js,env,{timeout:1000});
 assert.equal(typeof env.window.StudySpireSchoolManager.open,'function');
});

test('school-only SQL enforces join approvals and school permissions',()=>{
 const sql=read('studyspire1-school-only.sql'),join=read('studyspire1-school-join.sql');
 assert.match(sql,/ss1_school_request_join/);
 assert.match(sql,/ss1_school_pending\(/);
 assert.match(sql,/ss1_school_review_join/);
 assert.match(sql,/ss1_school_set_permission/);
 assert.match(sql,/Only the platform Owner can edit admin permissions/);
 assert.match(sql,/Permission denied: manage_enrollment/);
 assert.match(sql,/Permission denied: view_analytics/);
 assert.match(sql,/Permission denied: publish_announcements/);
 assert.match(sql,/Permission denied: manage_settings/);
 assert.match(join,/requested_role in \('student','teacher'\)/);
 assert.match(join,/ss_join_one_pending_per_school/);
 assert.match(join,/alter table public\.ss_school_join_requests enable row level security/);
 assert.doesNotMatch(sql,/grant (?:select|insert|update|delete) on public\.ss1_school_admins/i);
});

test('StudySpire1 Cloud bridge allows school-only RPCs and refuses organization management',()=>{
 const cloud=read('cloud.js');
 for(const name of ['ss1_school_overview','ss1_school_create','ss1_school_set_admin','ss1_school_set_permission',
  'ss1_school_set_member','ss1_school_request_join','ss1_school_pending','ss1_school_review_join',
  'ss1_school_announce','ss1_school_analytics','ss_school_my_join_requests','ss_school_cancel_join'])
   assert.ok(cloud.includes(name),'Missing '+name);
 const allowed=cloud.match(/const allowed=new Set\(\[([\s\S]*?)\]\);/);
 assert.ok(allowed,'School API allowlist missing');
 assert.doesNotMatch(allowed[1],/ss_school_create_organization|ss_school_set_admin|ss_school_create_school/);
});
