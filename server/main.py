from __future__ import annotations

import shutil
import threading
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .jobs import Job, JobStatus, store
from .separator import OUTPUT_ROOT, STORAGE_ROOT, run_separation, stem_file_path
from .training import router as training_router
from .voice import router as voice_router

app = FastAPI(title="Waves API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(voice_router)
app.include_router(training_router)

UPLOAD_ROOT = STORAGE_ROOT / "uploads"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

ALLOWED_MODELS = {"htdemucs", "htdemucs_ft", "mdx_extra"}


@app.post("/api/jobs")
async def create_job(file: UploadFile = File(...), model: str = Form("htdemucs")):
    if model not in ALLOWED_MODELS:
        raise HTTPException(400, f"Unknown model '{model}'")

    job_id = uuid.uuid4().hex
    job_dir = UPLOAD_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(file.filename or "input.wav").suffix or ".wav"
    # Simpan dengan nama = job_id supaya folder output demucs
    # (separated/<model>/<stem>/...) unik per-upload dan tidak tertimpa
    # oleh upload berikutnya — semua job tetap bisa dimuat lagi nanti.
    input_path = job_dir / f"{job_id}{suffix}"
    with input_path.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    job = Job(id=job_id, model=model, original_filename=file.filename or "input")
    store.create(job)

    thread = threading.Thread(target=run_separation, args=(job_id, input_path, model), daemon=True)
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
        "filename": job.original_filename,
    }


@app.post("/api/jobs/{job_id}/retry")
async def retry_job(job_id: str):
    """Jalankan ulang pemisahan untuk job yang gagal. File asli yang sudah
    tersimpan di disk dipakai lagi, jadi tidak perlu upload ulang."""
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

    thread = threading.Thread(
        target=run_separation, args=(job_id, matches[0], job.model), daemon=True
    )
    thread.start()
    return {"job_id": job.id}


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str):
    """Hapus job beserta file asli, hasil pemisahan, dan riwayatnya."""
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


@app.get("/api/health")
async def health():
    return {"status": "ok"}
