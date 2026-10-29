'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const home=read('studyspire-home.js');
const layout=read('studyspire-layout.js');
const css=read('studyspire-layout.css');
const html=read('index.html');
const readme=read('README.md');
const guide=read('help-guide.js');

test('six unique main sidebar destinations, with Study Center removed',()=>{
  assert.match(layout,/moveOriginal\(nav,'button\[data-suite-target="agenda"\]','Assignments'/);
  assert.match(layout,/actionNav\('Documents','notes','files'\)/);
  assert.match(layout,/moveOriginal\(nav,'button\[data-suite-target="friends"\]','Friends'/);
  assert.doesNotMatch(layout,/actionNav\('(Notes|Study Planner|Cloud Drive)'/);
  assert.match(home,/button\[data-suite-target="welcome"\]'\)\?\.remove\(\)/);
  assert.doesNotMatch(html,/Study Center/);
  assert.match(html,/<h1>Study Tools<\/h1>/);
  assert.match(html,/data-suite-target="agenda" title="Assignments"/);
  assert.match(html,/<h2>Assignments &amp; calendar<\/h2>/);
  assert.match(html,/data-suite="agenda" type="button">▦ Assignments<\/button>/);
});

test('sidebar displays every existing tool in one vertical column without a dropdown',()=>{
  for(const selector of [
    'button[data-suite-target="topic"]',
    'button[data-page="essay"]',
    'button[data-suite-target="learning"]',
    'button[data-page="saved"]',
    'button[data-suite-target="admin"]'
  ])assert.ok(layout.includes("moveOriginal(nav,'"+selector+"'"),selector+' is directly in the sidebar');
  assert.match(layout,/nav\.append\(actionNav\('Documents','notes','files'\)\)/);
  assert.match(layout,/nav\.append\(settings\)/);
  assert.match(layout,/groups\.forEach\(group=>\{/);
  assert.doesNotMatch(layout,/More tools|ssMoreNav|createElement\('details'\)/);
  assert.doesNotMatch(css,/\.ss-more-nav/);
  assert.match(css,/\.ss-primary-nav\{[\s\S]*?flex-direction:column/);
  assert.match(css,/\.ss-primary-nav button\[hidden\]\{display:none!important\}/);
});

test('five home cards have unique working targets, without duplicate shortcuts',()=>{
  const exposed=home.replace(/\}\)\(\);\s*$/,'window.__cards=specs;})();');
  assert.notEqual(exposed,home);
  const window={};
  vm.runInNewContext(exposed,{window,document:{readyState:'loading',addEventListener(){}},console});
  assert.deepEqual(Array.from(window.__cards.map(x=>x[0])),[
    'AI Tutor','Flashcards','Assignments','Documents','Friends'
  ]);
  assert.deepEqual(Array.from(window.__cards.map(x=>x[3])),[
    'answer','quiz','agenda','files','friends'
  ]);
  assert.match(layout,/\['tutor','cards','assignment','notes','friends'\]\[i\]/);
  assert.doesNotMatch(layout,/Take smarter notes with AI-powered summaries/);
  assert.match(css,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)!important/);
  assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/);
  assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
});

test('Documents still navigates to the saved file pane',()=>{
  const exposed=layout.replace(/\}\)\(\);\s*$/,'window.__navTo=navTo;})();');
  assert.notEqual(exposed,layout);
  const log=[];
  const mockDocument={
    readyState:'loading',
    addEventListener(){},
    querySelector(selector){
      if(selector.includes('[data-suite-target="files"]'))return null;
      if(selector.includes('[data-suite-target="agenda"]'))return {click(){log.push('page:suite')}};
      return null;
    }
  };
  const window={__KEEP_STUDYSYNCKSUITE__:{showPane:pane=>log.push('pane:'+pane)}};
  vm.runInNewContext(exposed,{window,document:mockDocument,console});
  window.__navTo('files');
  assert.deepEqual(log,['page:suite','pane:files']);
  log.length=0;
  window.__navTo('agenda');
  assert.deepEqual(log,['page:suite']);
});

test('search and the How to Use guide use canonical labels',()=>{
  assert.match(layout,/\['Assignments',\(\)=>navTo\('agenda'\)\],\['Documents',\(\)=>navTo\('files'\)\],\['Friends',\(\)=>navTo\('friends'\)\]/);
  assert.doesNotMatch(layout,/\['(Notes|Cloud Drive|Study Planner)',\(\)=>navTo\(/);
  assert.match(readme,/\*\*Documents\*\* to create notes and manage saved documents/);
  assert.match(readme,/\*\*Assignments\*\* to organize tasks, due dates, and study planning/);
  const a='<!-- STUDYSPIRE_GUIDE_START -->',b='<!-- STUDYSPIRE_GUIDE_END -->';
  const expected=readme.slice(readme.indexOf(a)+a.length,readme.indexOf(b)).trim();
  const match=guide.match(/const FALLBACK_GUIDE=("(?:\\.|[^"\\])*");/);
  assert.ok(match,'Offline Help guide must remain available');
  assert.equal(JSON.parse(match[1]),expected);
});

test('new UI assets are cache-busted without changing stored data formats',()=>{
  assert.match(html,/studyspire-home\.js\?v=3\.94/);
  assert.match(html,/studyspire-layout\.js\?v=3\.96/);
  assert.match(html,/studyspire-layout\.css\?v=3\.95/);
  assert.match(html,/help-guide\.js\?v=3\.94/);
  assert.match(home,/data\.assignments/);
  assert.match(home,/data\.docs/);
  assert.match(layout,/data-suite-target/);
  assert.doesNotMatch(home,/delete from|drop table/i);
  assert.doesNotThrow(()=>new Function(home));
  assert.doesNotThrow(()=>new Function(layout));
});