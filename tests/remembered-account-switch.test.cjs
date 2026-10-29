'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const cloud=fs.readFileSync(path.join(__dirname,'..','cloud.js'),'utf8');
const migration=fs.readFileSync(path.join(__dirname,'..','remembered-account-switch-migration.sql'),'utf8');

test('remembered accounts store opaque tokens, never passwords',()=>{
 assert.match(cloud,/const REMEMBERED_TOKENS='ss-cloud-remembered-device-v1'/);
 assert.match(cloud,/client\.rpc\('ss_remember_current_username'\)/);
 assert.match(cloud,/client\.rpc\('ss_remembered_switch',\{chosen_username:name,device_token:token\}\)/);
 assert.match(cloud,/if\(data!==true\)\{\s*forgetDeviceToken\(name\)/);
 assert.match(cloud,/requirePasswordFor\(name,'The saved sign-in/);
 assert.doesNotMatch(cloud,/localStorage\.setItem\([^\n]*password/i);
 assert.match(cloud,/await uploadSnapshot\(\);\s*await lastUpload;\s*await ensureAnonymous\(\)/);
});
test('remembered-account list and explicit forget options exist',()=>{
 for(const element of ['ssc-switchList','ssc-switchNames','ssc-other-account','ssc-save-current'])
  assert.ok(cloud.includes('id="'+element+'"'),element);
 assert.match(cloud,/remove\.onclick=async\(\)=>/);
 assert.match(cloud,/ss_forget_remembered_username/);
});
test('local list is bounded to eight usernames and tokens',()=>{
 const start=cloud.indexOf('const REMEMBERED_TOKENS=');
 const end=cloud.indexOf('window.StudySummitCloudHealth=',start);
 assert.ok(start>=0&&end>start);
 const cache=new Map(),localStorage={
   getItem:key=>cache.has(key)?cache.get(key):null,
   setItem:(key,value)=>cache.set(key,String(value))
 };
 const api=vm.runInNewContext(cloud.slice(start,end)+';({deviceToken,deviceTokens,storeDeviceToken,forgetDeviceToken})',{localStorage});
 for(let i=0;i<10;i++)api.storeDeviceToken('student'+i,('a'+i.toString(16)).padEnd(64,'0'));
 assert.equal(Object.keys(api.deviceTokens()).length,8);
 assert.equal(api.deviceToken('student9'),('a9').padEnd(64,'0'));
 api.forgetDeviceToken('student9');
 assert.equal(api.deviceToken('student9'),'');
});
test('server restricts tokens and revokes every device when password changes',()=>{
 assert.match(migration,/create table if not exists ss_private\.remembered_login_tokens/);
 assert.match(migration,/enable row level security/);
 assert.match(migration,/revoke all on ss_private\.remembered_login_tokens from public, anon, authenticated/);
 assert.match(migration,/encode\(digest\(new_token,'sha256'\),'hex'\)/);
 assert.match(migration,/after update of password_hash on ss_private\.username_credentials/);
 assert.match(migration,/delete from ss_private\.remembered_login_tokens where user_id = new\.user_id/);
 assert.match(migration,/auth\.jwt\(\)->>'is_anonymous'/);
 assert.match(migration,/grant execute on function public\.ss_remember_current_username/);
});
