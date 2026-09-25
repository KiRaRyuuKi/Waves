from __future__ import annotations

import json
import re
import threading
import time
import urllib.request
import urllib.parse
import urllib.error
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional, Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
import asyncio

router = APIRouter(prefix="/api/llm", tags=["llm"])

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LLM_DIR = PROJECT_ROOT / "server" / "storage" / "llm"
LLM_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_PATH = LLM_DIR / "runtime_config.json"

HF_API = "https://huggingface.co/api/models"
HF_RESOLVE = "https://huggingface.co"

OLLAMA_URL = "http://127.0.0.1:11434"
# LM Studio dihapus — fokus Ollama saja (sesuai request)
LMSTUDIO_URL = "http://127.0.0.1:1234"

def _ollama_dir() -> Path:
    import os
    env = os.environ.get("OLLAMA_MODELS")
    if env:
        return Path(env)
    home = Path.home()
    # Windows: C:\Users\<user>\.ollama
    cand = home / ".ollama"
    return cand

# ---- kategori ala LM Studio ----
CATEGORIES: list[dict[str, str]] = [
    {"id": "all", "label": "Semua", "hint": "Semua model GGUF"},
    {"id": "chat", "label": "Chat Umum", "hint": "Chat & assistant generik"},
    {"id": "code", "label": "Coding", "hint": "Code generation & assistant"},
    {"id": "instruct", "label": "Instruct", "hint": "Instruction-tuned"},
    {"id": "reasoning", "label": "Reasoning", "hint": "Model penalaran / CoT"},
    {"id": "roleplay", "label": "Roleplay", "hint": "Creative & roleplay"},
    {"id": "multilingual", "label": "Multilingual", "hint": "Support multibahasa / Indonesia"},
]

QUANTS = ["Q2_K", "Q3_K_M", "Q4_0", "Q4_K_M", "Q4_K_S", "Q5_K_M", "Q6_K", "Q8_0", "F16"]
SIZES = [
    {"id": "all", "label": "Semua ukuran"},
    {"id": "1b-3b", "label": "< 4B", "search": "1B 3B"},
    {"id": "7b", "label": "7–8B", "search": "7B 8B"},
    {"id": "13b", "label": "13B", "search": "13B"},
    {"id": "30b+", "label": "30B+", "search": "30B 70B"},
]

# ------------------------------------------------------------------
# Helpers: http fetch with timeout, no extra deps
# ------------------------------------------------------------------

def _fetch_json(url: str, headers: dict | None = None, timeout: float = 12) -> Any:
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "Waves/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            return json.loads(body.decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        raise HTTPException(status_code=e.code, detail=detail or str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gagal hubungi upstream: {e}")


def _fetch_text(url: str, timeout: float = 4) -> tuple[bool, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": "Waves/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            try:
                return True, json.loads(body.decode("utf-8"))
            except Exception:
                return True, body.decode("utf-8", errors="replace")
    except Exception:
        return False, None


_REPO_SEGMENT_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9_-])?$")


def _safe_repo_id(repo: str) -> str:
    # A01: hanya "owner/name" dengan tiap segmen bebas dari "..", pemisah path,
    # dan karakter funky. Regex lama mengizinkan "..", sehingga
    # LLM_DIR/<repo>/<file> bisa keluar dari LLM_DIR (arbitrary file write).
    if not isinstance(repo, str) or repo.count("/") != 1:
        raise HTTPException(400, "repoId tidak valid (format owner/name)")
    owner, name = repo.split("/")
    for seg in (owner, name):
        if not seg or ".." in seg or not _REPO_SEGMENT_RE.fullmatch(seg):
            raise HTTPException(400, "repoId tidak valid (format owner/name)")
    return repo


def _safe_filename(filename: str) -> str:
    """Kembalikan basename GGUF yang aman, atau 400."""
    if not isinstance(filename, str) or not filename.strip():
        raise HTTPException(400, "filename wajib diisi")
    base = filename.replace("\\", "/").split("/")[-1].strip()
    if not base or base in (".", "..") or ".." in base:
        raise HTTPException(400, "filename tidak valid")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,180}", base):
        raise HTTPException(400, "filename tidak valid")
    if not base.lower().endswith(".gguf"):
        raise HTTPException(400, "Hanya file .gguf yang didukung")
    return base


def _dest_for(repo: str, filename: str) -> Path:
    """Bangun path tujuan dan pastikan hasil resolve-nya tetap di LLM_DIR."""
    safe_repo = _safe_repo_id(repo)
    safe_name = _safe_filename(filename)
    dest = LLM_DIR / safe_repo / safe_name
    root = LLM_DIR.resolve()
    try:
        resolved = dest.resolve()
    except OSError:
        resolved = dest
    if root not in resolved.parents:
        raise HTTPException(400, "lokasi tujuan tidak valid")
    return dest


def _quant_from_filename(name: str) -> str:
    m = re.search(r"(Q\d[_\w]*|IQ\d_\w+|F16|F32|BF16)", name, re.IGNORECASE)
    return m.group(1).upper() if m else "GGUF"


def _brief(text: str | None, limit: int = 180) -> str:
    if not text:
        return "Model GGUF siap pakai untuk inferensi lokal via Ollama / LM Studio. Mendukung konteks panjang & kuantisasi efisien."
    t = re.sub(r"\s+", " ", text).strip()
    if len(t) > limit:
        return t[: limit - 1] + "…"
    return t


# ------------------------------------------------------------------
# Runtime autodetect
# ------------------------------------------------------------------

@router.get("/runtime/status")
async def runtime_status():
    ollama_online = False
    ollama_models: list[dict] = []
    ollama_err: str | None = None

    # Ollama: coba 127.0.0.1 lalu localhost, timeout lebih longgar (Ollama di Windows kadang lambat bangun)
    for base in [OLLAMA_URL, "http://localhost:11434"]:
        ok, data = _fetch_text(f"{base}/api/tags", timeout=2.8)
        if ok and isinstance(data, dict):
            ollama_online = True
            ollama_models = data.get("models") or []
            break
        elif not ok:
            ollama_err = str(data)[:200] if data else "timeout / connection refused"
    # Fallback: coba via CLI `ollama list` bila API tidak respons
    if not ollama_online:
        try:
            import subprocess, json as _json
            r = subprocess.run(["ollama", "list"], capture_output=True, text=True, timeout=3)
            if r.returncode == 0 and r.stdout.strip():
                ollama_online = True
                ollama_models = []
        except Exception as e:
            ollama_err = str(e)[:200]

    # LM Studio dihapus — selalu offline, biar frontend fokus Ollama saja
    lm_online = False
    lm_models: list[dict] = []
    lm_err = "LM Studio disabled — fokus Ollama (sesuai request)"

    preferred = "ollama" if ollama_online else None

    return {
        "ollama": {"online": ollama_online, "url": OLLAMA_URL, "models": ollama_models, "error": ollama_err},
        "lmstudio": {"online": lm_online, "url": LMSTUDIO_URL, "models": lm_models, "error": lm_err},
        "preferred": preferred,
        "llm_dir": str(LLM_DIR),
        "ollama_dir": str(_ollama_dir()),
    }


@router.get("/categories")
async def list_categories():
    return {"categories": CATEGORIES, "quants": QUANTS, "sizes": SIZES}


# ------------------------------------------------------------------
# HF proxy: search
# ------------------------------------------------------------------

@router.get("/hf/search")
async def hf_search(
    q: str = Query("", alias="query"),
    category: str = Query("all"),
    quant: str = Query(""),
    size: str = Query("all"),
    sort: str = Query("downloads"),
    limit: int = Query(10, ge=1, le=60),
    skip: int = Query(0, ge=0),
    gguf_only: bool = Query(True),
):
    params: dict[str, str] = {}
    search_terms: list[str] = []
    if q:
        search_terms.append(q.strip())
    if category and category != "all":
        # map category to keyword
        cat_map = {
            "chat": "chat",
            "code": "code",
            "instruct": "instruct",
            "reasoning": "reasoning",
            "roleplay": "roleplay creative",
            "multilingual": "multilingual indonesian",
        }
        if category in cat_map:
            search_terms.append(cat_map[category])
    if quant:
        # validate
        if quant.upper() in [x.upper() for x in QUANTS]:
            search_terms.append(quant)
    if size and size != "all":
        s = next((x for x in SIZES if x["id"] == size), None)
        if s and "search" in s:
            search_terms.append(s["search"])
        else:
            search_terms.append(size)

    search = " ".join(search_terms).strip()
    if search:
        params["search"] = search
    params["limit"] = str(limit)
    if skip:
        params["skip"] = str(skip)
    # HF sort options: downloads, likes, lastModified
    sort_map = {"downloads": "downloads", "likes": "likes", "trending": "lastModified"}
    params["sort"] = sort_map.get(sort, "downloads")
    params["direction"] = "-1"
    # Penting: HF API tanpa full=false&config=false tidak mengembalikan siblings → gguf_files selalu 0
    # Tambahkan agar galeri bisa hitung GGUF dari siblings + tags (lihat debug: tanpa ini siblings=0)
    params["full"] = "false"
    params["config"] = "false"
    # GGUF hanya prioritas di galeri/filter — bukan filter eksklusif.
    # Jangan pakai filter=gguf yang akan menghilangkan non-GGUF; biarkan semua model
    # muncul dan nanti diurutkan GGUF di atas.
    # gguf_only dipakai sebagai flag "prioritaskan GGUF" untuk sorting di bawah.

    query_str = urllib.parse.urlencode(params)
    url = f"{HF_API}?{query_str}"

    data = _fetch_json(url, timeout=12)
    # data is list of models
    out: list[dict] = []
    for m in data if isinstance(data, list) else []:
        model_id = m.get("id") or m.get("modelId") or ""
        author = model_id.split("/")[0] if "/" in model_id else ""
        likes = m.get("likes") or 0
        downloads = m.get("downloads") or 0
        last_mod = m.get("lastModified") or m.get("createdAt") or ""
        tags: list[str] = m.get("tags") or []
        pipeline = m.get("pipeline_tag") or ""
        card = m.get("cardData") or {}
        desc = None
        if isinstance(card, dict):
            desc = card.get("description") or card.get("summary")
        # fallback to model id prettify
        siblings = m.get("siblings") or []
        gguf_files = [s for s in siblings if (s.get("rfilename") or "").lower().endswith(".gguf")]
        # quant list from gguf files
        quant_list = sorted(set(_quant_from_filename(s.get("rfilename", "")) for s in gguf_files))
        # file count sizes hint
        # estimate context length from tags/card if available
        ctx_hint = ""
        for t in tags:
            if "32k" in t.lower() or "32768" in t:
                ctx_hint = "32K"
                break
            if "16k" in t.lower():
                ctx_hint = "16K"
                break
        if not ctx_hint:
            ctx_hint = "4K–8K"

        # size hint from modelId or tags
        size_hint = ""
        for cand in ["70B", "34B", "30B", "13B", "7B", "8B", "3B", "1B"]:
            if cand.lower() in model_id.lower() or any(cand.lower() in t.lower() for t in tags):
                size_hint = cand
                break

        brief = _brief(desc)
        # ensure gguf-only when requested: skip if no gguf file and tags lack gguf but we already filtered; still double-check
        if gguf_only and not gguf_files and "gguf" not in [t.lower() for t in tags]:
            # some gguf models only tagged but no siblings listed (HF pagination); keep them
            pass

        # flag GGUF — untuk prioritas galeri, bukan filter eksklusif
        is_gguf = bool(gguf_files) or "gguf" in [t.lower() for t in tags]
        out.append(
            {
                "id": model_id,
                "author": author,
                "likes": likes,
                "downloads": downloads,
                "lastModified": last_mod,
                "tags": tags[:12],
                "pipeline_tag": pipeline,
                "description": brief,
                "gguf_files": len(gguf_files),
                "is_gguf": is_gguf,
                "quants": quant_list[:6],
                "size_hint": size_hint,
                "ctx_hint": ctx_hint,
                "private": m.get("private") or False,
                "siblings_preview": [s.get("rfilename") for s in gguf_files[:3]],
            }
        )

    # Prioritaskan GGUF di galeri bila flag aktif — jangan hilangkan non-GGUF,
    # cukup urutkan GGUF di atas (konsisten dengan permintaan "gguf hanya prioritas")
    if gguf_only:
        out.sort(key=lambda x: (0 if x.get("is_gguf") else 1, -x.get("downloads", 0)))

    return {"models": out, "query": {"search": search, "params": params, "url": url, "gguf_prioritized": gguf_only}}


@router.get("/hf/model/{repo_path:path}")
async def hf_model_detail(repo_path: str):
    repo = _safe_repo_id(repo_path)
    url = f"{HF_API}/{urllib.parse.quote(repo, safe='/')}"
    data = _fetch_json(url, timeout=12)
    model_id = data.get("id") or repo
    tags = data.get("tags") or []
    siblings = data.get("siblings") or []
    card = data.get("cardData") or {}
    desc = ""
    if isinstance(card, dict):
        desc = card.get("description") or card.get("summary") or ""
    # Full readme excerpt if available? cardData may have base
    # gguf files
    gguf_siblings = [s for s in siblings if (s.get("rfilename") or "").lower().endswith(".gguf")]
    files: list[dict] = []
    for s in gguf_siblings:
        fn = s.get("rfilename") or ""
        files.append(
            {
                "filename": fn,
                "quant": _quant_from_filename(fn),
                "rfilename": fn,
            }
        )
    # if no siblings but tags contain gguf, still allow generic
    # provide download urls
    for f in files:
        f["download_url"] = f"{HF_RESOLVE}/{repo}/resolve/main/{urllib.parse.quote(f['filename'])}"

    return {
        "id": model_id,
        "author": model_id.split("/")[0] if "/" in model_id else "",
        "tags": tags,
        "pipeline_tag": data.get("pipeline_tag"),
        "likes": data.get("likes"),
        "downloads": data.get("downloads"),
        "lastModified": data.get("lastModified"),
        "description": desc or _brief(None, 400),
        "cardData": card,
        "gguf_files": files,
        "all_siblings": len(siblings),
    }


# ------------------------------------------------------------------
# Local storage: list downloaded GGUFs
# ------------------------------------------------------------------

@router.get("/local")
async def local_models():
    items: list[dict] = []
    if LLM_DIR.is_dir():
        for repo_dir in LLM_DIR.iterdir():
            # repo_dir may be owner folder
            if repo_dir.is_dir():
                # handle owner/name nested
                for sub in repo_dir.iterdir():
                    if sub.is_dir():
                        # sub is repo name folder (owner/name)
                        for f in sub.iterdir():
                            if f.is_file() and f.suffix.lower() == ".gguf":
                                stat = f.stat()
                                rel = f.relative_to(LLM_DIR).as_posix()
                                repo = f"{repo_dir.name}/{sub.name}"
                                items.append(
                                    {
                                        "repo": repo,
                                        "filename": f.name,
                                        "path": str(f),
                                        "rel": rel,
                                        "size": stat.st_size,
                                        "size_human": _human(stat.st_size),
                                        "quant": _quant_from_filename(f.name),
                                    }
                                )
                    elif sub.is_file() and sub.suffix.lower() == ".gguf":
                        # flat fallback owner-name file? treat as repo_dir is file parent
                        stat = sub.stat()
                        items.append(
                            {
                                "repo": repo_dir.name,
                                "filename": sub.name,
                                "path": str(sub),
                                "rel": sub.relative_to(LLM_DIR).as_posix(),
                                "size": stat.st_size,
                                "size_human": _human(stat.st_size),
                                "quant": _quant_from_filename(sub.name),
                            }
                        )
        # also flat files directly under LLM_DIR
        for f in LLM_DIR.glob("*.gguf"):
            stat = f.stat()
            items.append(
                {
                    "repo": f.stem,
                    "filename": f.name,
                    "path": str(f),
                    "rel": f.relative_to(LLM_DIR).as_posix(),
                    "size": stat.st_size,
                    "size_human": _human(stat.st_size),
                    "quant": _quant_from_filename(f.name),
                }
            )
    # dedup by rel
    seen = set()
    uniq = []
    for it in items:
        if it["rel"] not in seen:
            seen.add(it["rel"])
            uniq.append(it)
    # sort by size desc
    uniq.sort(key=lambda x: x["size"], reverse=True)

    # runtime status inline
    return {"models": uniq, "count": len(uniq), "dir": str(LLM_DIR)}


def _human(n: int) -> str:
    if n >= 1024**3:
        return f"{n/1024**3:.2f} GB"
    if n >= 1024**2:
        return f"{n/1024**2:.0f} MB"
    if n >= 1024:
        return f"{n/1024:.0f} KB"
    return f"{n} B"


# ------------------------------------------------------------------
# Config persistence (ctx etc) — simple json keyed by repo or path
# ------------------------------------------------------------------

def _load_config() -> dict:
    try:
        if CONFIG_PATH.is_file():
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _save_config(cfg: dict) -> None:
    try:
        CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


@router.get("/config")
async def get_config(model: str = Query("")):
    cfg = _load_config()
    if model:
        return {"model": model, "config": cfg.get(model) or cfg.get("default") or _default_preset()}
    return {"config": cfg, "default": _default_preset()}


@router.post("/config")
async def save_config(payload: dict):
    # payload: { model, config: { ctx, temperature, ... , runtime }}
    model = (payload.get("model") or "default").strip()
    conf = payload.get("config") or {}
    # semua parameter llama.cpp / Ollama yang umum — whitelist lengkap
    allowed = {
        "ctx", "n_ctx", "n_batch", "n_threads", "n_gpu_layers", "gpu_layers",
        "main_gpu", "use_mmap", "use_mlock", "num_thread",
        "temperature", "top_k", "top_p", "min_p", "tfs_z", "typical_p",
        "repeat_penalty", "repeat_last_n", "presence_penalty", "frequency_penalty",
        "penalize_nl", "mirostat", "mirostat_tau", "mirostat_eta",
        "seed", "n_predict", "num_predict", "num_keep",
        "stop", "system_prompt", "runtime",
    }
    clean: dict[str, Any] = {}
    for k, v in conf.items():
        if k in allowed:
            clean[k] = v
    # normalisasi alias
    if "n_ctx" in clean and "ctx" not in clean:
        clean["ctx"] = clean.pop("n_ctx")
    if "n_gpu_layers" in clean and "gpu_layers" not in clean:
        clean["gpu_layers"] = clean.pop("n_gpu_layers")
    if "num_predict" in clean and "n_predict" not in clean:
        clean["n_predict"] = clean.pop("num_predict")
    # validasi rentang dasar
    try:
        if "ctx" in clean:
            c = int(clean["ctx"])
            clean["ctx"] = max(512, min(c, 131072))
        if "n_batch" in clean:
            clean["n_batch"] = max(32, min(int(clean["n_batch"]), 8192))
        if "n_threads" in clean:
            clean["n_threads"] = max(1, min(int(clean["n_threads"]), 64))
        if "temperature" in clean:
            clean["temperature"] = max(0, min(float(clean["temperature"]), 2))
        if "top_k" in clean:
            clean["top_k"] = max(0, min(int(clean["top_k"]), 200))
        if "top_p" in clean:
            clean["top_p"] = max(0, min(float(clean["top_p"]), 1))
        if "min_p" in clean:
            clean["min_p"] = max(0, min(float(clean["min_p"]), 1))
        if "tfs_z" in clean:
            clean["tfs_z"] = max(0, min(float(clean["tfs_z"]), 3.5))
        if "typical_p" in clean:
            clean["typical_p"] = max(0, min(float(clean["typical_p"]), 1))
        if "repeat_penalty" in clean:
            clean["repeat_penalty"] = max(0.5, min(float(clean["repeat_penalty"]), 2))
        if "repeat_last_n" in clean:
            clean["repeat_last_n"] = max(0, min(int(clean["repeat_last_n"]), 4096))
        if "presence_penalty" in clean:
            clean["presence_penalty"] = max(-2, min(float(clean["presence_penalty"]), 2))
        if "frequency_penalty" in clean:
            clean["frequency_penalty"] = max(-2, min(float(clean["frequency_penalty"]), 2))
        if "mirostat" in clean:
            clean["mirostat"] = max(0, min(int(clean["mirostat"]), 2))
        if "mirostat_tau" in clean:
            clean["mirostat_tau"] = max(0, min(float(clean["mirostat_tau"]), 10))
        if "mirostat_eta" in clean:
            clean["mirostat_eta"] = max(0, min(float(clean["mirostat_eta"]), 1))
        if "seed" in clean:
            clean["seed"] = int(clean["seed"])
        if "n_predict" in clean:
            clean["n_predict"] = max(-1, min(int(clean["n_predict"]), 131072))
        if "num_keep" in clean:
            clean["num_keep"] = max(0, min(int(clean["num_keep"]), 131072))
        if "gpu_layers" in clean:
            clean["gpu_layers"] = max(-1, min(int(clean["gpu_layers"]), 200))
        if "stop" in clean and isinstance(clean["stop"], list):
            clean["stop"] = [str(x)[:200] for x in clean["stop"][:16]]
        if "system_prompt" in clean and isinstance(clean["system_prompt"], str):
            clean["system_prompt"] = clean["system_prompt"][:4000]
    except Exception:
        pass
    cfg = _load_config()
    # merge dengan default supaya semua key tetap ada
    merged = {**_default_preset(), **(cfg.get(model) or {}), **clean}
    cfg[model] = merged
    _save_config(cfg)
    return {"model": model, "config": merged}


@router.delete("/config")
async def delete_config(model: str = Query("")):
    if not model:
        raise HTTPException(400, "model wajib")
    if model == "default":
        raise HTTPException(400, "Preset default tidak bisa dihapus")
    cfg = _load_config()
    if model not in cfg:
        raise HTTPException(404, f"Preset tidak ditemukan: {model}")
    del cfg[model]
    _save_config(cfg)
    return {"deleted": model}


def _default_preset() -> dict:
    return {
        "ctx": 4096,
        "n_batch": 512,
        "n_threads": 0,  # 0 = auto
        "gpu_layers": -1,  # -1 = auto / offload semua
        "use_mmap": True,
        "use_mlock": False,
        "temperature": 0.7,
        "top_k": 40,
        "top_p": 0.95,
        "min_p": 0.05,
        "tfs_z": 1.0,
        "typical_p": 1.0,
        "repeat_penalty": 1.1,
        "repeat_last_n": 64,
        "presence_penalty": 0.0,
        "frequency_penalty": 0.0,
        "penalize_nl": True,
        "mirostat": 0,
        "mirostat_tau": 5.0,
        "mirostat_eta": 0.1,
        "seed": -1,
        "n_predict": 512,
        "num_keep": 0,
        "stop": [],
        "system_prompt": "",
        "runtime": "auto",
    }


# ------------------------------------------------------------------
# Download jobs (GGUF streaming from HF)
# ------------------------------------------------------------------

@dataclass
class LlmJob:
    id: str
    repo: str
    filename: str
    dest: str = ""
    status: str = "queued"  # queued | running | done | error
    progress: float = 0.0
    done_bytes: int = 0
    total_bytes: int = 0
    error: Optional[str] = None
    log: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    _rate: float = 0.0
    _last_done: int = 0
    _last_t: float = 0.0
    _finished: bool = False
    _stop: bool = False


_lock = threading.Lock()
_jobs: dict[str, LlmJob] = {}
_counter = 0


def _next_id() -> str:
    global _counter
    with _lock:
        _counter += 1
        return f"llm-{_counter:04d}"


def _download_thread(job: LlmJob):
    url = f"{HF_RESOLVE}/{job.repo}/resolve/main/{urllib.parse.quote(job.filename)}"
    dest = Path(job.dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    job.log.append(f"Mengunduh {job.repo}/{job.filename}")
    job.log.append(f"URL: {url}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Waves/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            total = resp.getheader("Content-Length")
            try:
                job.total_bytes = int(total) if total else 0
            except Exception:
                job.total_bytes = 0
            job.status = "running"
            chunk = 1024 * 256
            done = 0
            last_t = time.time()
            last_done = 0
            rate = 0.0
            with open(tmp, "wb") as out:
                while True:
                    if job._stop:
                        raise RuntimeError("Dibatalkan pengguna")
                    buf = resp.read(chunk)
                    if not buf:
                        break
                    out.write(buf)
                    done += len(buf)
                    now = time.time()
                    dt = now - last_t
                    if dt >= 0.4:
                        inst = (done - last_done) / dt if dt > 0 else 0
                        rate = inst if rate == 0 else rate * 0.6 + inst * 0.4
                        job._rate = rate
                        job.done_bytes = done
                        if job.total_bytes:
                            job.progress = round(100 * done / job.total_bytes, 1)
                        else:
                            job.progress = min(99.0, job.progress + 0.5)
                        last_t = now
                        last_done = done
                    else:
                        job.done_bytes = done
                        if job.total_bytes:
                            job.progress = round(100 * done / job.total_bytes, 1)
            # finalize
            tmp.rename(dest)
            job.done_bytes = done
            job.total_bytes = job.total_bytes or done
            job.progress = 100.0
            job.status = "done"
            job._finished = True
            job.log.append(f"Selesai: {dest.name} ({_human(done)})")
    except Exception as e:
        job.error = str(e)[:800]
        job.status = "error"
        job._finished = True
        job.log.append(f"Gagal: {e}")
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass
    finally:
        job._finished = True


def _payload(job: LlmJob, interpolate: bool = True) -> dict:
    # copy under lock
    with _lock:
        snap = asdict(job)
        # remove private
        snap.pop("_rate", None)
        snap.pop("_last_done", None)
        snap.pop("_last_t", None)
        snap.pop("_stop", None)
        snap.pop("_finished", None)
        snap["job_id"] = snap["id"]
        rate = job._rate
        done = job.done_bytes
        total = job.total_bytes
        status = job.status
        prog = job.progress
    if interpolate and status == "running" and rate > 0 and done < total and total > 0:
        # simple interpolation not needed heavy; keep as is
        pass
    # human sizes
    snap["done_human"] = _human(done) if done else "0 B"
    snap["total_human"] = _human(total) if total else "—"
    snap["rate_human"] = f"{_human(int(rate))}/s" if rate > 0 else None
    if total and rate > 0:
        remain = max(total - done, 0)
        snap["eta_seconds"] = remain / rate if rate else None
    else:
        snap["eta_seconds"] = None
    snap["rate_bps"] = rate if rate else None
    return snap


@router.post("/download")
async def start_download(payload: dict):
    repo = (payload.get("repoId") or payload.get("repo") or "").strip()
    raw_filename = (payload.get("filename") or "").strip()
    dest = _dest_for(repo, raw_filename)
    repo, filename = dest.parent.name, dest.name
    # dedup: if same active job exists, return it
    with _lock:
        for j in _jobs.values():
            if j.repo == repo and j.filename == filename and not j._finished:
                return {"job_id": j.id, "status": j.status}
    job = LlmJob(id=_next_id(), repo=repo, filename=filename, dest=str(dest))
    with _lock:
        _jobs[job.id] = job
    th = threading.Thread(target=_download_thread, args=(job,), daemon=True)
    th.start()
    return {"job_id": job.id, "repo": repo, "filename": filename}


@router.get("/download/jobs")
async def list_download_jobs():
    with _lock:
        vals = list(_jobs.values())
    # newest first
    vals.sort(key=lambda j: j.created_at, reverse=True)
    return {"jobs": [_payload(j, interpolate=False) for j in vals[:30]]}


@router.get("/download/jobs/{job_id}")
async def get_download_job(job_id: str):
    with _lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job tidak ditemukan")
    return _payload(job, interpolate=False)


@router.get("/download/jobs/{job_id}/stream")
async def stream_download_job(job_id: str):
    with _lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job tidak ditemukan")

    async def gen():
        yield "retry: 1000\n\n"
        while True:
            snap = _payload(job, interpolate=True)
            yield f"data: {json.dumps(snap)}\n\n"
            if snap["status"] in ("done", "error"):
                break
            await asyncio.sleep(0.6)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"
    })


@router.post("/download/jobs/{job_id}/stop")
async def stop_download_job(job_id: str):
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job tidak ditemukan")
        job._stop = True
    return {"job_id": job_id, "status": "stopping"}


@router.delete("/local/{repo_path:path}")
async def delete_local(repo_path: str, filename: str = Query("")):
    dest = _dest_for(repo_path, filename or "")
    try:
        resolved = dest.resolve()
        if not resolved.is_file() or LLM_DIR.resolve() not in resolved.parents:
            raise OSError("not a regular file under LLM_DIR")
        resolved.unlink()
        return {"deleted": str(resolved.relative_to(LLM_DIR))}
    except OSError:
        raise HTTPException(404, "File tidak ditemukan")


# ------------------------------------------------------------------
# Ollama staging → export (konsep: storage/llm dulu, baru export ke ~/.ollama)
# ------------------------------------------------------------------

def _sanitize_model_name(name: str) -> str:
    s = re.sub(r"[^a-z0-9._-]+", "-", name.lower()).strip("-")
    return s[:64] or "model"

def _preset_to_modelfile_params(preset: dict) -> list[str]:
    lines: list[str] = []
    # Ollama Modelfile PARAMETER mapping
    mapping = {
        "ctx": "num_ctx",
        "n_ctx": "num_ctx",
        "temperature": "temperature",
        "top_k": "top_k",
        "top_p": "top_p",
        "min_p": "min_p",
        "repeat_penalty": "repeat_penalty",
        "repeat_last_n": "repeat_last_n",
        "seed": "seed",
        "n_predict": "num_predict",
        "num_predict": "num_predict",
        "stop": "stop",
        "num_keep": "num_keep",
    }
    for k, v in preset.items():
        param = mapping.get(k)
        if not param:
            continue
        if k == "stop" and isinstance(v, list):
            for s in v:
                if s:
                    lines.append(f'PARAMETER stop "{s}"')
        elif k in ("ctx", "n_ctx", "top_k", "repeat_last_n", "seed", "num_keep", "n_predict", "num_predict"):
            try:
                lines.append(f"PARAMETER {param} {int(v)}")
            except Exception:
                pass
        elif isinstance(v, float) or isinstance(v, int):
            lines.append(f"PARAMETER {param} {v}")
    return lines

@router.get("/ollama/modelfile")
async def ollama_modelfile_preview(repo: str = Query(""), filename: str = Query(""), model: str = Query("")):
    if not repo or not filename:
        raise HTTPException(400, "repo dan filename wajib")
    dest = _dest_for(repo, filename)
    # cari file di staging
    cand = dest
    if not cand.is_file():
        cand = LLM_DIR / repo.replace("/", "_") / dest.name
    if not cand.is_file():
        raise HTTPException(404, f"File tidak ditemukan di staging: {repo}/{dest.name}. Unduh dulu via Jelajahi.")
    if not dest.name.lower().endswith(".gguf"):
        raise HTTPException(400, "Hanya .gguf yang bisa di-export ke Ollama. Untuk model non-GGUF, konversi dulu ke GGUF via llama.cpp (convert.py) lalu unduh file .gguf.")
    preset = {}
    if model:
        cfg = _load_config()
        preset = cfg.get(model) or cfg.get(repo) or {}
    else:
        cfg = _load_config()
        preset = cfg.get(repo) or {}
    params = _preset_to_modelfile_params(preset) if preset else []
    # default ctx jika belum ada
    if not any("num_ctx" in p for p in params):
        params.insert(0, "PARAMETER num_ctx 4096")
    lines = [f'FROM "{cand.resolve()}"']
    lines.extend(params)
    if preset.get("system_prompt"):
        # escape triple quotes
        sp = preset["system_prompt"].replace('"""', "''")
        lines.append(f'SYSTEM """{sp}"""')
    content = "\n".join(lines) + "\n"
    return {"modelfile": content, "from": str(cand.resolve()), "params": params, "ollama_dir": str(_ollama_dir())}

@router.post("/ollama/import")
async def ollama_import(payload: dict):
    repo = (payload.get("repo") or payload.get("repoId") or "").strip()
    filename = (payload.get("filename") or "").strip()
    model_name = (payload.get("model") or payload.get("name") or "").strip()
    if not repo or not filename:
        raise HTTPException(400, "repo dan filename wajib")
    dest = _dest_for(repo, filename)
    if not dest.name.lower().endswith(".gguf"):
        raise HTTPException(400, "Hanya .gguf yang bisa di-export ke Ollama. Konversi ke GGUF dulu (gunakan llama.cpp convert).")
    # sanitize model_name untuk ollama (lowercase, no slash)
    if not model_name:
        model_name = _sanitize_model_name(f"{repo.split('/')[-1]}-{dest.name.replace('.gguf','')}")
    else:
        model_name = _sanitize_model_name(model_name)
    cand = dest
    if not cand.is_file():
        raise HTTPException(404, f"File tidak ditemukan di staging: {repo}/{dest.name}")
    # ambil preset
    cfg = _load_config()
    preset = cfg.get(repo) or cfg.get(model_name) or cfg.get("default") or _default_preset()
    # build Modelfile di temp
    import tempfile, subprocess, os
    modelfile_content = (await ollama_modelfile_preview(repo, filename, repo))["modelfile"]
    # cek ollama tersedia
    try:
        r = subprocess.run(["ollama", "list"], capture_output=True, text=True, timeout=3)
        if r.returncode != 0 and "not recognized" in (r.stderr or "").lower():
            raise FileNotFoundError("ollama CLI tidak ditemukan di PATH")
    except FileNotFoundError:
        raise HTTPException(503, "Ollama belum terpasang di sistem. Install dari https://ollama.com/download lalu jalankan `ollama serve`. File tetap aman di staging storage/llm.")
    except Exception as e:
        raise HTTPException(503, f"Ollama tidak merespons: {e}")
    # tulis Modelfile temp
    with tempfile.TemporaryDirectory() as td:
        mf = Path(td) / "Modelfile"
        mf.write_text(modelfile_content, encoding="utf-8")
        # jalankan ollama create
        try:
            proc = subprocess.run(["ollama", "create", model_name, "-f", str(mf)], capture_output=True, text=True, timeout=300)
        except subprocess.TimeoutExpired:
            raise HTTPException(504, "Ollama create timeout (model besar, coba tunggu beberapa menit lalu cek `ollama list`)")
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or "")[:1200]
            raise HTTPException(500, f"ollama create gagal: {detail}")
    # verifikasi ada di ollama list
    return {"imported": model_name, "modelfile": modelfile_content, "ollama_dir": str(_ollama_dir()), "from": str(cand.resolve())}


# ------------------------------------------------------------------
# GGUF conversion helper (staging → GGUF) — konsep bagus
# ------------------------------------------------------------------

def _convert_script_path() -> Path | None:
    # Cari script convert llama.cpp di beberapa lokasi umum
    candidates = [
        PROJECT_ROOT / "vendor" / "llama" / "convert_hf_to_gguf.py",
        PROJECT_ROOT / "vendor" / "llama" / "tools" / "convert_hf_to_gguf.py",
        PROJECT_ROOT / "vendor" / "llama" / "convert.py",
        PROJECT_ROOT / "tools" / "convert_hf_to_gguf.py",
        PROJECT_ROOT / "scripts" / "convert_to_gguf.py",
        Path(__file__).parent / "tools" / "convert_hf_to_gguf.py",
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None

# --- clone / setup job untuk llama.cpp (agar bisa jalan lokal tanpa manual git clone) ---
_clone_lock = threading.Lock()
_clone_job: dict[str, Any] = {"status": "idle", "progress": 0, "log": [], "error": None, "done": False}  # idle | running | done | error

def _clone_log(msg: str):
    with _clone_lock:
        _clone_job["log"].append(msg)
        if len(_clone_job["log"]) > 80:
            _clone_job["log"] = _clone_job["log"][-80:]

def _do_clone_llama_cpp():
    with _clone_lock:
        if _clone_job["status"] == "running":
            return
        _clone_job.update({"status": "running", "progress": 5, "error": None, "done": False, "log": []})
    _clone_log("Mulai setup llama.cpp untuk konversi lokal…")
    dest = PROJECT_ROOT / "vendor" / "llama"
    script = _convert_script_path()
    if script and script.is_file():
        with _clone_lock:
            _clone_job.update({"status": "done", "progress": 100, "done": True})
        _clone_log(f"Sudah tersedia: {script}")
        return
    # Coba git clone --depth 1
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        # sudah ada folder tapi script belum ketemu — mungkin partial, coba lanjutkan
        _clone_log(f"Folder sudah ada: {dest} — cek script…")
    else:
        _clone_log("Menjalankan: git clone --depth 1 https://github.com/ggerganov/llama.cpp")
        try:
            import subprocess
            # cek git tersedia
            with _clone_lock:
                _clone_job["progress"] = 10
            proc = subprocess.run(
                ["git", "clone", "--depth", "1", "https://github.com/ggerganov/llama.cpp", str(dest)],
                capture_output=True, text=True, timeout=180,
            )
            if proc.returncode == 0:
                _clone_log("git clone berhasil.")
                with _clone_lock:
                    _clone_job["progress"] = 70
            else:
                _clone_log(f"git clone gagal (code {proc.returncode}): {(proc.stderr or proc.stdout)[:800]}")
                # fallback ke download raw file
                raise RuntimeError("git clone gagal, fallback ke download file")
        except Exception as e:
            _clone_log(f"git clone error: {e} — fallback download raw convert script…")
            # Fallback: download single file via urllib
            try:
                dest.mkdir(parents=True, exist_ok=True)
                # coba beberapa URL (master/main, root vs tools)
                urls = [
                    "https://raw.githubusercontent.com/ggerganov/llama.cpp/master/convert_hf_to_gguf.py",
                    "https://raw.githubusercontent.com/ggerganov/llama.cpp/master/tools/convert_hf_to_gguf.py",
                    "https://raw.githubusercontent.com/ggerganov/llama.cpp/main/convert_hf_to_gguf.py",
                ]
                saved = None
                for url in urls:
                    try:
                        _clone_log(f"Download {url} …")
                        req = urllib.request.Request(url, headers={"User-Agent": "Waves/1.0"})
                        with urllib.request.urlopen(req, timeout=20) as resp:
                            data = resp.read()
                            if len(data) < 5000:
                                continue
                            out_path = dest / "convert_hf_to_gguf.py"
                            out_path.write_bytes(data)
                            _clone_log(f"Tersimpan {out_path} ({len(data)} bytes)")
                            saved = out_path
                            break
                    except Exception as fe:
                        _clone_log(f"Gagal {url}: {fe}")
                        continue
                # juga coba unduh gguf.py helper jika diperlukan
                if saved and not saved.is_file():
                    raise RuntimeError("download fallback gagal")
                # download gguf package helper (opsional)
                with _clone_lock:
                    _clone_job["progress"] = 75
            except Exception as fe:
                with _clone_lock:
                    _clone_job.update({"status": "error", "error": str(fe)[:600]})
                _clone_log(f"Fallback download gagal: {fe}")
                return
    # Verifikasi script ada
    script = _convert_script_path()
    if script and script.is_file():
        _clone_log(f"Script tersedia: {script}")
        # Coba install deps minimal (gguf) agar convert bisa jalan lokal — best-effort, tidak fatal jika gagal
        try:
            import subprocess, sys
            _clone_log("Cek pip package 'gguf' untuk convert…")
            with _clone_lock:
                _clone_job["progress"] = 85
            # cek already installed
            import importlib.util
            if importlib.util.find_spec("gguf") is None:
                _clone_log("Install gguf via pip…")
                subprocess.run([sys.executable, "-m", "pip", "install", "gguf", "--quiet"], capture_output=True, text=True, timeout=120)
                _clone_log("pip install gguf selesai (atau di-skip).")
            else:
                _clone_log("gguf sudah terinstall.")
        except Exception as e:
            _clone_log(f"pip install gguf skip/error: {e}")
        with _clone_lock:
            _clone_job.update({"status": "done", "progress": 100, "done": True})
        _clone_log("Setup llama.cpp selesai — siap pakai untuk Install & Konversi lokal.")
    else:
        with _clone_lock:
            _clone_job.update({"status": "error", "error": "Script convert_hf_to_gguf.py masih tidak ditemukan setelah setup"})
        _clone_log("ERROR: script masih tidak ditemukan. Coba manual: git clone https://github.com/ggerganov/llama.cpp vendor/llama")

@router.get("/convert/status")
async def convert_status():
    script = _convert_script_path()
    # cek juga apakah `python -m llama_cpp` atau `llama-cpp-python` tersedia
    has_llama_cpp = False
    try:
        import importlib.util
        has_llama_cpp = importlib.util.find_spec("llama_cpp") is not None
    except Exception:
        pass
    with _clone_lock:
        clone_snap = dict(_clone_job)
    return {
        "available": script is not None,
        "script": str(script) if script else None,
        "has_llama_cpp": has_llama_cpp,
        "staging": str(LLM_DIR),
        "ollama_dir": str(_ollama_dir()),
        "hint": "Taruh convert_hf_to_gguf.py dari llama.cpp di vendor/llama/ atau tools/. Jika tidak ada, klik Setup llama.cpp (otomatis clone ke vendor/llama) atau cukup unduh model versi GGUF langsung dari HF (sudah terkonversi upstream) — tidak perlu konversi lokal.",
        "setup": clone_snap,
    }

@router.post("/convert/setup")
async def convert_setup():
    with _clone_lock:
        if _clone_job["status"] == "running":
            return {"status": "running", "progress": _clone_job["progress"], "log": _clone_job["log"][-20:], "hint": "Setup sedang berjalan…"}
        # jika sudah done dan script ada, tidak perlu clone lagi
        script = _convert_script_path()
        if script and script.is_file() and _clone_job["status"] == "done":
            return {"status": "done", "progress": 100, "script": str(script), "hint": "Sudah siap."}
    th = threading.Thread(target=_do_clone_llama_cpp, daemon=True)
    th.start()
    return {"status": "running", "progress": 5, "hint": "Setup dimulai — clone llama.cpp di background…"}

@router.get("/convert/setup/status")
async def convert_setup_status():
    with _clone_lock:
        snap = dict(_clone_job)
    script = _convert_script_path()
    snap["script"] = str(script) if script else None
    snap["available"] = script is not None
    return snap

@router.post("/convert")
async def convert_to_gguf(payload: dict):
    repo = (payload.get("repo") or "").strip()
    # repo bisa folder HF yang sudah di-download sebagai snapshot (safetensors)
    if not repo:
        raise HTTPException(400, "repo wajib (owner/name)")
    _safe_repo_id(repo)
    script = _convert_script_path()
    if not script:
        raise HTTPException(
            501,
            "Convert script belum tersedia. Konsep terbaik: staging di server/storage/llm dulu, lalu jika model masih safetensors, konversi via llama.cpp vendor/llama/convert_hf_to_gguf.py. "
            "Untuk sekarang, cukup unduh varian GGUF yang sudah tersedia di HF (mis. TheBloke/*-GGUF) — tidak perlu konversi lokal. "
            "Jika ingin konversi lokal, clone https://github.com/ggerganov/llama.cpp ke vendor/llama lalu jalankan convert.",
        )
    # A01: _safe_repo_id sudah menolak "..", jadi LLM_DIR/<repo> aman.
    src = LLM_DIR / _safe_repo_id(repo)
    if not src.is_dir():
        raise HTTPException(404, f"Folder staging tidak ditemukan: {repo}. Unduh dulu atau taruh snapshot HF di {src}")
    import subprocess, tempfile
    out = src / f"{repo.split('/')[-1]}.gguf"
    try:
        proc = subprocess.run(
            ["python", str(script), str(src), "--outfile", str(out), "--outtype", "q4_k_m"],
            capture_output=True, text=True, timeout=1800,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Konversi timeout (model besar). Cek log.")
    if proc.returncode != 0:
        raise HTTPException(500, f"Konversi gagal: {(proc.stderr or proc.stdout)[:1500]}")
    if not out.is_file():
        raise HTTPException(500, "Konversi selesai tapi file GGUF tidak ditemukan.")
    return {"converted": str(out.relative_to(LLM_DIR)), "size": out.stat().st_size, "size_human": _human(out.stat().st_size)}
