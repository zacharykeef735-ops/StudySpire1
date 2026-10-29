'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const html=read('index.html'),js=read('studyspire-home.js'),css=read('studyspire-home.css');
const logo=read('studyspire-mark.svg'),readme=read('README.md');

test('StudySpire branding and Academic AI appear on the actual site',()=>{
  assert.match(html,/<title>StudySpire \| Academic AI<\/title>/);
  assert.match(html,/href="studyspire-mark\.svg"/);
  assert.match(html,/href="studyspire-home\.css\?v=3\.90"/);
  assert.match(html,/src="studyspire-home\.js\?v=3\.94"/);
  assert.match(html,/src="help-guide\.js\?v=3\.94"/);
  assert.match(html,/src="messaging\.js\?v=3\.95"/);
  assert.match(html,/ACADEMIC AI/);
  assert.doesNotMatch(html,/src="data:image\/webp;base64,/);
  assert.match(logo,/<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(logo,/StudySpire/);
  assert.doesNotMatch(html,/Upgrade to Pro/i);
});

test('home scripts load after existing features and tool navigation is complete',()=>{
  assert.doesNotThrow(()=>new Function(js));
  const scripts=['suite.js?v=3.80','cloud.js?v=4.15','enhancements.js?v=3.81',
    'messaging.js?v=3.95','help-guide.js?v=3.94','studyspire-home.js?v=3.94'];
  const positions=scripts.map(s=>html.indexOf('src="'+s+'"'));
  assert.ok(positions.every(p=>p>0));
  assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
  const wrapped=js.replace(/\}\)\(\);\s*$/,'window.__test={specs,navigate,renderData,createPlanRow,updateBrand};})();');
  assert.notEqual(wrapped,js);
  const fakeWindow={};
  vm.runInNewContext(wrapped,{window:fakeWindow,document:{readyState:'loading',addEventListener(){}},console});
  const specs=fakeWindow.__test.specs;
  assert.equal(specs.length,5);
  assert.deepEqual(Array.from(specs.map(s=>s[0])),[
    'AI Tutor','Flashcards','Assignments','Documents','Friends'
  ]);
  assert.deepEqual(Array.from(new Set(specs.map(s=>s[3]))).sort(),['agenda','answer','files','friends','quiz']);
  assert.match(js,/__KEEP_STUDYSYNCKSUITE__/);
  assert.match(js,/suite\(\)\?\.refreshData\(\)/);
  assert.match(js,/ss-suite-updated/);
});

test('home uses actual study records rather than made-up dashboard data',()=>{
  for(const key of ['data.assignments','data.tasks','data.docs','Nothing planned yet',
    'No saved documents yet','ssHomeFriendsOpen','ssHomeFocusOpen'])assert.ok(js.includes(key),key);
  assert.doesNotMatch(js,/Taylor Kim|Marcus Lee|Priya Shah|Alex Chen/);
  assert.doesNotMatch(js,/upgrade|subscription|premium/i);
});

test('Mini, account roles, Help and study features remain wired',()=>{
  for(const id of ['page-answer','page-suite','miniLauncher','miniPanel','sdTopAccount','openSettings']){
    assert.ok(html.includes('id="'+id+'"'),id+' missing');
  }
  assert.match(css,/body\.ss-brand-ready #miniLauncher/);
  assert.match(css,/display:grid!important/);
  assert.match(css,/\.ss-home-tools/);
  assert.match(css,/@media\(max-width:540px\)/);
  assert.match(readme,/## How to use StudySpire/);
  assert.match(readme,/Academic AI/);
  const cloud=read('cloud.js'),suite=read('suite.js'),messages=read('messaging.js');
  for(const oldApi of ['StudySummitMessagingBridge','StudySummitCloudHealth']){
    assert.ok(cloud.includes(oldApi),'compatibility API removed: '+oldApi);
  }
  assert.match(suite,/__KEEP_STUDYSYNCKSUITE__/);
  assert.match(messages,/StudySummitMessagingBridge/);
  assert.match(cloud,/ssCloudOwner/);
});

test('all inline website JavaScript remains syntactically valid',()=>{
  let count=0;
  for(const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(!m[2].trim()||/\bsrc\s*=/.test(m[1])||/application\/json/.test(m[1]))continue;
    assert.doesNotThrow(()=>new Function(m[2]));
    count++;
  }
  assert.ok(count>=10);
});


test('the screenshot-matched dashboard code is present, connected and executable',()=>{
  const layout=read('studyspire-layout.js'),styles=read('studyspire-layout.css');
  assert.doesNotThrow(()=>new Function(layout));
  assert.match(html,/href="studyspire-layout\.css\?v=3\.95"/);
  assert.match(html,/src="studyspire-layout\.js\?v=3\.96"/);
  assert.ok(html.indexOf('studyspire-layout.js?v=3.96')>html.indexOf('studyspire-home.js?v=3.94'));
  for(const expected of ['ssScreenshotNav','ssTopSearch','ssNotificationButton','ssHomeFriendList',
    'ssHomeDocumentList','ssHelpTopButton','miniLauncher']){
    assert.ok(layout.includes(expected),'Missing UI feature: '+expected);
  }
  assert.match(styles,/data:image\/webp;base64,/);
  assert.match(styles,/ss-screenshot-layout/);
  assert.match(styles,/ss-home-right-stack/);
});

test('Google Docs paste handoff is absent from Writing Feedback but the editor remains',()=>{
  for(const old of ['sdDocsHandoff','sdDocsCopy','sdDocsLink','sdDocsBlankLine','sdDocsStatus',
    'sd-docs-handoff-style','sd-docs-handoff-script','docs.google.com']){
    assert.ok(!html.includes(old),'Obsolete Google Docs handoff remains: '+old);
  }
  for(const retained of ['id="essayDraft"','id="reviewEssay"','id="copyEssay"',
    'id="downloadEssay"','id="saveEssay"']){
    assert.ok(html.includes(retained),'Writing tool removed unexpectedly: '+retained);
  }
});
