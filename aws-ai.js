/* Optional StudySpire self-hosted AWS AI — existing Cloudflare + browser paths remain intact. */
(()=>{'use strict';
const KEY='studyspire-aws-ai-mode-v1';
function origin(){try{const u=new URL(String(window.STUDYSPIRE_AWS_AI?.url||''));return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'?u.origin:null}catch{return null}}
function enabled(){try{return localStorage.getItem(KEY)==='aws'&&!!origin()}catch{return false}}
async function ask(messages,maxTokens,onChunk,token){
 const url=origin();if(!url)throw Error('AWS AI endpoint is not configured.');
 if(!token)throw Error('Sign in to StudySpire Cloud first.');
 const ms=[];for(const m of (Array.isArray(messages)?messages:[]).slice(-12)){
  if(!m||!['user','assistant'].includes(m.role))continue;
  let c=m.content;if(Array.isArray(c)){if(c.some(p=>p?.type!=='text'))throw Error('AWS AI accepts text only.');c=c.map(p=>String(p?.text||'')).join('\n')}
  if(typeof c==='string')ms.push({role:m.role,content:c.slice(0,2500)});
 }
 if(!ms.length||ms.at(-1).role!=='user'||ms.reduce((s,m)=>s+m.content.length,0)>9000)throw Error('Please enter a shorter study question.');
 const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),135000);
 try{
  const res=await fetch(url+'/v1/chat',{method:'POST',mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({messages:ms,max_tokens:Math.max(90,Math.min(450,Number(maxTokens)||220))}),signal:ctrl.signal});
  if(!res.ok){const e=await res.json().catch(()=>null);throw Error(typeof e?.detail==='string'?e.detail:'AWS AI error HTTP '+res.status)}
  if(!res.body||!String(res.headers.get('content-type')||'').includes('text/event-stream'))throw Error('AWS AI did not stream a response.');
  const reader=res.body.getReader(),decode=new TextDecoder();let pending='',answer='',finished=false;
  const accept=line=>{if(!line.startsWith('data:'))return;let data;try{data=JSON.parse(line.slice(5).trim())}catch{return}
   if(data.error)throw Error(String(data.error).slice(0,160));if(data.done){finished=true;return}
   if(typeof data.delta==='string'){answer+=data.delta;if(answer.length>11000)throw Error('Response too long');if(typeof onChunk==='function')onChunk(answer)}};
  try{while(!finished){const {value,done}=await reader.read();if(done)break;pending+=decode.decode(value,{stream:true});if(pending.length>14000)throw Error('Invalid stream');
   const lines=pending.split(/\r?\n/);pending=lines.pop()||'';for(const line of lines)accept(line)}
   if(pending.trim())accept(pending);
  }finally{try{await reader.cancel()}catch{}reader.releaseLock()}
  if(!answer.trim())throw Error('AWS AI returned no answer. Try browser AI.');
  window.StudySpireTutorLastProvider='AWS self-hosted AI';return answer.trim();
 }catch(e){if(e?.name==='AbortError')throw Error('AWS AI timed out. Try browser AI.');throw e}finally{clearTimeout(timeout)}
}
window.StudySpireAWSAI={enabled,ask,configured:()=>!!origin()};
function mount(){
 const pane=document.getElementById('ssPanelAI');if(!pane||document.getElementById('ssAwsAiSelect'))return;
 const box=document.createElement('section');box.style.cssText='border:1px solid var(--line,#38415e);border-radius:12px;padding:14px;margin:15px 0;background:var(--surface2,#1b2536)';
 const title=document.createElement('h3');title.textContent='☁ AWS AI (optional)';title.style.fontSize='14px';
 const hint=document.createElement('p');hint.className='hint';hint.textContent='Use your own AWS Ollama server for tutoring. Requires StudySpire Cloud sign-in. Browser AI and Cloudflare remain available when AWS is off.';
 const label=document.createElement('label');label.className='label';label.htmlFor='ssAwsAiSelect';label.textContent='Tutor provider';
 const sel=document.createElement('select');sel.id='ssAwsAiSelect';sel.className='field';
 for(const [v,t] of [['off','Existing hosted tutor / browser AI'],['aws','AWS self-hosted AI']]){const opt=document.createElement('option');opt.value=v;opt.textContent=t;sel.append(opt)}
 try{sel.value=localStorage.getItem(KEY)==='aws'?'aws':'off'}catch{sel.value='off'}
 const status=document.createElement('p');status.className='hint';status.setAttribute('role','status');
 const update=()=>{if(sel.value==='aws'&&!origin()){sel.value='off';try{localStorage.setItem(KEY,'off')}catch{}}status.textContent=origin()?'AWS server configured: '+new URL(origin()).hostname+'. AWS charges may apply.':'AWS AI not configured. An administrator must set STUDYSPIRE_AWS_AI_URL in Amplify.'};
 sel.addEventListener('change',()=>{try{localStorage.setItem(KEY,sel.value)}catch{}update()});
 box.append(title,hint,label,sel,status);pane.append(box);update();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
