'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','enhancements.js'),'utf8');
const layout=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','enhancements.css'),'utf8');
function harness(stored='25'){
 const values=new Map([['account::studydock-quick-focus-minutes-v1',stored]]);
 const display={textContent:''},homeClock={textContent:''},note={textContent:''};
 const elements={
  ssupClock:display,ssupStart:{textContent:'',disabled:false},
  ssupLength:{value:'25',disabled:false},
  ssupCustomMinutes:{value:'25',disabled:false,setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},focus(){}},
  ssupCustomField:{hidden:true},
  ssupFocusNote:note,
  ssHomeFocusOpen:{querySelector:()=>homeClock}
 };
 const document={readyState:'loading',addEventListener(){},getElementById:id=>elements[id]||null};
 const localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v))};
 const window={sdAccountKey:k=>'account::'+k};
 const source=code.replace(/\}\)\(\);\s*$/, 'window.__focus={validFocusMinutes,storedFocusMinutes,resetTimer,clock,selectFocusLength,startPause,pause,syncFocusFields};})();');
 assert.notEqual(source,code);
 vm.runInNewContext(source,{window,document,localStorage,console,Date,Number,String,Object,Array,Math,JSON,setInterval,clearInterval,setTimeout,clearTimeout});
 return {elements,values,api:window.__focus};
}
test('quick focus accepts valid custom minutes and rejects invalid durations',()=>{
 const {api,elements,values}=harness('25');
 for(const invalid of ['',0,-2,181,1.5,'nope'])assert.equal(api.validFocusMinutes(invalid),null);
 for(const good of [1,15,25,45,75,180])assert.equal(api.validFocusMinutes(good),good);
 elements.ssupLength.value='custom';elements.ssupCustomMinutes.value='75';api.selectFocusLength();
 assert.equal(elements.ssupCustomField.hidden,false);
 assert.equal(elements.ssupClock.textContent,'75:00');
 assert.equal(elements.ssupFocusNote.textContent,'Ready for 75 minutes. Sessions count when finished.');
 assert.equal(values.get('account::studydock-quick-focus-minutes-v1'),'75');
 elements.ssupCustomMinutes.value='200';api.resetTimer();
 assert.equal(elements.ssupClock.textContent,'75:00');
 assert.equal(elements.ssupCustomMinutes['aria-invalid'],'true');
 elements.ssupCustomMinutes.value='60';api.resetTimer();
 assert.equal(elements.ssupCustomMinutes['aria-invalid'],undefined);
 assert.equal(elements.ssupClock.textContent,'60:00');
 assert.equal(elements.ssHomeFocusOpen.querySelector().textContent,'60:00');
});
test('saved duration is restored and controls lock while timer is running',()=>{
 const {api,elements}=harness('95');
 api.syncFocusFields();api.clock();
 assert.equal(api.storedFocusMinutes(),95);
 assert.equal(elements.ssupLength.value,'custom');
 assert.equal(elements.ssupCustomMinutes.value,'95');
 assert.equal(elements.ssupClock.textContent,'95:00');
 api.startPause();
 assert.equal(elements.ssupLength.disabled,true);
 assert.equal(elements.ssupCustomMinutes.disabled,true);
 api.pause();
 assert.equal(elements.ssupLength.disabled,false);
 assert.equal(elements.ssupCustomMinutes.disabled,false);
});
test('custom timer UI and cache-busting assets are present',()=>{
 assert.match(code,/id="ssupCustomMinutes"/);
 assert.match(code,/value="custom">Custom time/);
 assert.match(css,/\.ssup-custom-duration\[hidden\]/);
 assert.match(layout,/enhancements\.js\?v=3\.81/);
 assert.match(layout,/enhancements\.css\?v=3\.84/);
});
