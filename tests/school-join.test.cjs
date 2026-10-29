'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
test('all signed-in users can open school menu and request to join',()=>{
 const js=read('school-management.js');
 assert.match(js,/showLaunchers\(true\)/);
 assert.match(js,/function renderJoin\(/);
 assert.match(js,/ss_school_request_join/);
 assert.match(js,/ss_school_my_join_requests/);
 assert.match(js,/ss_school_cancel_join/);
 assert.match(js,/join_org/);
 assert.match(js,/join_school/);
 const env={window:{addEventListener(){}},document:{readyState:'loading',addEventListener(){}}};
 vm.runInNewContext(js,env,{timeout:1000});
 assert.equal(typeof env.window.StudySpireSchoolManager.open,'function');
});
test('principals and leaders can review applications, but cannot self-promote requesters',()=>{
 const js=read('school-management.js'),sql=read('studyspire1-school-join.sql');
 assert.match(js,/ss_school_pending_join_requests/);
 assert.match(js,/ss_school_review_join/);
 assert.match(sql,/requested_role in \('student','teacher'\)/);
 assert.match(sql,/ss_school_principal\(school\)/);
 assert.match(sql,/ss_school_org_admin\(org\)/);
 assert.match(sql,/ss_school_platform_owner\(\)/);
 assert.match(sql,/insert into public\.ss_school_memberships/);
 assert.match(sql,/role,assigned_by/);
 assert.match(sql,/Daily request limit reached/);
 assert.match(sql,/ss_join_one_pending_per_school/);
 assert.match(sql,/alter table public\.ss_school_join_requests enable row level security/);
 assert.match(sql,/revoke all on public\.ss_school_join_requests from public,anon,authenticated/);
 assert.doesNotMatch(sql,/grant (?:select|insert|update|delete) on public\.ss_school_join_requests/i);
});
test('school-only Cloud bridge allows the required join RPCs',()=>{
 const cloud=read('cloud.js');
 for(const name of ['ss_school_request_join','ss_school_my_join_requests','ss_school_pending_join_requests','ss_school_review_join','ss_school_cancel_join'])
  assert.ok(cloud.includes(name),'Missing '+name);
});
