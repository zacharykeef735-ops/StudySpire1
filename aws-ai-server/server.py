"""StudySpire self-hosted tutor gateway: private Ollama, authenticated Supabase users."""
import asyncio, json, os, time
from collections import defaultdict, deque
import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

SUPABASE_URL=os.getenv("SUPABASE_URL","").rstrip("/")
KEY=os.getenv("SUPABASE_PUBLISHABLE_KEY","")
OLLAMA_URL=os.getenv("OLLAMA_URL","http://127.0.0.1:11434").rstrip("/")
MODEL=os.getenv("OLLAMA_MODEL","qwen2.5:3b")
ORIGINS=[s.strip().rstrip("/") for s in os.getenv("ALLOWED_ORIGINS","").split(",") if s.strip()]
PER_HOUR=max(1,int(os.getenv("REQUESTS_PER_HOUR","30")))
MAX_TOKENS=min(1024,max(64,int(os.getenv("MAX_OUTPUT_TOKENS","384"))))
if not (SUPABASE_URL.startswith("https://") and KEY and ORIGINS):
    raise RuntimeError("Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and ALLOWED_ORIGINS")
if not OLLAMA_URL.startswith("http://127.0.0.1:"):
    raise RuntimeError("Ollama must be restricted to 127.0.0.1")
app=FastAPI(title="StudySpire AI",docs_url=None,redoc_url=None,openapi_url=None)
app.add_middleware(CORSMiddleware,allow_origins=ORIGINS,allow_methods=["GET","POST","OPTIONS"],allow_headers=["Authorization","Content-Type"],allow_credentials=False)
limits=defaultdict(deque)
slots=asyncio.Semaphore(2)

class Message(BaseModel):
    role: str
    content: str = Field(max_length=12000)
class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1,max_length=12)
    max_tokens: int = Field(default=256,ge=1,le=1024)

@app.get("/health")
async def health():
    return {"ok":True,"service":"studyspire-ai"}

@app.post("/v1/chat")
async def chat(request:Request,data:ChatRequest,authorization:str|None=Header(default=None)):
    origin=request.headers.get("origin")
    if origin not in ORIGINS: raise HTTPException(403,"Origin not allowed")
    if not authorization or not authorization.startswith("Bearer "):raise HTTPException(401,"Sign in to StudySpire Cloud")
    token=authorization[7:].strip()
    if not token or len(token)>8192:raise HTTPException(401,"Invalid token")
    headers={"Authorization":"Bearer "+token,"apikey":KEY}
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            resp=await client.get(SUPABASE_URL+"/auth/v1/user",headers=headers)
            if resp.status_code!=200:raise HTTPException(401,"Cloud sign-in expired")
            user=resp.json()
            uid=user.get("id")
            if not isinstance(uid,str) or not uid:raise HTTPException(401,"Invalid account")
            status=await client.post(SUPABASE_URL+"/rest/v1/rpc/ss_ai_status",headers={**headers,"Content-Type":"application/json"},json={})
            if not status.is_success or not isinstance(status.json(),dict) or not status.json().get("profile_id"):
                raise HTTPException(403,"Active StudySpire profile required")
    except httpx.HTTPError as exc:raise HTTPException(503,"Authentication service unavailable") from exc
    messages=[{"role":m.role,"content":m.content} for m in data.messages]
    if any(m["role"] not in ("user","assistant") for m in messages) or messages[-1]["role"]!="user":
        raise HTTPException(400,"Invalid conversation")
    if sum(len(m["content"]) for m in messages)>9000:
        raise HTTPException(413,"Conversation too long")
    now=time.monotonic()
    recent=limits[uid]
    while recent and recent[0]<now-3600:recent.popleft()
    if len(recent)>=PER_HOUR:raise HTTPException(429,"Hourly AI limit reached")
    # Verified per-student and shared quotas, reserved atomically in Supabase.
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            claim=await client.post(SUPABASE_URL+"/rest/v1/rpc/ss_ai_claim_mine",headers={**headers,"Content-Type":"application/json"},json={})
            if not claim.is_success:raise HTTPException(503,"Unable to verify AI quota")
            record=claim.json()
            if not isinstance(record,dict) or not record.get("ok"):
                raise HTTPException(429,"Daily AI quota reached")
    except httpx.HTTPError as exc:raise HTTPException(503,"AI quota service unavailable") from exc
    recent.append(now)
    async def events():
        async with slots:
            try:
                timeout=httpx.Timeout(connect=8,read=135,write=15,pool=15)
                async with httpx.AsyncClient(timeout=timeout) as client:
                    async with client.stream("POST",OLLAMA_URL+"/api/chat",json={
                        "model":MODEL,
                        "messages":[{"role":"system","content":"You are StudySpire, a patient tutor for school students. Teach methods and reasoning. For homework offer a hint and ask the student to try the next step rather than supplying a submission-ready answer. Use a different worked example. Be accurate, age-appropriate and concise; do not invent citations."},*messages],
                        "stream":True,"keep_alive":"5m",
                        "options":{"temperature":0.35,"num_predict":min(data.max_tokens,MAX_TOKENS)}
                    }) as upstream:
                        upstream.raise_for_status()
                        async for line in upstream.aiter_lines():
                            if await request.is_disconnected():break
                            if not line:continue
                            item=json.loads(line)
                            delta=str(item.get("message",{}).get("content") or "")
                            if delta:yield "data: "+json.dumps({"delta":delta})+"\n\n"
                            if item.get("done"):break
                yield 'data: {"done":true}\n\n'
            except (httpx.HTTPError,ValueError,KeyError,TypeError):
                yield 'data: {"error":"AI server unavailable; check Ollama service and logs"}\n\n'
    return StreamingResponse(events(),media_type="text/event-stream",headers={
        "Cache-Control":"no-store, no-cache, must-revalidate",
        "X-Accel-Buffering":"no","X-Content-Type-Options":"nosniff"})
