'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=n=>fs.readFileSync(path.join(__dirname,'..',n),'utf8');
const html=read('index.html'),roles=read('verified-roles.js');
const cloud=read('cloud.js'),avatars=read('avatars.js'),messages=read('messaging.js');
const accountSql=read('account-profiles-and-expiry-migration.sql');
const filterSql=read('message-language-filter-migration.sql');
const fixSql=read('message-filter-v395-fix.sql');
const styles=read('community-polish.css');

test('role titles are loaded from read-only verified public RPCs',()=>{
  assert.match(accountSql,/function public\.ss_public_profile\(chosen_username text\)/);
  assert.match(accountSql,/function public\.ss_public_titles\(chosen_usernames text\[\]\)/);
  assert.match(accountSql,/select pg_catalog\.jsonb_build_object\('username',p\.username,'role',p\.role,'bio',p\.bio\)/);
  assert.match(accountSql,/grant execute on function public\.ss_public_profile\(text\),public\.ss_public_titles\(text\[\]\)\s+to anon,authenticated/);
  assert.match(cloud,/const PUBLIC_PROFILE_ALLOWED=new Set\(\['ss_public_profile','ss_public_titles'\]\)/);
  assert.match(roles,/const staffRoles=new Set\(\['owner','co_owner','admin','moderator'\]\)/);
  assert.match(messages,/StudySpireRoles\?\.decorateLabel/);
  assert.match(avatars,/StudySpireRoles\?\.decorateLabel/);
});

test('verified badges render even when a friend row is not yet in the DOM',()=>{
  const added=[];
  const label={isConnected:false,querySelector:()=>null,append:item=>added.push(item)};
  const browser={
    window:{
      addEventListener(){},
      StudySpireAvatarBridge:{state:()=>({username:'staff_test',role:'owner'})}
    },
    document:{createElement:tag=>({tagName:tag,attributes:{},setAttribute(name,value){this.attributes[name]=value}})},
    console
  };
  vm.runInNewContext(roles,browser);
  browser.window.StudySpireRoles.decorateLabel(label,'staff_test','owner');
  assert.equal(added.length,1);
  assert.match(added[0].className,/role-owner/);
  assert.match(added[0].textContent,/Owner/);
  assert.match(added[0].attributes['aria-label'],/Verified/);
});

test('bio editing belongs to authenticated accounts and is displayed to other users',()=>{
  assert.match(accountSql,/add column if not exists bio text not null default '' check \(char_length\(bio\)<=180\)/);
  assert.match(accountSql,/ss_profile_set_bio\(new_bio text\)/);
  assert.match(accountSql,/public\.ss_current_profile_id\(\)/);
  assert.match(accountSql,/public\.ss_can_use\(\)/);
  assert.match(accountSql,/Please remove inappropriate language from your bio/);
  assert.match(avatars,/Profile picture|Your profile & bio/);
  assert.match(avatars,/maxLength=180/);
  assert.match(avatars,/ss_profile_set_bio/);
  assert.match(avatars,/No bio yet/);
});

test('account deletion is username, password and confirmation gated',()=>{
  for(const id of ['ssc-deleteUsername','ssc-deletePassword','ssc-deletePhrase','ssc-deleteAccount']){
    assert.match(cloud,new RegExp(id));
  }
  assert.match(cloud,/phrase!=='DELETE'/);
  assert.match(cloud,/ss_delete_my_account/);
  assert.match(accountSql,/extensions\.crypt\(confirmed_password,pw_hash\)/);
  assert.match(accountSql,/The final Owner cannot delete their account/);
  assert.match(accountSql,/delete from public\.ss_profiles where id=actor/);
  assert.match(accountSql,/delete from auth\.users where id=actor/);
  assert.match(accountSql,/to authenticated;/);
  assert.doesNotMatch(accountSql,/grant execute on function public\.ss_delete_my_account\(text,text\)\s+to anon/);
});

test('permanent bans have a 30 day waiting period and Owner protection',()=>{
  assert.match(accountSql,/add column if not exists perma_banned_at timestamptz/);
  assert.match(accountSql,/create trigger ss_track_permanent_ban/);
  assert.match(accountSql,/perma_banned_at<=now\(\)-interval '30 days'/);
  assert.match(accountSql,/and p\.role<>'owner'/);
  assert.match(accountSql,/for update skip locked/);
  assert.match(cloud,/perma_banned_at/);
  assert.match(cloud,/automatic deletion after/);
});

test('blocked language never marks a rejected chat as delivered',()=>{
  const start=messages.indexOf("const sentId=await rpc('ss_social_send'");
  assert.ok(start>0);
  const rejected=messages.indexOf('if(!sentId)throw Error(',start);
  const cleared=messages.indexOf("$('sdFriendMessage').value=''",start);
  assert.ok(rejected>start&&cleared>rejected);
  assert.match(filterSql,/insert into ss_private\.ss_chat_language_flags/);
  assert.match(filterSql,/return null;\s+end if;/);
  assert.match(filterSql,/ss_private\.ss_chat_language_violation\(clean\)/);
  assert.match(fixSql,/create or replace function public\.ss_chat_language_check/);
  assert.match(fixSql,/grant execute on function public\.ss_chat_language_check\(text\) to authenticated/);
});

test('Mini exposes a typing field above the switcher and autosaves titles',()=>{
  const a=html.indexOf('id="sdNotesTitle"'),b=html.indexOf('id="sdNotesList"');
  assert.ok(a>0&&b>a);
  assert.match(html,/Note name — type to rename/);
  assert.match(html,/id="sdNotesTitle"[^>]*type="text"/);
  assert.match(html,/note\.title=title\.value\.slice\(0,120\)/);
  assert.match(html,/notesTab\.onclick=\(\)=>\{setMode\('notes'\);setTimeout\(\(\)=>title\.focus\(\),0\)\}/);
});

test('sidebar minimizes on desktop and opens on tablet and mobile',()=>{
  assert.match(styles,/@media\(min-width:901px\)/);
  assert.match(styles,/\.app\.sd-sidebar-collapsed/);
  assert.match(styles,/grid-template-columns:80px minmax\(0,1fr\)!important/);
  assert.match(styles,/@media\(min-width:761px\) and \(max-width:900px\)/);
  assert.match(styles,/\.app\.sd-mobile-open \.sidebar/);
  assert.match(html,/matchMedia\('\(max-width:900px\)'\)/);
  assert.match(html,/sd-sidebar-collapsed-v1/);
});
