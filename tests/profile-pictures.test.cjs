'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=pathName=>fs.readFileSync(path.join(root,pathName),'utf8');
const sql=read('profile-picture-moderation-migration.sql');
const cloud=read('cloud.js'),avatars=read('avatars.js'),css=read('avatars.css');
const messaging=read('messaging.js'),layout=read('studyspire-layout.js'),html=read('index.html');

test('new profile picture assets load after account, messaging, and layout code',()=>{
  assert.match(html,/href="avatars\.css\?v=3\.92"/);
  assert.match(html,/src="avatars\.js\?v=3\.94"/);
  assert.ok(html.indexOf('src="avatars.js?v=3.94"')>html.indexOf('src="studyspire-layout.js?v=3.96"'));
  assert.doesNotThrow(()=>new Function(avatars));
  assert.doesNotThrow(()=>new Function(cloud));
  assert.doesNotThrow(()=>new Function(messaging));
  assert.doesNotThrow(()=>new Function(layout));
});

test('SQL profiles have private avatar storage, no browser table grants, and signed-in RPCs',()=>{
  assert.match(sql,/avatar_upload_restricted boolean not null default false/);
  assert.match(sql,/ss_private\.ss_profile_avatars/);
  assert.match(sql,/ss_private\.ss_profile_avatar_reports/);
  assert.match(sql,/ss_profile_avatars enable row level security/);
  assert.match(sql,/ss_profile_avatar_reports enable row level security/);
  assert.match(sql,/revoke all on ss_private\.ss_profile_avatars,ss_private\.ss_profile_avatar_reports/);
  assert.match(sql,/revoke all on function[\s\S]+from public,anon,authenticated;/);
  assert.match(sql,/grant execute on function[\s\S]+to authenticated;/);
  for(const operation of ['ss_avatar_me','ss_avatar_set','ss_avatar_public',
    'ss_avatar_list','ss_avatar_report','ss_avatar_staff_overview',
    'ss_avatar_staff_restrict','ss_avatar_staff_review']){
    assert.ok(sql.includes('public.'+operation+'('),operation+' missing');
  }
});

test('server validates account identity, picture format and upload restrictions',()=>{
  assert.match(sql,/public\.ss_current_profile_id\(\)/);
  assert.match(sql,/if blocked then raise exception/);
  assert.match(sql,/char_length\(p_image_data\)>95000/);
  assert.match(sql,/image\/webp;base64/);
  assert.match(sql,/pg_catalog\.decode\(/);
  assert.match(sql,/octet_length\(data_bytes\)>65536/);
  assert.match(sql,/avatar_revision=p\.avatar_revision\+1/);
  assert.match(sql,/Banned accounts cannot change profile pictures/);
  assert.match(sql,/if p_image_data is null or p_image_data=''/);
});

test('picture reports are signed in, limited, non-self, and store a review snapshot',()=>{
  assert.match(sql,/constraint ss_avatar_no_self_report/);
  assert.match(sql,/constraint ss_avatar_report_once/);
  assert.match(sql,/Daily picture report limit reached/);
  assert.match(sql,/if target=actor then raise exception/);
  assert.match(sql,/image_snapshot/);
  assert.match(sql,/image_snapshot=null/);
  assert.match(sql,/Profile picture report reviewed/);
});

test('role checks enforce Moderator vs Admin vs Owner actions in the backend',()=>{
  const staff=sql.slice(sql.indexOf('create or replace function public.ss_avatar_staff_restrict'));
  assert.match(staff,/actor_role not in \('owner','admin'\)/);
  assert.match(staff,/actor_role='admin' and target_role not in \('student','moderator'\)/);
  assert.match(staff,/actor_role='moderator' and target_role<>'student'/);
  assert.match(staff,/current_revision<>reported_revision/);
  assert.match(staff,/decision not in \('dismiss','remove'\)/);
  assert.match(staff,/insert into public\.ss_admin_audit/);
});

test('browser forwards avatar actions only through the Cloud allowlist',()=>{
  assert.match(cloud,/window\.StudySpireAvatarBridge=/);
  assert.match(cloud,/if\(!AVATAR_ALLOWED\.has\(name\)\)throw Error/);
  assert.match(cloud,/if\(!live\|\|!person\|\|!profile\|\|banned\(profile\)\)/);
  assert.match(cloud,/ssCloudAvatarEdit/);
  assert.match(cloud,/StudySpireAvatars\?\.mountStaff\(modal\)/);
  assert.match(avatars,/new Image\(\)/);
  assert.match(avatars,/canvas\.toDataURL\('image\/webp'/);
  assert.match(avatars,/file\.size>4\*1024\*1024/);
  assert.match(avatars,/image\/jpeg','image\/png','image\/webp/);
  assert.doesNotMatch(avatars,/service_role|sb_secret_/i);
});

test('logged-in users can view and report from messaging and staff can review and restrict',()=>{
  assert.match(messaging,/View \/ report picture/);
  assert.match(messaging,/window\.StudySpireAvatars\?\.openProfile/);
  assert.match(layout,/window\.StudySpireAvatars\?\.decorate\(avatar,friend\.username\)/);
  assert.match(avatars,/ss_avatar_report/);
  assert.match(avatars,/ss_avatar_staff_review/);
  assert.match(avatars,/ss_avatar_staff_restrict/);
  assert.match(avatars,/Report this profile picture/);
  assert.match(avatars,/Report picture/);
  assert.match(avatars,/Profile pictures/);
  assert.match(avatars,/window\.StudySpireAvatars=\{openOwn,openProfile,decorate,decorateMany,mountStaff,refreshOwn\}/);
  assert.match(css,/#ssAvatarOverlay\[hidden\]/);
});

test('photo validator refuses external and non-image URL schemes',async()=>{
  const altered=avatars.replace(/\}\)\(\);\s*$/,'window.__avatarTest={validImage,readImage};})();');
  assert.notEqual(altered,avatars);
  const sandbox={window:{},document:{readyState:'loading',addEventListener(){}},console};
  vm.runInNewContext(altered,sandbox);
  const {validImage,readImage}=sandbox.window.__avatarTest;
  assert.equal(validImage('https://example.org/picture.webp'),null);
  assert.equal(validImage('javascript:alert(1)'),null);
  assert.equal(validImage('data:image/svg+xml,<svg></svg>'),null);
  assert.equal(validImage('data:image/webp;base64,ABCD'), 'data:image/webp;base64,ABCD');
  await assert.rejects(()=>readImage({type:'image/svg+xml',size:120}),/JPG, PNG, or WebP/);
  await assert.rejects(()=>readImage({type:'image/png',size:6000000}),/smaller than 4 MB/);
});
