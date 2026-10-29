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
 assert.match(html,/cloud\.js\?v=4\.06/);
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

test('Tutor displays a permanent connection test beside Explain and guide me',async()=>{
 const vm=require('node:vm');
 assert.match(html,/id="askBtn"[^>]*>✦ Explain and guide me<\/button>[\s\S]{0,350}id="ssTutorQuickConnectionTest"/);
 assert.match(html,/id="ssTutorQuickConnectionStatus" role="status"/);
 const block=html.match(/<script id="ss-tutor-connection-test">([\s\S]*?)<\/script>/)?.[1];
 assert.ok(block,'Missing independent Tutor connection test script');
 const button={hidden:true,disabled:false,addEventListener(event,callback){this[event]=callback;}};
 const settings={hidden:true};
 const output={className:'',textContent:''};
 const page={getElementById:id=>id==='ssTutorQuickConnectionTest'?button:id==='ssTutorQuickConnectionStatus'?output:id==='ssHostedTutorTest'?settings:null};
 const handlers={};
 const win={addEventListener(name,callback){handlers[name]=callback;},StudySpireHostedAI:{canDiagnose:()=>false,available:()=>true,diagnose:async()=>({ok:true,ready:false,code:'ACCOUNT_ID_INVALID',message:'Account ID needs checking.'})}};
 vm.runInNewContext(block,{document:page,window:win});
 assert.equal(typeof button.click,'function');
 assert.equal(button.hidden,true);
 assert.equal(settings.hidden,true);
 await button.click();
 assert.equal(output.textContent,'');
 win.StudySpireHostedAI.canDiagnose=()=>true;
 handlers['ss-cloud-auth-changed']();
 assert.equal(button.hidden,false);
 assert.equal(settings.hidden,false);
 await button.click();
 assert.equal(button.disabled,false);
 assert.match(output.textContent,/Account ID needs checking/);
 assert.equal(output.className,'status show bad');
 win.StudySpireHostedAI.diagnose=async()=>({ok:true,ready:true,code:'TOKEN_ACTIVE',message:'Token is active.'});
 await button.click();
 assert.match(output.textContent,/Token is active/);
 assert.equal(output.className,'status show good');
 win.StudySpireHostedAI.canDiagnose=()=>false;
 handlers['ss-cloud-auth-changed']();
 assert.equal(button.hidden,true);
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
 assert.match(html,/id="ssTutorQuickConnectionTest"[^>]*hidden/);
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
