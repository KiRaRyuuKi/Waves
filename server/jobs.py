"""In-memory job registry.

Kept intentionally simple (no external DB) since this is a single-user,
local-first tool. Swap for Redis/SQLite if you ever need multi-worker
scaling.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


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


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self, job: Job) -> None:
        with self._lock:
            self._jobs[job.id] = job

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


store = JobStore()
