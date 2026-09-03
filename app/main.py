from __future__ import annotations

import shutil
import threading
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .jobs import Job, JobStatus, store
from .separator import STORAGE_ROOT, run_separation, stem_file_path

app = FastAPI(title="Music Stem Studio API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    input_path = job_dir / f"input{suffix}"
    with input_path.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    job = Job(id=job_id, model=model, original_filename=file.filename or "input")
    store.create(job)

    thread = threading.Thread(target=run_separation, args=(job_id, input_path, model), daemon=True)
    thread.start()

    return {"job_id": job_id}


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
    }


@app.get("/api/jobs/{job_id}/original")
async def get_original(job_id: str):
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    job_dir = UPLOAD_ROOT / job_id
    matches = list(job_dir.glob("input.*"))
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
    input_file = next(input_dir.glob("input.*"))
    path = stem_file_path(job_id, job.model, input_file.stem, stem)
    if not path.exists():
        raise HTTPException(404, "Stem file missing on disk")
    return FileResponse(path, media_type="audio/wav")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
