"""Job registry persisted to a JSON snapshot + reconciled from disk.

Kept intentionally simple (no external DB) since this is a single-user,
local-first tool. Every create/update is mirrored to storage/jobs.json so
uploaded jobs stay accessible across server restarts. On startup we also
scan the uploads/ directory and reconstruct records for any job whose
files still exist on disk but are missing from the snapshot (e.g. created
by an older version that never persisted).
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

STORAGE_ROOT = Path(__file__).parent / "storage"
JOBS_FILE = STORAGE_ROOT / "jobs.json"
UPLOAD_ROOT = STORAGE_ROOT / "uploads"
SEPARATED_ROOT = STORAGE_ROOT / "separated"

MAX_RECENT = 50


class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    DONE = "done"
    ERROR = "error"


@dataclass
class Job:
    id: str
    model: str
    original_filename: str
    status: JobStatus = JobStatus.QUEUED
    progress: float = 0.0  # 0..100
    stage: str = "Waiting to start"
    stems: list[str] = field(default_factory=list)
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)


def _default_filename(job_dir: Path) -> str:
    """Best-effort original filename for a job directory whose record was
    rebuilt from disk (the real name is not stored anywhere else). Uploads
    disimpan sebagai <job_id>.<ext>, jadi ambil file pertama di folder."""
    files = sorted(f for f in job_dir.iterdir() if f.is_file())
    return files[0].name if files else job_dir.name


def _finish_from_disk(job: Job) -> None:
    """Mark a rebuilt job as done if separated output exists on disk."""
    if not SEPARATED_ROOT.is_dir():
        return
    # Upload disimpan sebagai <job_id>.<ext>, jadi stem-nya = job.id, dan
    # output separasi ada di separated/<model>/<job.id>/*.wav.
    input_stem = job.id
    for model_dir in sorted(SEPARATED_ROOT.iterdir()):
        if not model_dir.is_dir():
            continue
        track_dir = model_dir / input_stem
        wavs = sorted(p.stem for p in track_dir.glob("*.wav")) if track_dir.is_dir() else []
        if wavs:
            job.model = model_dir.name
            job.status = JobStatus.DONE
            job.stage = "Done"
            job.progress = 100.0
            job.stems = wavs
            return


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._load()
        self._reconcile()

    # --- JSON snapshot ---

    def _load(self) -> None:
        try:
            data = json.loads(JOBS_FILE.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return
        for item in data if isinstance(data, list) else []:
            try:
                job = Job(
                    id=item["id"],
                    model=item.get("model", "htdemucs"),
                    original_filename=item.get("original_filename", "input"),
                    status=JobStatus(item.get("status", JobStatus.ERROR.value)),
                    progress=float(item.get("progress", 0)),
                    stage=item.get("stage", ""),
                    stems=list(item.get("stems", [])),
                    error=item.get("error"),
                    created_at=float(item.get("created_at", 0)),
                )
            except (KeyError, ValueError):
                continue
            self._jobs[job.id] = job

    def _save(self) -> None:
        try:
            STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
            items = [asdict(job) for job in self._jobs.values()]
            JOBS_FILE.write_text(json.dumps(items, indent=2), encoding="utf-8")
        except OSError:
            # Persistence is best-effort for a local tool; never crash the
            # request path because the snapshot couldn't be written.
            pass

    # --- Disk reconciliation ---

    def _reconcile(self) -> None:
        """Rebuild records for uploads on disk that are missing from the
        snapshot, and fail stale non-terminal jobs (a server restart kills
        the separation subprocess, so they can never finish)."""
        with self._lock:
            for job_id in list(self._jobs):
                job = self._jobs[job_id]
                if job.status in (JobStatus.QUEUED, JobStatus.PROCESSING):
                    job.status = JobStatus.ERROR
                    job.stage = ""
                    job.error = "Proses dihentikan karena server dimulai ulang. Unggah kembali untuk mencoba."

            if UPLOAD_ROOT.is_dir():
                for job_dir in sorted(UPLOAD_ROOT.iterdir()):
                    if not job_dir.is_dir() or job_dir.name in self._jobs:
                        continue
                    if not any(f.is_file() for f in job_dir.iterdir()):
                        continue
                    job = Job(
                        id=job_dir.name,
                        model="htdemucs",
                        original_filename=_default_filename(job_dir),
                    )
                    _finish_from_disk(job)
                    if job.status is not JobStatus.DONE:
                        job.status = JobStatus.ERROR
                        job.error = "Proses tidak selesai (tidak ada output di disk)."
                    self._jobs[job.id] = job
        self._save()

    # --- CRUD ---

    def create(self, job: Job) -> None:
        with self._lock:
            self._jobs[job.id] = job
        self._save()

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job_id: str, **fields) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            for key, value in fields.items():
                setattr(job, key, value)
        self._save()

    def delete(self, job_id: str) -> Optional[Job]:
        with self._lock:
            job = self._jobs.pop(job_id, None)
        if job is not None:
            self._save()
        return job

    def list(self, limit: int = MAX_RECENT) -> list[Job]:
        with self._lock:
            jobs = sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)
            return jobs[:limit]


store = JobStore()