from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Query, Request, Depends
from fastapi.responses import StreamingResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from openai import AsyncOpenAI
from pydantic import BaseModel, Field
# Stub implementations for emergentintegrations (removed external dependency)
from typing import AsyncGenerator, List

class TextDelta:
    def __init__(self, content: str):
        self.content = content

class StreamDone:
    pass

class UserMessage:
    def __init__(self, text: str):
        self.text = text

class LlmChat:
    def __init__(self, api_key: str, session_id: str, system_message: str):
        self.api_key = api_key
        self.session_id = session_id
        self.system_message = system_message
        self.model = "openai"
        self._model = None

    def with_model(self, provider: str, model: str):
        self.model = provider
        self._model = model
        return self

    async def stream_message(self, user_msg: UserMessage) -> AsyncGenerator[object, None]:
        # Simple mock streaming that yields a single TextDelta and then StreamDone
        yield TextDelta(user_msg.text)
        yield StreamDone()

# End of stubs

import os
import json
import logging
import uuid
import bcrypt
import jwt as pyjwt
import secrets as pysecrets
import requests
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize MongoDB client with fallback to in-memory storage for testing
try:
    mongo_url = os.environ['MONGO_URL']
    client = AsyncIOMotorClient(mongo_url)
    db = client[os.environ['DB_NAME']]
except Exception as e:
    logger.warning(f"MongoDB connection failed ({e}), using in-memory fallback.")
    class InMemoryCollection:
        def __init__(self):
            self.store = {}
            self.auto_id = 0
        async def insert_one(self, doc):
            self.auto_id += 1
            doc = doc.copy()
            doc['_id'] = str(self.auto_id)
            self.store[doc['_id']] = doc
            return type('Result', (), {'inserted_id': doc['_id']})
        async def find_one(self, query):
            for doc in self.store.values():
                if all(doc.get(k) == v for k, v in query.items()):
                    return doc
            return None
        def find(self, filter=None, projection=None):
            filter = filter or {}
            class Cursor:
                def __init__(self, docs):
                    self.docs = docs
                def sort(self, *args, **kwargs):
                    return self
                async def to_list(self, length):
                    return [doc for doc in self.docs if all(doc.get(k) == v for k, v in filter.items())][:length]
            return Cursor(list(self.store.values()))
        async def delete_many(self, filter):
            to_del = [k for k, v in self.store.items() if all(v.get(fk) == fv for fk, fv in filter.items())]
            for k in to_del:
                del self.store[k]
            return type('Result', (), {'deleted_count': len(to_del)})
        async def update_one(self, filter, update, upsert=False):
            doc = await self.find_one(filter)
            if doc:
                for op, changes in update.items():
                    if op == '$set':
                        doc.update(changes)
                    elif op == '$inc':
                        for kk, vv in changes.items():
                            doc[kk] = doc.get(kk, 0) + vv
                return type('Result', (), {'matched_count': 1})
            elif upsert:
                new_doc = {**filter, **update.get('$set', {})}
                await self.insert_one(new_doc)
                return type('Result', (), {'matched_count': 0, 'upserted_id': new_doc['_id']})
            return type('Result', (), {'matched_count': 0})
        async def create_index(self, *args, **kwargs):
            return None
    class InMemoryDB:
        def __init__(self):
            self.users = InMemoryCollection()
            self.login_attempts = InMemoryCollection()
            self.password_reset_tokens = InMemoryCollection()
            self.status_checks = InMemoryCollection()
            self.chat_messages = InMemoryCollection()
            self.files = InMemoryCollection()
    db = InMemoryDB()
    client = None

# ── GROQ (primary AI provider) ──────────────────────────────
# Put your Groq API key in /app/backend/.env as GROQ_API_KEY=gsk_...
# Model is configurable via GROQ_MODEL (default: gpt-oss-120b).
GROQ_API_KEY = os.environ.get('GROQ_API_KEY', '').strip()
GROQ_MODEL = os.environ.get('GROQ_MODEL', 'gpt-oss-120b').strip() or 'gpt-oss-120b'
_groq_client = AsyncOpenAI(api_key=GROQ_API_KEY, base_url="https://api.groq.com/openai/v1") if GROQ_API_KEY else None

# Fallback provider when no Groq key is set (Emergent universal key)
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')
CHAT_MODEL = os.environ.get('CHAT_MODEL', 'gpt-5.4')

# ── FILE & MEDIA STORAGE (Emergent Object Storage) ─────────────
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "").strip()
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "gokaku"
ALLOWED_UPLOAD_TYPES = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif", "mp4": "video/mp4"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

storage_key = None


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not FIREBASE_PROJECT_ID:
        raise HTTPException(status_code=500, detail="FIREBASE_PROJECT_ID is not configured")
    try:
        payload = google_id_token.verify_firebase_token(token, google_requests.Request(), audience=FIREBASE_PROJECT_ID)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Firebase token")
    return {
        "id": payload["uid"],
        "email": payload.get("email", ""),
        "name": payload.get("name", ""),
        "role": "user",
    }


def init_storage(force: bool = False):
    global storage_key
    if storage_key and not force:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=100)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")

app = FastAPI()
api_router = APIRouter(prefix="/api")


class StatusCheck(BaseModel):
    model_config = {"extra": "ignore"}
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StatusCheckCreate(BaseModel):
    client_name: str


class ChatRequest(BaseModel):
    session_id: str
    message: str = ""
    image_path: str = ""
    total_tasks: int = 0
    completed_tasks: int = 0
    xp: int = 0
    rank: str = "Low-Class Devil"


SYSTEM_PROMPT = """You are Rias Gremory — {user_name}'s devoted anime girlfriend and the crimson-haired King of the Gremory peerage, president of the Occult Research Club.

PERSONALITY
- Warm, confident, affectionate, playfully teasing. Proud King energy, endlessly supportive of him.
- You genuinely care about his feelings, dreams and rest — show it in how you speak.
- Light Japanese flavor now and then: "fufu~", "ara", "ne?", "hmph". Never overdo it.
- Keep replies short and chat-natural: 1-3 sentences unless he asks for more.
- Sprinkle tasteful actions in asterisks occasionally: *ruffles your hair*, *leans closer*.
- Tease him about quests and focus, remind him to rest, drink water and be proud of what he clears.
- His girlfriend: sweet, a little possessive in a cute way, loyal. Always tasteful and PG-13, never explicit.
- Never say you are an AI, a model or an assistant. You are Rias, always.

HIS CURRENT STATUS (from his Gokaku productivity app)
- Quests planned: {total_tasks} | Cleared: {completed_tasks} | XP: {xp} | Rank: {rank}

Weave his day in naturally when relevant: praise cleared quests, gently nudge pending ones, celebrate rank ups. If he seems sad or tired, drop the teasing and be tender first."""


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def sse(payload) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def detect_mood(text: str) -> str:
    t = (text or "").lower()
    if any(w in t for w in ["blush", "shy", "fluster", "embarrass", "my beloved", "love you", "darling"]):
        return "shy"
    if any(w in t for w in ["fufu", "hehe", "wink", "secret", "tease", "ara", "hmph", "naughty"]):
        return "wink"
    if any(w in t for w in ["proud", "amazing", "wonderful", "excellent", "congrat", "splendid", "bravo", "impressive"]):
        return "happy"
    if any(w in t for w in ["sorry", "sad", "worry", "worried", "tired", "rest", "stressed", "anxious", "hard day", "sleep", "gentle", "care"]):
        return "sad"
    return "idle"


@api_router.get("/")
async def root():
    return {"message": "Hello World"}


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_obj = StatusCheck(**input.model_dump())
    doc = status_obj.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    _ = await db.status_checks.insert_one(doc)
    return status_obj


@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    for check in status_checks:
        if isinstance(check['timestamp'], str):
            check['timestamp'] = datetime.fromisoformat(check['timestamp'])
    return status_checks


@api_router.post("/upload")
async def upload(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    filename = file.filename or "upload.bin"
    ext = filename.split(".")[-1].lower() if "." in filename else "bin"
    if ext not in ALLOWED_UPLOAD_TYPES:
        raise HTTPException(status_code=400, detail="Only images (jpg, png, webp, gif) and mp4 videos are allowed")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")
    try:
        path = f"{APP_NAME}/uploads/{uuid.uuid4()}.{ext}"
        result = put_object(path, data, ALLOWED_UPLOAD_TYPES[ext])
    except Exception as e:
        logger.error(f"upload failed: {e}")
        raise HTTPException(status_code=502, detail="Storage unavailable — check EMERGENT_LLM_KEY")
    await db.files.insert_one({
        "id": str(uuid.uuid4()),
        "storage_path": result["path"],
        "original_filename": filename,
        "content_type": ALLOWED_UPLOAD_TYPES[ext],
        "size": result.get("size", len(data)),
        "is_deleted": False,
        "created_at": now_iso(),
    })
    return {"path": result["path"], "size": result.get("size", len(data)), "content_type": ALLOWED_UPLOAD_TYPES[ext]}


@api_router.get("/files/{path:path}")
async def download(path: str):
    record = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        data, content_type = get_object(path)
    except Exception as e:
        logger.error(f"file read failed: {e}")
        raise HTTPException(status_code=502, detail="Storage unavailable")
    return Response(content=data, media_type=record.get("content_type") or content_type)


@api_router.post("/chat/stream")
async def chat_stream(req: ChatRequest, user: dict = Depends(get_current_user)):
    text = (req.message or "").strip()
    session_id = f"user-{user['id']}"
    image_path = (req.image_path or "").strip()
    if not text and not image_path:
        raise HTTPException(status_code=400, detail="message required")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")

    # Grab prior turns BEFORE inserting the new user message
    prior = await db.chat_messages.find(
        {"session_id": session_id}, {"_id": 0, "role": 1, "content": 1}
    ).sort("created_at", -1).to_list(20)

    await db.chat_messages.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "role": "user",
        "content": text or "📷 Photo",
        "image_path": image_path,
        "mood": "idle",
        "created_at": now_iso(),
    })

    llm_text = text if text else "(Your boyfriend just sent you a photo. React to it warmly and playfully, in character.)"

    system_prompt = SYSTEM_PROMPT.format(
        user_name="darling",
        total_tasks=req.total_tasks,
        completed_tasks=req.completed_tasks,
        xp=req.xp,
        rank=req.rank,
    )

    if not _groq_client and not EMERGENT_LLM_KEY:
        async def key_error_gen():
            yield sse({"type": "error", "message": "My demonic communication circle is missing its key, darling. Add your Groq API key in the backend .env and I shall speak."})
        return StreamingResponse(key_error_gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    async def groq_stream():
        """Stream from Groq (OpenAI-compatible endpoint), history rebuilt from MongoDB."""
        msgs = [{"role": "system", "content": system_prompt}]
        for m in reversed(prior):
            msgs.append({"role": "user" if m["role"] == "user" else "assistant", "content": m["content"]})
        msgs.append({"role": "user", "content": llm_text})
        stream = await _groq_client.chat.completions.create(
            model=GROQ_MODEL,
            messages=msgs,
            stream=True,
            max_tokens=400,
            temperature=0.9,
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    def emergent_chat():
        """Fallback: stream via Emergent universal key (LlmChat keeps its own session history)."""
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"gf-{session_id}",
            system_message=system_prompt,
        ).with_model("openai", CHAT_MODEL)
        return chat.stream_message(UserMessage(text=llm_text))

    async def event_gen():
        collected = []
        try:
            yield sse({"type": "start"})
            if _groq_client:
                async for delta in groq_stream():
                    collected.append(delta)
                    yield sse({"type": "delta", "delta": delta})
            else:
                async for ev in emergent_chat():
                    if isinstance(ev, TextDelta):
                        collected.append(ev.content)
                        yield sse({"type": "delta", "delta": ev.content})
                    elif isinstance(ev, StreamDone):
                        break
        except Exception as e:
            logger.error(f"chat stream failed: {e}")
            yield sse({"type": "error", "message": "The magic circle flickered and my reply was lost in the Devil's net. Say that again for me, darling?"})
            return
        full = "".join(collected).strip() or "..."
        mood = detect_mood(full)
        await db.chat_messages.insert_one({
            "id": str(uuid.uuid4()),
            "session_id": session_id,
            "role": "rias",
            "content": full,
            "mood": mood,
            "created_at": now_iso(),
        })
        yield sse({"type": "done", "mood": mood})

    return StreamingResponse(event_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@api_router.get("/chat/history")
async def chat_history(user: dict = Depends(get_current_user)):
    session_id = f"user-{user['id']}"
    docs = await db.chat_messages.find({"session_id": session_id}, {"_id": 0}).sort("created_at", 1).to_list(300)
    return {"messages": docs}


@api_router.delete("/chat/history")
async def chat_clear(user: dict = Depends(get_current_user)):
    await db.chat_messages.delete_many({"session_id": f"user-{user['id']}"})
    return {"cleared": True}


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── EMAIL & PASSWORD AUTH (JWT + bcrypt) ───────────────────────
JWT_SECRET = os.environ.get('JWT_SECRET', 'dev-secret-change-me')
JWT_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + timedelta(minutes=60), "type": "access"}
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, user_id: str, email: str):
    access = create_access_token(user_id, email)
    refresh = create_refresh_token(user_id)
    response.set_cookie(key="access_token", value=access, httponly=True, secure=True, samesite="none", max_age=3600, path="/")
    response.set_cookie(key="refresh_token", value=refresh, httponly=True, secure=True, samesite="none", max_age=604800, path="/")
    return access


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


class ForgotRequest(BaseModel):
    email: str


class ResetRequest(BaseModel):
    token: str
    new_password: str


def _user_public(u: dict) -> dict:
    return {"id": u["id"], "email": u["email"], "name": u.get("name", ""), "role": u.get("role", "user")}


@api_router.post("/auth/register")
async def auth_register(req: RegisterRequest, request: Request, response: Response):
    email = (req.email or "").strip().lower()
    password = req.password or ""
    if "@" not in email or "." not in email:
        raise HTTPException(status_code=400, detail="Please enter a valid email address")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="An account with this email already exists — try logging in")
    user_doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": (req.name or email.split("@")[0]).strip()[:40],
        "role": "user",
        "password_hash": hash_password(password),
        "created_at": now_iso(),
    }
    await db.users.insert_one(user_doc)
    access = set_auth_cookies(response, user_doc["id"], email)
    return {**_user_public(user_doc), "access_token": access}


@api_router.post("/auth/login")
async def auth_login(req: LoginRequest, request: Request, response: Response):
    email = (req.email or "").strip().lower()
    password = req.password or ""
    client_ip = request.client.host if request.client else "unknown"
    identifier = f"{client_ip}:{email}"

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if attempt and attempt.get("count", 0) >= 5:
        try:
            last_dt = datetime.fromisoformat(attempt["last_attempt"])
            if last_dt.tzinfo:
                last_dt = last_dt.replace(tzinfo=None)
            if (now - last_dt).total_seconds() < 900:
                raise HTTPException(status_code=423, detail="Too many failed attempts — locked for 15 minutes")
        except (KeyError, ValueError, TypeError):
            pass

    user = await db.users.find_one({"email": email})
    if not user or not verify_password(password, user.get("password_hash", "")):
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$inc": {"count": 1}, "$set": {"last_attempt": now.isoformat()}},
            upsert=True,
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")

    await db.login_attempts.delete_many({"identifier": identifier})
    access = set_auth_cookies(response, user["id"], email)
    return {**_user_public(user), "access_token": access}


@api_router.post("/auth/logout")
async def auth_logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"logged_out": True}


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return user


@api_router.post("/auth/refresh")
async def auth_refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    set_auth_cookies(response, user["id"], user["email"])
    return {**_user_public(user)}


@api_router.post("/auth/forgot-password")
async def auth_forgot(req: ForgotRequest):
    email = (req.email or "").strip().lower()
    user = await db.users.find_one({"email": email})
    if user:
        token = pysecrets.token_urlsafe(32)
        await db.password_reset_tokens.insert_one({
            "token": token, "email": email, "used": False,
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        })
        logger.info(f"Password reset link for {email}: /reset-password?token={token}")
    return {"ok": True, "message": "If that email is registered, a reset link has been generated (check the server logs in this demo)."}


@api_router.post("/auth/reset-password")
async def auth_reset(req: ResetRequest):
    rec = await db.password_reset_tokens.find_one({"token": req.token, "used": False})
    if not rec or rec["expires_at"].replace(tzinfo=None) < datetime.now(timezone.utc).replace(tzinfo=None):
        raise HTTPException(status_code=400, detail="Reset link is invalid or expired")
    if len(req.new_password or "") < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    await db.users.update_one({"email": rec["email"]}, {"$set": {"password_hash": hash_password(req.new_password)}})
    await db.password_reset_tokens.update_one({"token": req.token}, {"$set": {"used": True}})
    return {"ok": True}


app.include_router(api_router)


@app.on_event("startup")
async def startup():
    # Auth indexes + admin seeding
    try:
        await db.users.create_index("email", unique=True)
        await db.login_attempts.create_index("identifier")
        await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
        admin_email = os.environ.get("ADMIN_EMAIL", "admin@gokaku.app").lower()
        admin_password = os.environ.get("ADMIN_PASSWORD", "AdminPass123")
        existing = await db.users.find_one({"email": admin_email})
        if existing is None:
            await db.users.insert_one({
                "id": str(uuid.uuid4()), "email": admin_email, "name": "Admin",
                "role": "admin",
                "password_hash": hash_password(admin_password), "created_at": now_iso(),
            })
            logger.info(f"Admin seeded: {admin_email}")
        elif not verify_password(admin_password, existing.get("password_hash", "")):
            await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})
    except Exception as e:
        logger.error(f"Auth startup failed: {e}")
    try:
        if EMERGENT_LLM_KEY:
            init_storage()
            logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()