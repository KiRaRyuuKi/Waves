from __future__ import annotations

import shutil
import threading
import uuid
import logging

logging.getLogger("numba").setLevel(logging.WARNING)
audit_logger = logging.getLogger("audit")
audit_logger.setLevel(logging.INFO)

import time
from collections import defaultdict
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi import FastAPI, File, HTTPException, Request, UploadFile, Form

from . import devices
from .jobs import Job, JobStatus, store
from .coder import router as coder_router
from .image import router as image_router
from .downloader import router as downloader_router
from .separator import OUTPUT_ROOT, STORAGE_ROOT, run_separation, stem_file_path
from .uploads import AUDIO_SUFFIXES, MAX_AUDIO_UPLOAD, copy_limited, safe_suffix
from .setup import router as setup_router
from .training import router as training_router
from .video import router as video_router
from .voice import router as voice_router
from .llm import router as llm_router
from .remover import router as remover_router

app = FastAPI(title="Waves API")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3095", "http://127.0.0.1:3095"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # HSTS is applied even for local development; it is safe for localhost.
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# A01/CSRF: backend ini tanpa autentikasi dan hanya diikat ke loopback, jadi
# proteksinya berasal dari CORS. Tapi CORS hanya governs browser; request dari
# proses lokal atau CLI tidak punya Origin. Endpoint yang mengubah state tetap
# butuh verifikasi Origin agar tidak bisa dipicu dari halaman web_scheme:// lain
# (mis. form POST dari situs mana pun ke 127.0.0.1:9035).
_ALLOWED_ORIGINS = {
    "http://localhost:3095",
    "http://127.0.0.1:3095",
}
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@app.middleware("http")
async def origin_guard(request: Request, call_next):
    if request.method not in _SAFE_METHODS:
        origin = request.headers.get("origin")
        if origin is not None and origin not in _ALLOWED_ORIGINS:
            return JSONResponse(
                status_code=403, content={"detail": "Origin tidak diizinkan"}
            )
    return await call_next(request)


# A04: IP-based in-memory rate limiting for local deployment without authentication.
_rate_store: dict[str, list[float]] = defaultdict(list)
_rate_lock = threading.Lock()
_RATE_WINDOW = 60.0
_RATE_MAX = 20
_RATE_MAX_TRACKED_IPS = 4096

# Endpoint yang mahal (GPU/CPU_bound, subprocess, unduhan, atau spawn proses).
# Semua harus ikut rate limit, bukan hanya yang sudah ada di daftar awal.
_RATE_LIMITED_PREFIXES = (
    "/api/jobs",
    "/api/generate",
    "/api/video/generate",
    "/api/coder",
    "/api/setup/tasks",
    "/api/downloader",
    "/api/llm/download",
    "/api/voice/synthesize",
    "/api/remover/remove",
    "/api/training",
    "/api/jobs/retry",
)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    path = request.url.path
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and path.startswith(_RATE_LIMITED_PREFIXES):
        ip = request.client.host if request.client else "unknown"
        now = time.time()
        with _rate_lock:
            # Batasi jumlah IP yang dilacak supaya dict tidak tumbuh tanpa batas.
            if ip not in _rate_store and len(_rate_store) >= _RATE_MAX_TRACKED_IPS:
                for stale_ip in list(_rate_store):
                    if now - (_rate_store[stale_ip][-1] if _rate_store[stale_ip] else 0) >= _RATE_WINDOW:
                        _rate_store.pop(stale_ip, None)
            lst = _rate_store[ip]
            lst[:] = [t for t in lst if now - t < _RATE_WINDOW]
            if len(lst) >= _RATE_MAX:
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests, please try again in a minute"},
                )
            lst.append(now)
    return await call_next(request)

app.include_router(voice_router)
app.include_router(training_router)
app.include_router(image_router)
app.include_router(video_router)
app.include_router(coder_router)
app.include_router(downloader_router)
app.include_router(setup_router)
app.include_router(llm_router)
app.include_router(remover_router)
app.include_router(devices.router)

UPLOAD_ROOT = STORAGE_ROOT / "uploads"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

ALLOWED_MODELS = {"htdemucs", "htdemucs_ft", "mdx_extra"}

@app.post("/api/jobs")
async def create_job(
    file: UploadFile = File(...),
    model: str = Form("htdemucs"),
    device: str = Form("auto"),
):
    if model not in ALLOWED_MODELS:
        raise HTTPException(400, f"Unknown model '{model}'")
    try:
        resolved_device = devices.resolve_device(device)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    job_id = uuid.uuid4().hex
    job_dir = UPLOAD_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    suffix = safe_suffix(file.filename, AUDIO_SUFFIXES, ".wav")
    # Persist using job_id as filename to ensure the Demucs output directory
    # (separated/<model>/<stem>/...) remains unique per upload and is not
    # overwritten by subsequent jobs.
    input_path = job_dir / f"{job_id}{suffix}"
    # A04: copy streaming dengan batas ukuran keras, bukan shutil.copyfileobj
    # tanpa limit yang bisa menghabiskan disk.
    try:
        copy_limited(file.file, input_path, MAX_AUDIO_UPLOAD)
    except HTTPException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise

    job = Job(id=job_id, model=model, original_filename=file.filename or "input", device=device)
    store.create(job)

    thread = threading.Thread(
        target=run_separation, args=(job_id, input_path, model, resolved_device), daemon=True
    )
    thread.start()

    return {"job_id": job_id}


@app.get("/api/jobs")
async def list_jobs(limit: int = 20):
    jobs = store.list(limit=max(1, min(limit, 100)))
    return [
        {
            "id": job.id,
            "status": job.status,
            "progress": job.progress,
            "stage": job.stage,
            "stems": job.stems,
            "error": job.error,
            "model": job.model,
            "device": job.device,
            "filename": job.original_filename,
            "created_at": job.created_at,
        }
        for job in jobs
    ]


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return {
        "id": job.id,
        "status": job.status,
        "progress": job.progress,
        "stage": job.stage,
        "stems": job.stems,
        "error": job.error,
        "model": job.model,
        "device": job.device,
        "filename": job.original_filename,
    }


@app.post("/api/jobs/{job_id}/retry")
async def retry_job(job_id: str):
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if job.status in (JobStatus.QUEUED, JobStatus.PROCESSING):
        raise HTTPException(409, "Job is still running")

    job_dir = UPLOAD_ROOT / job_id
    matches = list(job_dir.glob(f"{job_id}.*"))
    if not matches:
        raise HTTPException(404, "Original file not found")

    store.update(
        job_id,
        status=JobStatus.QUEUED,
        progress=0.0,
        stage="Waiting to start",
        stems=[],
        error=None,
    )

    try:
        resolved_device = devices.resolve_device(job.device)
    except ValueError as exc:
        store.update(job_id, status=JobStatus.ERROR, error=str(exc))
        raise HTTPException(400, str(exc)) from exc

    thread = threading.Thread(
        target=run_separation,
        args=(job_id, matches[0], job.model, resolved_device),
        daemon=True,
    )
    thread.start()
    return {"job_id": job.id}


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str, request: Request):
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if job.status in (JobStatus.QUEUED, JobStatus.PROCESSING):
        raise HTTPException(409, "Job is still running")

    job_dir = UPLOAD_ROOT / job_id
    if job_dir.is_dir():
        shutil.rmtree(job_dir, ignore_errors=True)

    if OUTPUT_ROOT.is_dir():
        for model_dir in OUTPUT_ROOT.iterdir():
            if model_dir.is_dir():
                shutil.rmtree(model_dir / job_id, ignore_errors=True)

    audit_logger.info(f"job.delete job_id={job_id} ip={request.client.host if request.client else 'unknown'}")
    store.delete(job_id)
    return {"deleted": job_id}


@app.get("/api/jobs/{job_id}/original")
async def get_original(job_id: str):
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    job_dir = UPLOAD_ROOT / job_id
    matches = list(job_dir.glob(f"{job_id}.*"))
    if not matches:
        raise HTTPException(404, "Original file not found")
    return FileResponse(matches[0])


@app.get("/api/jobs/{job_id}/stems/{stem}")
async def get_stem(job_id: str, stem: str):
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if job.status != JobStatus.DONE:
        raise HTTPException(409, "Job is not finished yet")
    if stem not in job.stems:
        raise HTTPException(404, f"Stem '{stem}' not available for this job")

    input_dir = UPLOAD_ROOT / job_id
    path = stem_file_path(job_id, job.model, stem)
    if not path.exists():
        raise HTTPException(404, "Stem file missing on disk")
    return FileResponse(path, media_type="audio/wav")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Jangan menelan HTTPException (404/400/etc) — biarkan handler bawaan FastAPI yang menangani.
    if isinstance(exc, HTTPException):
        raise exc
    from fastapi.exceptions import RequestValidationError
    from starlette.exceptions import HTTPException as StarletteHTTPException

    if isinstance(exc, (StarletteHTTPException, RequestValidationError)):
        raise exc
    # Do not expose traceback to clients; log server-side only (A05).
    logging.error(f"Unhandled error at {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "Internal server error, please try again later"})


@app.get("/api/health")
async def health():
    return {"status": "ok"}
