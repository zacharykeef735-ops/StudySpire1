'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const file=name=>fs.readFileSync(path.join(root,name),'utf8');
const html=file('index.html');
const guideCode=file('help-guide.js');
const readme=file('README.md');
const css=file('enhancements.css');
const START='<!-- STUDYSPIRE_GUIDE_START -->';
const END='<!-- STUDYSPIRE_GUIDE_END -->';

function harness(custom={}){
  const doc={
    readyState:'loading',
    addEventListener:()=>{},
    getElementById:()=>null,
    querySelector:()=>null,
    createElement:tag=>({
      tagName:tag.toUpperCase(),children:[],attributes:{},
      append(...nodes){this.children.push(...nodes)},
      setAttribute(k,v){this.attributes[k]=v},
      addEventListener:()=>{},
      insertAdjacentElement:()=>{},
      replaceChildren(...nodes){this.children=[...nodes]},
      textContent:'',innerHTML:''
    }),
    createTextNode:text=>({tagName:'#TEXT',textContent:text}),
    createDocumentFragment:()=>({tagName:'#FRAGMENT',children:[],append(...nodes){this.children.push(...nodes)}})
  };
  Object.assign(doc,custom.document||{});
  const win={};
  const exposed=guideCode.replace(/}\)\(\);\s*$/,'window.__helpTest={guideSection,renderGuide,installButton,writeInline,open,close};})();');
  assert.notEqual(exposed,guideCode);
  vm.runInNewContext(exposed,{document:doc,window:win,console,AbortController,URL,setTimeout,clearTimeout,fetch:async()=>{throw Error('offline')},...custom.context});
  return {doc,help:win.__helpTest};
}

test('README contains a full, clearly delimited in-app guide',()=>{
  assert.equal(readme.split(START).length,2);
  assert.equal(readme.split(END).length,2);
  assert.ok(readme.indexOf(START)<readme.indexOf(END));
  const guide=readme.slice(readme.indexOf(START)+START.length,readme.indexOf(END)).trim();
  for(const expected of ['## How to use StudySpire','### 1. Find your way around',
    '### 2. Ask the AI tutor','### 3. Make flashcards, notes, and plans',
    '### 4. Sign in and protect your work','### 5. Message friends and share flashcards',
    '### 6. Handy shortcuts and troubleshooting']){
    assert.ok(guide.includes(expected),'Missing '+expected);
  }
  const literal=guideCode.match(/const FALLBACK_GUIDE=("(?:\\.|[^"\\])*");/);
  assert.ok(literal,'Built-in offline guide missing');
  assert.equal(JSON.parse(literal[1]),guide,'Offline text and README must stay identical');
});

test('Help UI loads on every page without changing the existing dashboard',()=>{
  assert.doesNotThrow(()=>new Function(guideCode));
  assert.match(html,/help-guide\.js\?v=3\.94/);
  assert.match(html,/enhancements\.css\?v=3\.84/);
  assert.match(css,/#ssHelpTopButton/);
  assert.match(css,/#ssHelpOverlay\[hidden\]/);
  assert.match(guideCode,/aria-modal="true"/);
  assert.match(guideCode,/aria-labelledby="ssHelpTitle"/);
  assert.match(guideCode,/event\.key==='Escape'/);
  assert.match(guideCode,/event\.key!=='Tab'/);
  assert.match(guideCode,/returnFocus\.focus\(\{preventScroll:true\}\)/);
  assert.match(guideCode,/event\.target===overlay/);
  assert.match(guideCode,/new URL\('README\.md',document\.baseURI\)/);
  assert.doesNotMatch(guideCode,/innerHTML\s*=\s*fromReadme/);
});

test('guide extractor rejects missing or malformed markers',()=>{
  const {help}=harness();
  const out=help.guideSection(readme);
  assert.ok(out.startsWith('## How to use StudySpire'));
  assert.ok(out.includes('Mini'));
  assert.throws(()=>help.guideSection('## A fake guide'),/missing/);
  assert.throws(()=>help.guideSection(START+'## Wrong title'+END),/unexpected heading/);
});

test('rendered Markdown uses safe text content and semantic lists',()=>{
  const host={children:[],replaceChildren(...nodes){this.children=[...nodes]}};
  const {help}=harness({document:{getElementById:id=>id==='ssHelpBody'?host:null}});
  help.renderGuide('## How to use StudySpire\n\nWelcome!\n\n### Example\n1. **Bold** hello\n2. <img src=x onerror=alert(1)>\n\n- another item');
  assert.equal(host.children.length,1);
  const frag=host.children[0];
  assert.deepEqual(frag.children.map(n=>n.tagName),['P','H3','OL','UL']);
  const ol=frag.children[2];
  assert.equal(ol.children[0].children[0].tagName,'STRONG');
  const unsafe=ol.children[1].children[0];
  assert.equal(unsafe.textContent,'<img src=x onerror=alert(1)>');
  assert.equal(unsafe.tagName,'#TEXT');
});

test('Help button is placed beside the notification bell when available',()=>{
  let insertion=null;
  const topRight={querySelector:()=>({insertAdjacentElement:(where,element)=>insertion={where,element}})};
  const {help}=harness({document:{querySelector:selector=>selector==='.topbar .topright'?topRight:null}});
  help.installButton();
  assert.equal(insertion.where,'afterend');
  assert.equal(insertion.element.id,'ssHelpTopButton');
  assert.equal(insertion.element.attributes['aria-label'],'How to use StudySpire');
});

test('older site layout puts Help directly before the Settings control',()=>{
  let insertion=null;
  const topRight={querySelector:()=>null};
  const settings={parentElement:topRight,insertAdjacentElement:(where,element)=>insertion={where,element}};
  const {help}=harness({document:{
    querySelector:selector=>selector==='.topbar .topright'?topRight:null,
    getElementById:id=>id==='openSettings'?settings:null
  }});
  help.installButton();
  assert.equal(insertion.where,'beforebegin');
  assert.equal(insertion.element.id,'ssHelpTopButton');
});
