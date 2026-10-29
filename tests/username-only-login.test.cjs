'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
test('account sign-in offers username and password only',()=>{
 const cloud=read('cloud.js');
 assert.match(cloud,/id="ssc-user"/);
 assert.match(cloud,/ss_username_login/);
 assert.match(cloud,/ss_username_register/);
 assert.match(cloud,/ss_request_password_reset/);
 assert.doesNotMatch(cloud,/Older email account|id="ssc-emailMethod"|id="ssc-emailRow"|id="ssc-nameRow"/);
 assert.doesNotMatch(cloud,/client\.auth\.signUp\(|client\.auth\.signInWithPassword\(/);
 assert.doesNotThrow(()=>new Function(cloud));
});
