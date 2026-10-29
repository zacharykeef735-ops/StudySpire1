import {STUDY_GUIDES, matchStudyTopic, formatStudyGuide} from './studyspire-guide-catalog.mjs';

// Common concepts are answered by curated study guides before hosted AI.
// The request contains ONLY a public topic slug; no private question or account data.
function guideWorkerUrl() {
  const configured=String(window.STUDY_SUMMIT_CLOUD?.guideWorkerUrl||'').trim().replace(/\/+$/,'');
  if(!configured)return '';
  try{
    const url=new URL(configured);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)return '';
    return url.origin+url.pathname.replace(/\/+$/,'');
  }catch(_){return '';}
}
function topicFromMessages(messages) {
  if(!Array.isArray(messages))return null;
  const userTurns=messages.filter(m=>m?.role==='user');
  if(userTurns.length!==1 || typeof userTurns[0].content!=='string')return null;
  return matchStudyTopic(userTurns[0].content);
}
async function getGuide(messages) {
  const topic=topicFromMessages(messages);
  if(!topic||!STUDY_GUIDES[topic])return null;
  let guide=STUDY_GUIDES[topic];
  let origin='Built-in study guide';
  const root=guideWorkerUrl();
  if(root){
    // Strictly whitelist topic identifiers. No student question text, user ID,
    // credentials, cookies, or session tokens are transmitted to the Worker.
    try{
      const url=new URL(root+'/v1/guide');
      url.searchParams.set('topic',topic);
      const response=await fetch(url.toString(),{
        method:'GET',credentials:'omit',referrerPolicy:'no-referrer',
        signal:AbortSignal.timeout(2500)
      });
      if(response.ok){
        const result=await response.json();
        if(result?.topic===topic&&result?.source==='studyspire-reviewed-guide'&&
           result.guide&&['title','hint','example','question'].every(k=>typeof result.guide[k]==='string'&&result.guide[k].length<1000)){
          guide=result.guide;
          origin='Cloudflare study guide';
        }
      }
    }catch(_){/* Public Worker unreachable: use the same reviewed local guide. */}
  }
  return {text:formatStudyGuide(guide),provider:origin+' · 0 AI neurons',topic};
}
window.StudySpireStudyGuides=Object.freeze({
  getGuide,
  topicFromMessages,
  workerConfigured:()=>Boolean(guideWorkerUrl())
});
