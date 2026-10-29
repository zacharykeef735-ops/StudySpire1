// Browser AI and page-startup regressions (no third-party test packages needed).
// Run: node --test tests/browser-ai-smoke.test.cjs
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function between(startText, endText) {
  const start=html.indexOf(startText);
  if(start<0)throw new Error('Missing start: '+startText);
  const end=html.indexOf(endText,start+startText.length);
  if(end<0)throw new Error('Missing end: '+endText);
  return html.slice(start,end);
}

test('all inline JavaScript remains syntactically valid', () => {
  let count=0;
  for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(/\bsrc\s*=/.test(match[1])||/application\/json/.test(match[1]))continue;
    if(!match[2].trim())continue;
    assert.doesNotThrow(()=>new Function(match[2]));
    count++;
  }
  assert.ok(count>=10,'Expected multiple inline application scripts');
});

test('status updates survive removed top/sidebar elements', () => {
  const src=between('function updateConnectionUI(){','function updateMini(){');
  const connected={connected:true};
  const absent=vm.runInNewContext(src+';updateConnectionUI;',{
    state:connected,$:()=>null
  });
  assert.doesNotThrow(()=>absent());
  const toggles={};
  const nodes={};
  for(const id of ['topMode','sideMode','topDot','sideDot']){
    nodes[id]={textContent:'',classList:{toggle:(_,enabled)=>{toggles[id]=enabled}}};
  }
  const handler=vm.runInNewContext(src+';updateConnectionUI;',{
    state:connected,$:id=>nodes[id]
  });
  handler();
  assert.equal(nodes.topMode.textContent,'Browser tutor ready');
  assert.equal(nodes.sideMode.textContent,'Browser tutor ready');
  assert.equal(toggles.topDot,true);
  assert.equal(toggles.sideDot,true);
  connected.connected=false;
  handler();
  assert.equal(nodes.topMode.textContent,'Load browser tutor');
  assert.equal(toggles.sideDot,false);
});

test('missing generic status elements do not throw', () => {
  const source=between("function status(id,msg,type='info')","function clearStatus(id)");
  const handler=vm.runInNewContext(source+';status;',{$:()=>null,console:{warn:()=>{}}});
  assert.doesNotThrow(()=>handler('missing','Retry later','bad'));
});

test('corrupt saved history entries are ignored during startup', () => {
  const source=between('function loadPrefs(){','function persist(){');
  const state={history:[],mini:false,connected:false,provider:'',model:''};
  const ctx={state,STORAGE:'test',localStorage:{getItem:()=>JSON.stringify({
    history:[null,9,{title:'invalid',content:42},{title:'healthy',content:'Recovered notes',type:'answer'}]
  })},updateMini:()=>{},updateConnectionUI:()=>{},renderHistory:()=>{},updateWordStats:()=>{}};
  const load=vm.runInNewContext(source+';loadPrefs;',ctx);
  assert.doesNotThrow(()=>load());
  assert.equal(state.history.length,1);
  assert.equal(state.history[0].content,'Recovered notes');
});

test('all offered AI model IDs match the supported model catalog', () => {
  const rawCatalog=between('const MODEL_CATALOG = {','const DEFAULT_MODEL_ID =');
  const ctx={};
  vm.runInNewContext(rawCatalog+';catalog=MODEL_CATALOG;',ctx);
  const options=between('<select id="localModelChoice"','</select>');
  const optionIds=[...options.matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(optionIds.sort(),Object.keys(ctx.catalog).sort());
  assert.equal(optionIds.some(id=>id.includes('Qwen2.5')),false);
  assert.ok(optionIds.includes('SmolLM2-360M-Instruct-q4f32_1-MLC'));
  assert.ok(optionIds.includes('Llama-3.2-1B-Instruct-q4f16_1-MLC'));
  assert.match(html,/@mlc-ai\/web-llm@0\.2\.85/);
});

test('an unavailable model falls back to a known compatible model', () => {
  const src=between('const supported=(id)=>{','setStatus("Step 3/3');
  const catalog={};
  vm.runInNewContext(between('const MODEL_CATALOG = {','const DEFAULT_MODEL_ID =')+';result=MODEL_CATALOG;',catalog);
  const state={
    MODEL_CATALOG:catalog.result,
    DEFAULT_MODEL_ID:'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    known:[{model_id:'Llama-3.2-1B-Instruct-q4f16_1-MLC'}],
    adapter:{features:new Set()},
    modelSelect:{value:'not-supported'},
    localStorage:{setItem:()=>{}},
    sdAccountKey:key=>key,
    el:()=>null,
    setStatus:()=>{}
  };
  const run=`let chosenModelId='Qwen2.5-3B-Instruct-q4f16_1-MLC';
let chosenModel={label:'Removed'};
`+src+`
result=chosenModelId;`;
  vm.runInNewContext(run,state);
  assert.equal(state.result,state.DEFAULT_MODEL_ID);
  assert.equal(state.modelSelect.value,state.DEFAULT_MODEL_ID);
});

test('the free on-device tutor is offered before any download starts', () => {
  assert.match(html,/function showFreeTutorSetup\(\)/);
  assert.match(html,/id = 'ssFreeTutorOffer'/);
  assert.match(html,/id="ssFreeTutorDownload"/);
  assert.match(html,/Downloading is optional and only starts when you choose it/);
  assert.match(html,/SmolLM2-360M-Instruct-q4f32_1-MLC/);
  assert.match(html,/showFreeTutorSetup\(\);\s*throw new Error\('Sign in/);
  assert.match(html,/start\.click\(\)/);
  assert.match(html,/if \(on\) dismissFreeTutorSetup\(\)/);
  assert.doesNotMatch(html,/https:\/\/generativelanguage\.googleapis\.com/);
});

test('AI loading stops on persistent 0% stalls, without concurrent GPU retries', () => {
  assert.match(html,/loadWithWatchdog/);
  assert.match(html,/240000/);
  assert.match(html,/loadNeedsReload=true/);
  assert.match(html,/if\s*\(loading\|\|loadNeedsReload\)\s*return;/);
  assert.match(html,/generation!==loadGeneration/);
});
