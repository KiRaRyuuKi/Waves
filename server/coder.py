from __future__ import annotations

import base64
import json
import os
import re
import threading
import time
import uuid
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/coder", tags=["coder"])

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STORAGE_DIR = Path(__file__).resolve().parent / "storage" / "coder"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_PATH = STORAGE_DIR / "config.json"
OUTPUTS_DIR = STORAGE_DIR / "outputs"
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

# --- Stack definitions (mirroring screenshot-to-code stacks) ---
class Stack(str, Enum):
    HTML_TAILWIND = "html_tailwind"
    HTML_CSS = "html_css"
    REACT_TAILWIND = "react_tailwind"
    VUE_TAILWIND = "vue_tailwind"
    BOOTSTRAP = "bootstrap"
    IONIC_TAILWIND = "ionic_tailwind"

STACK_META: dict[str, dict] = {
    Stack.HTML_TAILWIND: {"label": "HTML + Tailwind", "hint": "Single HTML file with Tailwind CDN"},
    Stack.HTML_CSS: {"label": "HTML + CSS", "hint": "Pure HTML/CSS/JS tanpa Tailwind"},
    Stack.REACT_TAILWIND: {"label": "React + Tailwind", "hint": "Standalone React via CDN + Babel + Tailwind"},
    Stack.VUE_TAILWIND: {"label": "Vue + Tailwind", "hint": "Vue 3 global build + Tailwind"},
    Stack.BOOTSTRAP: {"label": "Bootstrap", "hint": "HTML + Bootstrap 5.3 CDN"},
    Stack.IONIC_TAILWIND: {"label": "Ionic + Tailwind", "hint": "Ionic Core + Tailwind"},
}

# --- System prompt reuse from vendor/coder ---
# We inline the relevant system prompt + stack instructions to avoid importing vendor package (which needs deps)
SYSTEM_PROMPT = open(PROJECT_ROOT / "vendor" / "coder" / "backend" / "prompts" / "system_prompt.py", encoding="utf-8").read() if (PROJECT_ROOT / "vendor" / "coder" / "backend" / "prompts" / "system_prompt.py").exists() else ""

# Fallback inline if read failed
if "You are an expert" not in SYSTEM_PROMPT:
    try:
        from vendor.coder.backend.prompts.system_prompt import SYSTEM_PROMPT as _SP  # type: ignore
        SYSTEM_PROMPT = _SP
    except Exception:
        SYSTEM_PROMPT = """You are an expert frontend developer. Convert the screenshot into clean, functional code. Return ONLY the code for a single HTML file that replicates the design. Use Tailwind CDN when requested."""

# Provide helper to extract pure SYSTEM_PROMPT string content
def _get_system_prompt() -> str:
    # If we read the .py file raw, extract triple-quoted string
    if 'SYSTEM_PROMPT = """' in SYSTEM_PROMPT:
        m = re.search(r'SYSTEM_PROMPT\s*=\s*"""(.*)"""', SYSTEM_PROMPT, re.DOTALL)
        if m:
            return m.group(1).strip()
    return SYSTEM_PROMPT.strip() or "You are an expert frontend developer. Convert screenshots to clean code."

STACK_INSTRUCTIONS: dict[str, str] = {
    Stack.HTML_TAILWIND: 'Use <script src="https://cdn.tailwindcss.com"></script>. Produce a single index.html.',
    Stack.HTML_CSS: 'Only use HTML, CSS and JS. Do not use Tailwind. Produce a single index.html.',
    Stack.REACT_TAILWIND: 'Use React CDN (react@18, react-dom@18) + Babel standalone@7.25.6 + Tailwind CDN. Produce a single HTML file with embedded JSX.',
    Stack.VUE_TAILWIND: 'Use Vue 3 global build (vue.global.js) + Tailwind CDN. Produce a single HTML file.',
    Stack.BOOTSTRAP: 'Use <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">. Produce a single HTML file.',
    Stack.IONIC_TAILWIND: 'Use Ionic Core CDN (esm + css) + Tailwind CDN + ionicons. Produce a single HTML file.',
}

# --- Config persistence ---
def _load_config() -> dict:
    try:
        if CONFIG_PATH.is_file():
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {"providers": {}}

def _save_config(cfg: dict) -> None:
    try:
        STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = CONFIG_PATH.with_name(CONFIG_PATH.name + ".tmp")
        tmp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(CONFIG_PATH)
    except OSError:
        pass


# A02/A07: api key tidak pernah dikirim ke client. Editor raw tetap bisa
# menampilkan file config, tapi nilai key diganti placeholder; saat disimpan,
# placeholder itu berarti "pertahankan key yang sudah ada".
_API_KEY_MASK = "********"
_KEY_FIELDS = ("api_key",)

def _get_api_key(provider: str) -> str | None:
    # Priority: env var > stored config
    env_map = {
        "openai": "OPENAI_API_KEY",
        "anthropic": "ANTHROPIC_API_KEY",
        "gemini": "GEMINI_API_KEY",
        "replicate": "REPLICATE_API_KEY",
    }
    env_key = env_map.get(provider)
    if env_key and os.environ.get(env_key):
        return os.environ[env_key].strip() or None
    cfg = _load_config()
    prov = cfg.get("providers") or {}
    # support both old flat and new nested
    val = prov.get(provider)
    if isinstance(val, dict):
        return (val.get("api_key") or "").strip() or None
    if isinstance(val, str):
        return val.strip() or None
    return None

def _get_openai_base_url() -> str | None:
    if os.environ.get("OPENAI_BASE_URL"):
        return os.environ["OPENAI_BASE_URL"].strip() or None
    cfg = _load_config()
    prov = cfg.get("providers", {}).get("openai", {})
    if isinstance(prov, dict):
        return (prov.get("base_url") or "").strip() or None
    return None

# --- Job management ---
class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    DONE = "done"
    ERROR = "error"

@dataclass
class CoderJob:
    id: str
    status: JobStatus = JobStatus.QUEUED
    progress: float = 0.0
    stage: str = "Menunggu"
    error: str | None = None
    result: dict | None = None
    created_at: float = field(default_factory=time.time)
    stack: str = Stack.HTML_TAILWIND
    provider: str = "openai"

class Store:
    def __init__(self):
        self._jobs: dict[str, CoderJob] = {}
        self._lock = threading.Lock()
    def create(self, job: CoderJob):
        with self._lock:
            self._jobs[job.id] = job
    def get(self, job_id: str) -> CoderJob | None:
        with self._lock:
            return self._jobs.get(job_id)
    def update(self, job_id: str, **fields):
        with self._lock:
            j = self._jobs.get(job_id)
            if j:
                for k, v in fields.items():
                    setattr(j, k, v)

store = Store()

# --- LLM calls ---
def _call_openai(prompt: str, image_b64: str, model: str, api_key: str, base_url: str | None) -> str:
    url = (base_url.rstrip("/") if base_url else "https://api.openai.com/v1") + "/chat/completions"
    # OpenAI vision: image_url with data url
    mime = "image/png"
    # detect mime from header if data url passed? we store raw b64, assume png
    payload = {
        "model": model or "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": _get_system_prompt() + "\n\n" + STACK_INSTRUCTIONS.get("html_tailwind","")},
            {"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}}
            ]}
        ],
        "temperature": 0.2,
        "max_tokens": 8000,
    }
    # stack instruction override done via prompt augmentation outside
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            choices = body.get("choices") or []
            if not choices:
                raise RuntimeError(f"Empty choices: {body}")
            return choices[0].get("message", {}).get("content") or ""
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:2000]
        raise RuntimeError(f"OpenAI API error {e.code}: {detail}")
    except Exception as e:
        raise RuntimeError(f"OpenAI call failed: {e}")

def _call_anthropic(prompt: str, image_b64: str, media_type: str, model: str, api_key: str) -> str:
    url = "https://api.anthropic.com/v1/messages"
    sys_prompt = _get_system_prompt()
    payload = {
        "model": model or "claude-sonnet-4-20240620",
        "max_tokens": 8000,
        "system": sys_prompt,
        "messages": [
            {"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                {"type": "text", "text": prompt}
            ]}
        ]
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01"
    }, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            content = body.get("content") or []
            texts = [c.get("text","") for c in content if c.get("type")=="text"]
            return "\n".join(texts)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:2000]
        raise RuntimeError(f"Anthropic API error {e.code}: {detail}")

def _call_gemini(prompt: str, image_b64: str, media_type: str, model: str, api_key: str) -> str:
    m = model or "gemini-3.6-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={api_key}"
    payload = {
        "contents": [{"role": "user", "parts": [
            {"inline_data": {"mime_type": media_type, "data": image_b64}},
            {"text": prompt}
        ]}],
        "systemInstruction": {"parts": [{"text": _get_system_prompt()}]},
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 8000}
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    # Retry untuk 503/429/500 — Gemini sering 503 high demand
    last_err = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                cands = body.get("candidates") or []
                if not cands:
                    raise RuntimeError(f"Gemini empty: {body}")
                parts = cands[0].get("content", {}).get("parts") or []
                return "".join(p.get("text","") for p in parts)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:2000]
            last_err = RuntimeError(f"Gemini API error {e.code}: {detail}")
            # 503/429/500 = transient, retry dengan backoff
            if e.code in (503, 429, 500, 502, 504) and attempt < 2:
                wait = 2 * (attempt + 1) + (attempt * 2)  # 2s, 6s
                time.sleep(wait)
                continue
            raise last_err
    raise last_err or RuntimeError("Gemini call failed after retries")

def _call_ollama_vision(prompt: str, image_b64: str, model: str) -> str:
    # Ollama vision models: qwen2.5vl, llava, gemma3 etc via /api/chat
    ollama_url = os.environ.get("OLLAMA_URL") or "http://127.0.0.1:11434"
    url = ollama_url.rstrip("/") + "/api/chat"
    payload = {
        "model": model or "qwen2.5vl:7b",
        "messages": [
            {"role": "system", "content": _get_system_prompt()},
            {"role": "user", "content": prompt, "images": [image_b64]}
        ],
        "stream": False
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            msg = body.get("message") or {}
            return msg.get("content") or ""
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:2000]
        raise RuntimeError(f"Ollama error {e.code}: {detail}")
    except Exception as e:
        raise RuntimeError(f"Ollama call failed (is Ollama running? model pulled?): {e}")

def _extract_code(text: str) -> str:
    # Try to extract code fence ```html ... ``` or ``` ... ```
    if not text:
        return ""
    # Prefer first fenced block
    m = re.search(r"```(?:html|vue|jsx|tsx|javascript|js)?\s*\n?(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if m:
        code = m.group(1).strip()
        if len(code) > 200:
            return code
    # if no fence but looks like html, return raw
    if "<html" in text.lower() or "<!doctype" in text.lower():
        # trim surrounding prose before first <
        idx = text.lower().find("<!doctype")
        if idx == -1:
            idx = text.lower().find("<html")
        if idx != -1:
            return text[idx:].strip()
    return text.strip()

def _build_user_prompt(base_prompt: str, stack: str, extra: str | None = None) -> str:
    instr = STACK_INSTRUCTIONS.get(stack, STACK_INSTRUCTIONS[Stack.HTML_TAILWIND])
    parts = [
        f"Stack: {stack} ({STACK_META.get(stack, {}).get('label','')})",
        f"Stack instruction: {instr}",
        "",
        "Task: Convert the screenshot exactly into clean, functional code. Match layout, colors, spacing, typography as closely as possible. Make it responsive. Return ONLY the code inside a single fenced code block (```html ... ```). Do not include explanation outside the code block.",
    ]
    if base_prompt and base_prompt.strip():
        parts.append(f"\nAdditional user instruction: {base_prompt.strip()}")
    if extra and extra.strip():
        parts.append(f"\nContext / previous code instruction: {extra.strip()}")
    # Append general guidance similar to screenshot-to-code
    parts.append("\nUse CDN links for Tailwind/Bootstrap/React/Vue/Ionic as per stack. Use Google Fonts if needed. Use placeholder images via https://via.placeholder.com or unsplash if original assets not extractable. Make code production-ready.")
    return "\n".join(parts)

def _detect_media_type(b64_or_dataurl: str) -> tuple[str, str]:
    raw = b64_or_dataurl.strip()
    if raw.startswith("data:"):
        try:
            header, data = raw.split(",", 1)
            mime = header.split(";")[0].split(":")[1] if ":" in header else "image/png"
            if mime not in ("image/png","image/jpeg","image/jpg","image/webp"):
                mime = "image/png"
            return mime, data
        except Exception:
            pass
        # fallback
        if "," in raw:
            return "image/png", raw.split(",",1)[1]
        return "image/png", raw
    # raw base64 — guess png
    return "image/png", raw

# --- Pydantic models ---
class CoderGenerateRequest(BaseModel):
    image_b64: str = Field(..., description="Base64 or data URL of screenshot")
    stack: str = Field(Stack.HTML_TAILWIND, description="Target stack")
    prompt: str = Field("", max_length=4000, description="Opsional instruksi tambahan")
    provider: str = Field("auto", description="openai|anthropic|gemini|ollama|auto")
    model: str = Field("", description="Model override, kosong = default per provider")
    refine_code: str | None = Field(None, description="Kode sebelumnya untuk refine (update mode)")
    refine_instruction: str | None = Field(None, description="Instruksi update ketika refine")

class CoderConfigRequest(BaseModel):
    provider: str
    api_key: str | None = None
    base_url: str | None = None

# --- Helpers ---
def _resolve_provider(requested: str) -> str:
    req = (requested or "auto").strip().lower()
    if req != "auto":
        if req not in ("openai","anthropic","gemini","ollama"):
            raise HTTPException(400, f"Provider tidak dikenal: {requested}")
        return req
    # auto detection: gemini > openai > anthropic > ollama
    for p in ("gemini","openai","anthropic"):
        if _get_api_key(p):
            return p
    # fallback check ollama online
    try:
        import urllib.request as _ur
        _ur.urlopen("http://127.0.0.1:11434/api/tags", timeout=1.2)
        return "ollama"
    except Exception:
        pass
    # try localhost variant
    try:
        import urllib.request as _ur2
        _ur2.urlopen("http://localhost:11434/api/tags", timeout=1.2)
        return "ollama"
    except Exception:
        pass
    return "openai"  # default, will error with helpful msg if no key

def _default_model(provider: str) -> str:
    return {
        "openai": "gpt-4o-mini",
        "anthropic": "claude-sonnet-4-20240620",
        "gemini": "gemini-3.6-flash",
        "ollama": "qwen2.5vl:7b",
    }.get(provider, "")

# --- Routes ---
@router.get("/stacks")
async def list_stacks():
    return {"stacks": [
        {"id": k, "label": v["label"], "hint": v["hint"]}
        for k, v in STACK_META.items()
    ]}

@router.get("/config")
async def get_config():
    cfg = _load_config()
    # mask keys
    masked: dict = {}
    for p in ("openai","anthropic","gemini","replicate","ollama"):
        key = _get_api_key(p)
        env_has = bool(os.environ.get({"openai":"OPENAI_API_KEY","anthropic":"ANTHROPIC_API_KEY","gemini":"GEMINI_API_KEY","replicate":"REPLICATE_API_KEY"}.get(p,"")))
        masked[p] = {
            "configured": bool(key),
            "source": "env" if env_has and key else ("storage" if key else "none"),
            "preview": (key[:4] + "…"+ key[-4:] if key and len(key)>8 else "••••") if key else None,
        }
    # ollama status
    ollama_online = False
    ollama_models: list = []
    for base in ("http://127.0.0.1:11434","http://localhost:11434"):
        try:
            req = urllib.request.Request(base+"/api/tags", headers={"User-Agent":"Waves/1.0"})
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                ollama_online = True
                ollama_models = (data.get("models") or [])[:20]
                break
        except Exception:
            continue
    return {"providers": masked, "ollama": {"online": ollama_online, "models": ollama_models}, "openai_base_url": _get_openai_base_url()}

@router.post("/config")
async def save_config(req: CoderConfigRequest):
    p = (req.provider or "").strip().lower()
    if p not in ("openai","anthropic","gemini","replicate"):
        raise HTTPException(400, "provider harus openai|anthropic|gemini|replicate")
    cfg = _load_config()
    cfg.setdefault("providers", {})
    entry = cfg["providers"].get(p) or {}
    if isinstance(entry, str):
        entry = {"api_key": entry}
    if req.api_key is not None:
        cleaned = req.api_key.strip()
        if cleaned == "":
            entry.pop("api_key", None)
        else:
            entry["api_key"] = cleaned
    if req.base_url is not None and p == "openai":
        cleaned = req.base_url.strip()
        if cleaned == "":
            entry.pop("base_url", None)
        else:
            entry["base_url"] = cleaned
    # remove empty entry
    if not entry:
        cfg["providers"].pop(p, None)
    else:
        cfg["providers"][p] = entry
    _save_config(cfg)
    return {"saved": p}


def _mask_secrets(obj: object) -> object:
    """Salinan config dengan nilai api key diganti placeholder."""
    if isinstance(obj, dict):
        out: dict = {}
        for k, v in obj.items():
            if k in _KEY_FIELDS and isinstance(v, str) and v:
                out[k] = _API_KEY_MASK
            else:
                out[k] = _mask_secrets(v)
        return out
    if isinstance(obj, list):
        return [_mask_secrets(v) for v in obj]
    return obj


@router.get("/config/raw")
async def get_config_raw():
    path = CONFIG_PATH
    # Auto-create default jika belum ada — jangan return not found
    if not path.is_file():
        try:
            STORAGE_DIR.mkdir(parents=True, exist_ok=True)
            default = {"providers": {}}
            path.write_text(json.dumps(default, indent=2, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass
    exists = path.is_file()
    raw_text = ""
    parsed: dict | None = None
    if exists:
        try:
            raw_text = path.read_text(encoding="utf-8")
            if not raw_text.strip():
                raw_text = json.dumps({"providers": {}}, indent=2, ensure_ascii=False)
                parsed = {"providers": {}}
            else:
                parsed = json.loads(raw_text)
        except json.JSONDecodeError as e:
            # file rusak -> jangan 404, kembalikan raw + error field biar editor tetap bisa perbaiki
            raw_text = path.read_text(encoding="utf-8", errors="replace")
            return {"path": str(path), "exists": True, "raw": raw_text, "parsed": None, "error": f"JSON tidak valid: {e.msg} (line {e.lineno} col {e.colno}) — perbaiki di editor lalu Simpan."}
        except OSError:
            raw_text = json.dumps({"providers": {}}, indent=2, ensure_ascii=False)
            parsed = {"providers": {}}
    else:
        raw_text = json.dumps({"providers": {}}, indent=2, ensure_ascii=False)
        parsed = {"providers": {}}
    masked = _mask_secrets(parsed)
    return {
        "path": str(path),
        "exists": exists,
        "raw": json.dumps(masked, indent=2, ensure_ascii=False),
        "parsed": masked,
        "secrets_masked": True,
    }


class CoderRawConfigRequest(BaseModel):
    raw: str = Field(..., description="Isi JSON mentah untuk server/storage/coder/config.json")
    # alternative: allow parsed dict as fallback
    parsed: dict | None = None


@router.put("/config/raw")
async def put_config_raw(req: CoderRawConfigRequest):
    text = (req.raw or "").strip()
    if not text and req.parsed is not None:
        text = json.dumps(req.parsed, indent=2, ensure_ascii=False)
    if not text:
        raise HTTPException(400, "raw kosong")
    # Batasi ukuran 64KB
    if len(text.encode("utf-8")) > 64 * 1024:
        raise HTTPException(400, "File terlalu besar (>64KB)")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"JSON tidak valid: {e.msg} (line {e.lineno} col {e.colno})") from e
    if not isinstance(data, dict):
        raise HTTPException(400, "Root JSON harus object")
    # Pastikan struktur minimal providers dict jika ada
    if "providers" in data and not isinstance(data["providers"], dict):
        raise HTTPException(400, "Field 'providers' harus object")
    # A02: placeholder dari editor berarti "jangan sentuh key yang ada".
    current = _load_config().get("providers") or {}
    incoming = data.get("providers")
    if isinstance(incoming, dict):
        for provider, entry in incoming.items():
            if not isinstance(entry, dict):
                continue
            for field_name in _KEY_FIELDS:
                if entry.get(field_name) != _API_KEY_MASK:
                    continue
                prev = current.get(provider)
                prev_key = prev.get(field_name) if isinstance(prev, dict) else None
                if prev_key:
                    entry[field_name] = prev_key
                else:
                    entry.pop(field_name, None)
    # Tulis atomically
    try:
        STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = CONFIG_PATH.with_name(CONFIG_PATH.name + ".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(CONFIG_PATH)
    except OSError as e:
        raise HTTPException(500, f"Gagal menyimpan: {e}") from e
    return {"saved": True, "path": str(CONFIG_PATH), "providers": list((data.get("providers") or {}).keys())}

@router.post("/generate")
async def generate(req: CoderGenerateRequest):
    if not req.image_b64 or not req.image_b64.strip():
        raise HTTPException(400, "image_b64 wajib diisi (base64 atau data URL screenshot)")
    if req.stack not in STACK_META:
        raise HTTPException(400, f"stack tidak dikenal: {req.stack}")
    mime, b64 = _detect_media_type(req.image_b64)
    if not b64 or len(b64) < 200:
        raise HTTPException(400, "Gambar tidak valid atau terlalu kecil")
    # rough size check 10MB b64 ~ 7.5MB bytes
    if len(b64) > 14_000_000:
        raise HTTPException(400, "Gambar terlalu besar (>10MB). Kompres dulu.")

    provider = _resolve_provider(req.provider)
    model = (req.model or "").strip() or _default_model(provider)

    # validate keys early
    if provider in ("openai","anthropic","gemini"):
        key = _get_api_key(provider)
        if not key:
            raise HTTPException(400, f"API key untuk provider '{provider}' belum diatur. Atur di POST /api/coder/config atau set env {provider.upper()}_API_KEY, atau ganti provider ke 'ollama' (lokal).")

    job_id = uuid.uuid4().hex
    job = CoderJob(id=job_id, status=JobStatus.QUEUED, stage="Menunggu", progress=0, stack=req.stack, provider=provider)
    store.create(job)

    def _run():
        try:
            store.update(job_id, status=JobStatus.PROCESSING, stage="Mengirim ke LLM", progress=10)
            # Build prompt
            if req.refine_code and req.refine_instruction:
                # Update mode: focus on editing
                user_prompt = f"""Current code (update this, return full updated file):
```html
{req.refine_code[:120000]}
```
Instruction for update: {req.refine_instruction}
Additional context: {req.prompt or ''}
Stack remains: {req.stack}
Return ONLY the full updated HTML file in a fenced block."""
            else:
                user_prompt = _build_user_prompt(req.prompt, req.stack, None)
                # inject stack instruction into system is done via prompt augment; also add refine if any
                if req.refine_code:
                    user_prompt += f"\n\nPrevious code for reference (improve it):\n```html\n{req.refine_code[:60000]}\n```"

            store.update(job_id, progress=30, stage="Menunggu respon LLM")
            raw = ""
            if provider == "openai":
                base_url = _get_openai_base_url()
                key = _get_api_key("openai") or ""
                # Need to pass stack instruction via system - we build prompt with stack already; _call_openai uses hardcoded html_tailwind hint, so we override by passing augmented system via prompt
                # To handle stack correctly, we patch call to use proper system+stack
                sys_prompt = _get_system_prompt() + "\n\n" + STACK_INSTRUCTIONS.get(req.stack, "")
                # inline per-provider call with correct sys
                url = (base_url.rstrip("/") if base_url else "https://api.openai.com/v1") + "/chat/completions"
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": sys_prompt},
                        {"role": "user", "content": [
                            {"type": "text", "text": user_prompt},
                            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}
                        ]}
                    ],
                    "temperature": 0.2,
                    "max_tokens": 9000,
                }
                data = json.dumps(payload).encode("utf-8")
                rq = urllib.request.Request(url, data=data, headers={"Content-Type":"application/json","Authorization":f"Bearer {key}"}, method="POST")
                try:
                    with urllib.request.urlopen(rq, timeout=150) as resp:
                        body = json.loads(resp.read().decode("utf-8"))
                        raw = (body.get("choices") or [{}])[0].get("message",{}).get("content") or ""
                except urllib.error.HTTPError as e:
                    detail = e.read().decode("utf-8", errors="replace")[:3000]
                    raise RuntimeError(f"OpenAI {e.code}: {detail}")
            elif provider == "anthropic":
                key = _get_api_key("anthropic") or ""
                sys_prompt = _get_system_prompt() + "\n\n" + STACK_INSTRUCTIONS.get(req.stack, "")
                payload = {
                    "model": model,
                    "max_tokens": 9000,
                    "system": sys_prompt,
                    "messages": [{"role":"user","content":[
                        {"type":"image","source":{"type":"base64","media_type":mime,"data":b64}},
                        {"type":"text","text": user_prompt}
                    ]}]
                }
                url = "https://api.anthropic.com/v1/messages"
                data = json.dumps(payload).encode("utf-8")
                rq = urllib.request.Request(url, data=data, headers={"Content-Type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01"}, method="POST")
                try:
                    with urllib.request.urlopen(rq, timeout=150) as resp:
                        body = json.loads(resp.read().decode("utf-8"))
                        texts = [c.get("text","") for c in (body.get("content") or []) if c.get("type")=="text"]
                        raw = "\n".join(texts)
                except urllib.error.HTTPError as e:
                    detail = e.read().decode("utf-8", errors="replace")[:3000]
                    raise RuntimeError(f"Anthropic {e.code}: {detail}")
            elif provider == "gemini":
                key = _get_api_key("gemini") or ""
                sys_prompt = _get_system_prompt() + "\n\n" + STACK_INSTRUCTIONS.get(req.stack, "")
                m = model
                # Retry + fallback untuk 503 high demand
                fallbacks = [m, "gemini-3.5-flash", "gemini-3-flash-preview"] if m not in ("gemini-3.5-flash", "gemini-3-flash-preview") else [m]
                # deduplicate preserve order
                seen = set()
                fallbacks = [x for x in fallbacks if not (x in seen or seen.add(x))]
                last_err = None
                raw = ""
                for fb_model in fallbacks:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{fb_model}:generateContent?key={key}"
                    payload = {
                        "contents": [{"role":"user","parts":[
                            {"inline_data":{"mime_type":mime,"data":b64}},
                            {"text": user_prompt}
                        ]}],
                        "systemInstruction": {"parts":[{"text": sys_prompt}]},
                        "generationConfig": {"temperature":0.2,"maxOutputTokens":9000}
                    }
                    data = json.dumps(payload).encode("utf-8")
                    rq = urllib.request.Request(url, data=data, headers={"Content-Type":"application/json"}, method="POST")
                    for attempt in range(3):
                        try:
                            store.update(job_id, progress=30 + attempt*5, stage=f"Menunggu respon LLM ({fb_model} coba {attempt+1}/3)")
                            with urllib.request.urlopen(rq, timeout=150) as resp:
                                body = json.loads(resp.read().decode("utf-8"))
                                cands = body.get("candidates") or []
                                parts = cands[0].get("content",{}).get("parts") or [] if cands else []
                                raw = "".join(p.get("text","") for p in parts)
                            last_err = None
                            break
                        except urllib.error.HTTPError as e:
                            detail = e.read().decode("utf-8", errors="replace")[:3000]
                            last_err = RuntimeError(f"Gemini {e.code} ({fb_model}): {detail}")
                            # 503/429/500 = transient — retry, kalau masih gagal coba fallback model
                            if e.code in (503, 429, 500, 502, 504) and attempt < 2:
                                wait = 3 * (attempt + 1)
                                store.update(job_id, stage=f"Gemini sibuk (503) — retry {attempt+1}/3 dalam {wait}s...")
                                time.sleep(wait)
                                continue
                            # jangan retry lagi untuk model ini, lanjut ke fallback
                            break
                        except Exception as e:
                            last_err = e
                            break
                    if raw and raw.strip():
                        if fb_model != m:
                            store.update(job_id, stage=f"Fallback ke {fb_model} berhasil")
                        m = fb_model  # untuk result metadata
                        break
                if last_err and not raw:
                    raise last_err
            elif provider == "ollama":
                raw = _call_ollama_vision(user_prompt, b64, model)
            else:
                raise RuntimeError(f"Provider tidak didukung: {provider}")

            store.update(job_id, progress=85, stage="Memproses hasil")
            if not raw or not raw.strip():
                raise RuntimeError("LLM mengembalikan respon kosong. Coba ganti model/provider atau perkecil gambar.")
            code = _extract_code(raw)
            if not code or len(code.strip()) < 50:
                code = raw.strip()
            # Basic sanity: must contain html tag or at least <div
            if "<" not in code:
                raise RuntimeError(f"Output bukan HTML valid (cuplikan): {code[:400]}")

            # Save to disk for audit
            try:
                out_path = OUTPUTS_DIR / f"{job_id}.html"
                out_path.write_text(code, encoding="utf-8")
            except Exception:
                pass

            store.update(job_id, status=JobStatus.DONE, progress=100, stage="Selesai", result={
                "code": code,
                "raw": raw[:120000],
                "stack": req.stack,
                "provider": provider,
                "model": m if provider == "gemini" else model,
            })
        except HTTPException as exc:
            store.update(job_id, status=JobStatus.ERROR, stage="Gagal", error=str(exc.detail) if hasattr(exc,"detail") else str(exc))
        except Exception as exc:
            msg = str(exc)
            # friendly hints
            low = msg.lower()
            if "quota" in low or "billing" in low:
                msg = f"Kuota/billing habis untuk {provider}. Cek dashboard provider. Detail: {exc}"
            elif "api key" in low or "authentication" in low or "unauthorized" in low:
                msg = f"API key {provider} tidak valid / belum diatur. Atur di Screen Coder → Pengaturan Provider. Detail: {exc}"
            elif "503" in low or "unavailable" in low or "high demand" in low:
                msg = f"Gemini sedang overload (503 high demand) - server sudah retry 3x + fallback ke gemini-3.5-flash/3-flash-preview. Silakan coba Generate lagi dalam 30-60 detik, atau ganti model ke gemini-3.5-flash / openai gpt-4o-mini. Detail: {exc}"
            elif "429" in low or "rate" in low:
                msg = f"Rate limit / terlalu banyak request. Tunggu sebentar lalu coba lagi, atau ganti provider. Detail: {exc}"
            store.update(job_id, status=JobStatus.ERROR, stage="Gagal", error=msg[:4000])

    threading.Thread(target=_run, daemon=True).start()
    return {"job_id": job_id, "provider": provider, "model": model}

@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = store.get(job_id)
    if not job:
        raise HTTPException(404, "Job tidak ditemukan atau sudah kedaluwarsa")
    status_val = job.status.value if isinstance(job.status, JobStatus) else str(job.status)
    return {
        "id": job.id,
        "status": status_val,
        "progress": float(job.progress),
        "stage": job.stage,
        "error": job.error,
        "result": job.result,
        "created_at": job.created_at,
        "stack": job.stack,
        "provider": job.provider,
    }

@router.get("/outputs")
async def list_outputs(limit: int = 20):
    files = sorted(OUTPUTS_DIR.glob("*.html"), key=lambda p: p.stat().st_mtime, reverse=True)
    return {"outputs": [
        {"name": p.stem, "size": p.stat().st_size, "created": p.stat().st_mtime}
        for p in files[:max(1,min(limit,100))]
    ]}
