const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=name=>fs.readFileSync(require('node:path').join(__dirname,'..',name),'utf8');
test('planner scripts are wired into the app',()=>{
 const html=read('index.html');
 assert.match(html,/studyspire-planner\.js\?v=1/);
 assert.match(html,/studyspire-planner\.css\?v=1/);
 const css=read('studyspire-planner.css');
 assert.match(css,/@media\(max-width:700px\)/);
});
test('planner parses and exposes the launcher without a DOM session',()=>{
 const context={window:{},document:{readyState:'loading',addEventListener(){}}};
 vm.runInNewContext(read('studyspire-planner.js'),context,{timeout:1000});
 assert.equal(typeof context.window.StudySpirePlanner.open,'function');
});
test('planner backup, calendar, priority, and review operations exist',()=>{
 const js=read('studyspire-planner.js');
 for(const marker of ['function exportCalendar(', 'function renderInsights(', 'function renderReview(', 'function rank(', 'function validate(', 'function renderBackup('])
 assert.ok(js.includes(marker),'Missing '+marker);
 assert.match(js,/\.slice\(0,500\)/);
 assert.match(js,/function importExistingTasks\(/);
 assert.match(js,/function importExistingCards\(/);
});
test('school classroom is installed only here, with guarded RPCs',()=>{
 const html=read('index.html');
 assert.match(html,/school-classroom\.js\?v=1/);
 assert.match(html,/school-classroom\.css\?v=1/);
 const bridge=read('cloud.js');
 for(const name of ['ss_school_classroom','ss_school_class_enroll','ss_school_create_assignment','ss_school_submit_assignment','ss_school_grade_assignment','ss_school_post_announcement'])
 assert.ok(bridge.includes(name),'Missing RPC '+name);
 const js=read('school-classroom.js');
 const context={window:{},document:{readyState:'loading',addEventListener(){}}};
 vm.runInNewContext(js,context,{timeout:1000});
 assert.equal(typeof context.window.StudySpireClassroom.open,'function');
});
test('school SQL isolates its tables and guards role operations',()=>{
 const sql=read('studyspire1-academics.sql');
 for(const table of ['ss_school_class_enrollments','ss_school_assignments','ss_school_submissions','ss_school_class_announcements'])
 assert.ok(sql.includes('alter table public.'+table+' enable row level security'));
 assert.match(sql,/revoke all on public\.ss_school_class_enrollments/);
 assert.match(sql,/not public\.ss_school_class_can_submit\(cid\)/);
 assert.match(sql,/not public\.ss_school_class_can_teach\(cid\)/);
 assert.match(sql,/Only the school principal or platform Owner/);
 assert.doesNotMatch(sql,/grant select on public\.ss_school_/i);
});
