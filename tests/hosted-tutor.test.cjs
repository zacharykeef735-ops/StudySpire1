'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const cloud=read('cloud.js'),html=read('index.html');
const server=read('supabase/functions/studyspire-tutor/index.ts');
const migration=read('studyspire-ai-quota-migration.sql');

test('hosted AI starts first for signed-in users and has browser fallback',()=>{
 assert.match(html,/const hosted=window\.StudySpireHostedAI/);
 assert.ok(html.includes('await hosted.ask(messages,maxTokens,window.StudySpireTutorOnChunk)'));
 assert.match(html,/showFreeTutorSetup\(\)/);
 assert.match(html,/StudySpireTutorLastProvider='Browser tutor'/);
 assert.match(html,/state\.lastProvider=window\.StudySpireTutorLastProvider/);
 assert.match(html,/id="ssHostedTutorQuota"/);
 assert.match(html,/cloud\.js\?v=4\.15/);
 assert.doesNotMatch(html,/CLOUDFLARE_AI_TOKEN|SUPABASE_SERVICE_ROLE_KEY/);
});

test('server validates JWT and canonical profile before its privileged quota claim',()=>{
 assert.match(cloud,/window\.StudySpireHostedAI=/);
 assert.match(cloud,/client\.functions\.invoke\('studyspire-tutor'/);
 assert.match(server,/auth\/v1\/user/);
 assert.match(server,/rpc\/ss_ai_status/);
 assert.match(server,/rpc\/ss_ai_claim_for/);
 assert.ok(server.indexOf('rpc/ss_ai_status')<server.indexOf('rpc/ss_ai_claim_for'));
 assert.match(server,/STUDENT_LIMIT/);
 assert.match(migration,/SITE_LIMIT/);
 assert.match(migration,/primary key\(profile_id,usage_day\)/);
 assert.match(migration,/grant execute on function public\.ss_ai_claim_for\(uuid\) to service_role/);
 assert.match(migration,/revoke all on function public\.ss_ai_claim_for\(uuid\) from public,anon,authenticated/);
 assert.match(migration,/if mine>=60/);
 assert.match(migration,/if global_count>=400/);
});

test('hosted backend handles provider configuration securely and teaches first',()=>{
 assert.match(server,/Deno\.env\.get\("CLOUDFLARE_AI_TOKEN"\)/);
 assert.match(server,/Deno\.env\.get\("CLOUDFLARE_ACCOUNT_ID"\)/);
 assert.match(server,/AI_BINDING_NOT_DEPLOYED/);
 assert.match(server,/TEXT_ONLY/);
 assert.match(server,/submission-ready answer/);
 assert.match(server,/const model="@cf\/meta\/llama-3\.1-8b-instruct-fp8"/);
 assert.doesNotMatch(cloud,/api\.cloudflare\.com\/client\/v4/);
 assert.doesNotMatch(html,/api\.cloudflare\.com\/client\/v4/);
});

test('a hosted AI failure requires student consent before switching to installed browser AI',()=>{
 assert.match(html,/window\.confirm\('Hosted AI is unavailable or its daily limit is reached/);
 assert.match(html,/You chose to wait and try again later/);
 assert.match(html,/if\(!localEngine\)\{\s*showFreeTutorSetup\(\)/);
 assert.doesNotMatch(html,/console\.warn\('Hosted AI unavailable; using the downloaded browser tutor/);
});

test('Cloudflare diagnostics disclose no credentials and do not consume questions',()=>{
 assert.match(server,/body\?\.action==="diagnose"/);
 assert.match(server,/api\.cloudflare\.com\/client\/v4\/user\/tokens\/verify/);
 assert.match(server,/AI_BINDING_NOT_DEPLOYED/);
 assert.match(server,/ACCOUNT_ID_MISSING/);
 assert.match(server,/ACCOUNT_ID_INVALID/);
 assert.match(server,/TOKEN_INVALID/);
 assert.match(server,/TOKEN_ACTIVE/);
 assert.match(server,/\.trim\(\)/);
 assert.match(cloud,/body:\{action:'diagnose'\}/);
 assert.match(html,/id="ssHostedTutorTest"/);
 assert.match(html,/await bridge\.diagnose\(\)/);
 assert.ok(server.indexOf('body?.action==="diagnose"') < server.indexOf('ss_ai_claim_for'));
 assert.doesNotMatch(html,/api\.cloudflare\.com\/client\/v4/);
});

test('Tutor quick check is visible when signed in, and owner diagnostics are restricted',async()=>{
 const vm=require('node:vm');
 assert.match(html,/id="askBtn"[^>]*>✦ Explain and guide me<\/button>[\s\S]{0,450}id="ssTutorQuickConnectionTest"/);
 assert.match(html,/id="ssTutorQuickConnectionStatus" role="status"/);
 const block=html.match(/<script id="ss-tutor-connection-test">([\s\S]*?)<\/script>/)?.[1];
 assert.ok(block,'Missing connection test script');
 const control=()=>({hidden:false,disabled:false,addEventListener(event,handler){this[event]=handler}});
 const quick=control(),owner=control(),settings={hidden:false},output={className:'',textContent:''};
 const items={ssTutorQuickConnectionTest:quick,ssTutorOwnerConnectionTest:owner,ssTutorQuickConnectionStatus:output,ssHostedTutorTest:settings};
 const handlers={};
 const service={available:()=>false,canDiagnose:()=>false,
  quota:async()=>({daily_limit:60,used:2,site_limit:400,site_used:10}),
  diagnose:async()=>({ready:false,message:'Account ID needs checking.'})};
 const win={addEventListener(name,handler){handlers[name]=handler},StudySpireHostedAI:service};
 vm.runInNewContext(block,{document:{getElementById:id=>items[id]||null},window:win,Date});
 assert.equal(quick.hidden,true);
 assert.equal(owner.hidden,true);
 service.available=()=>true;
 handlers['ss-cloud-auth-changed']();
 assert.equal(quick.hidden,false);
 assert.equal(owner.hidden,true);
 await quick.click();
 assert.match(output.textContent,/58 of 60 questions left today/);
 assert.equal(output.className,'status show good');
 service.canDiagnose=()=>true;
 handlers['ss-cloud-auth-changed']();
 assert.equal(owner.hidden,false);
 assert.equal(settings.hidden,false);
 await owner.click();
 assert.match(output.textContent,/Account ID needs checking/);
 assert.equal(output.className,'status show bad');
 service.diagnose=async()=>({ready:true,message:'Token active'});
 await owner.click();
 assert.match(output.textContent,/Token active/);
 assert.equal(output.className,'status show good');
 service.available=()=>false;service.canDiagnose=()=>false;
 handlers['ss-cloud-auth-changed']();
 assert.equal(quick.hidden,true);
 assert.equal(owner.hidden,true);
 assert.equal(settings.hidden,true);
 assert.equal(output.textContent,'');
});
test('diagnostic requires verified zk5142 account in backend and UI',()=>{
 assert.match(cloud,/canDiagnose:\(\)=>Boolean\([^\n]*profile\.username==='zk5142'/);
 assert.match(server,/ss_profiles\?select=username&id=eq/);
 assert.match(server,/rows\[0\]\?\.username!=="zk5142"/);
 assert.match(server,/fail\(403,"FORBIDDEN"/);
 assert.ok(server.indexOf('rows[0]?.username')<server.indexOf('if(!cfToken)return respond'));
 assert.match(html,/#ssTutorQuickConnectionTest\[hidden\],#ssHostedTutorTest\[hidden\]/);
 assert.match(html,/id="ssTutorOwnerConnectionTest"[^>]*hidden/);
 assert.match(html,/id="ssHostedTutorTest"[^>]*hidden/);
});

test('hosted AI supports zero-secret Workers AI binding',()=>{
 assert.match(server,/WORKER_URL="https:\/\/studyspire\.zacharykeef735\.workers\.dev"/);
 assert.match(server,/async function workerBindingReady/);
 assert.match(server,/AI_BINDING_READY/);
 assert.match(server,/WORKER_URL\+"\/v1\/tutor"/);
 assert.ok(server.indexOf('if(await workerBindingReady())')<server.indexOf('rpc/ss_ai_claim_for'));
 assert.match(server,/AI_BINDING_NOT_DEPLOYED/);
});

test('plain Tutor questions are serialized as text, not image-part arrays',()=>{
 const vm=require('node:vm');
 const begin=html.indexOf('function currentMessages(body)');
 const end=html.indexOf('async function sendToAI()',begin);
 assert.ok(begin>=0 && end>begin,'Current question builder must exist');
 const sandbox={};
 vm.runInNewContext(html.slice(begin,end)+'; this.buildTutorMessage=currentMessages;',sandbox);
 const simple=sandbox.buildTutorMessage({kind:'question',prompt:'3x+7',context:'',style:'steps'});
 assert.equal(simple.length,2);
 assert.equal(simple[1].role,'user');
 assert.equal(typeof simple[1].content,'string');
 assert.ok(simple[1].content.includes('3x+7'));
 assert.match(simple[1].content,/Teach me|step|process/i);
 const withImage=sandbox.buildTutorMessage({kind:'question',prompt:'Explain this',context:'',style:'hint',imageDataUrl:'data:image/png;base64,test'});
 assert.equal(Array.isArray(withImage[1].content),true);
 assert.equal(withImage[1].content[0].type,'text');
 assert.equal(withImage[1].content[1].type,'image_url');
});
