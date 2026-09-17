from __future__ import annotations

import asyncio
import json
import re
import subprocess
import threading
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api/setup", tags=["setup"])

# Project root = parent dari folder server/.
SERVER_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SERVER_DIR.parent
SCRIPTS_DIR = PROJECT_ROOT / "scripts"

# Lokasi target penyimpanan (sama seperti di skrip PS1 + downloader).
TORCH_DIR = PROJECT_ROOT / "server" / "storage" / "torch"   # wheel torch+torchaudio (bersarang dalam whls/)
TINYSD_DIR = PROJECT_ROOT / "server" / "storage" / "diffusers" / "tiny-sd"
DIFFUSERS_DIR = PROJECT_ROOT / "server" / "storage" / "diffusers"
SD15_DIR = DIFFUSERS_DIR / "stable-diffusion-v1-5"
DREAMSHAPER_DIR = DIFFUSERS_DIR / "DreamShaper"

# Cache bobot Demucs (dibaca oleh torch.hub → separator.py). Disamakan
# dengan folder default torch hub di platform ini.
STEM_DIR = Path.home() / ".cache" / "torch" / "hub" / "checkpoints"

# Byte yang "diketahui" untuk menilai status tanpa menjalankan skrip.
# Total = jumlah ukuran file besar (yang dominan). File kecil ikut
# dihitung setelah benar-benar ditulis (ukuran aktualnya).
# torchaudio 2.11.0 (1519625) = versi yang tersedia di mirror Aliyun utk torch 2.14.0.
TORCH_TOTAL = 1519625 + 2602775157          # torchaudio + torch
TINYSD_TOTAL = (
    246187869 + 646923637 + 167407857       # text_encoder + unet + vae
)
# Estimasi ukuran pipeline diffusers (unet+vae+text_encoder) di cloud —
# dipakai utk total progres sebelum file benar2 ada di disk. Saat sudah
# terpasang, _task_state memakai ukuran aktualnya.
SD15_TOTAL = 4265380512                   # v1-5-pruned-emaonly.ckpt (safetensors 4265146304 dibulatkan)
DREAMSHAPER_TOTAL = 4265203904            # DreamShaper_4BakedVae-inpainting versi fp32

# File besar per-task (untuk check "sudah tuntas belum").
# Torch dicocokkan pakai pola awalan (versi bisa beda: 2.14.0, 2.11.0, dst).
TORCH_BIG = {
    "torchaudio-": 1519625,
    "torch-": 2602775157,
}
TINYSD_BIG = {
    "text_encoder/pytorch_model.bin": 246187869,
    "unet/diffusion_pytorch_model.bin": 646923637,
    "vae/diffusion_pytorch_model.bin": 167407857,
}

# Bobot Demucs (per-model) — nama persis file di cache torch hub.
# Hanya dihitung jika ukuran sudah pas dengan server (byte akurat).
STEM_HTDEMUCS = {
    "955717e8-8726e21a.th": 84141911,
}
STEM_HTDEMUCS_FT = {
    "f7e0c4bc-ba3fe64a.th": 84141271,
    "d12395a8-e57c48e6.th": 84141271,
    "92cfc3b6-ef3bcb9c.th": 84141271,
    "04573f0d-f3cf25b2.th": 84141271,
}
STEM_MDX_EXTRA = {
    "e51eebcc-c1b80bdd.th": 167399275,
    "a1d90b5c-ae9d2452.th": 167391595,
    "5d2d6c55-db83574e.th": 167391595,
    "cfa93e08-61801ae1.th": 167399275,
}

# Ukuran total per model Demucs (untuk progres & "installed").
STEM_HTDEMUCS_TOTAL = sum(STEM_HTDEMUCS.values())
STEM_HTDEMUCS_FT_TOTAL = sum(STEM_HTDEMUCS_FT.values())
STEM_MDX_EXTRA_TOTAL = sum(STEM_MDX_EXTRA.values())


# =====================================================================
#  Status task (di-derivasi dari disk, reflektif setiap GET)
# =====================================================================

def _len(path: Path) -> int:
    try:
        return path.stat().st_size if path.is_file() else 0
    except OSError:
        return 0


def _dir_bytes(directory: Path, rel_map: dict[str, int], glob_all: bool = False) -> int:
    """Jumlah byte di folder yang sudah benar (capped ke ukuran yang
    diketahui). Kalau glob_all, hitung semua file (untuk menentukan
    folder sudah "ada isi")."""
    total = 0
    for rel, expected in rel_map.items():
        f = directory / rel
        n = _len(f)
        total += min(n, expected)
    return total


def _dir_bytes_prefix(directory: Path, prefix_map: dict[str, int]) -> int:
    """Versi untuk file yang versinya bisa beda (mis. torch-2.14.0 vs
    torch-2.11.0): cari file di seluruh subfolder yang namanya diawali
    prefix, lalu cap ke ukuran yang diketahui per prefix."""
    total = 0
    if not directory.is_dir():
        return total
    for f in directory.rglob("*"):
        if not f.is_file():
            continue
        for prefix, expected in prefix_map.items():
            if f.name.startswith(prefix):
                total += min(_len(f), expected)
                break
    return total


def _task_state(task_id: str) -> dict:
    """Status singkat per task: apakah sudah terunduh / terpasang."""
    task = next((t for t in TASKS if t["id"] == task_id), None)
    if task is None:
        raise HTTPException(404, "Task tidak dikenal")

    check_dir = task.get("check_dir")
    if not check_dir or not check_dir.is_dir():
        return {
            "installed": False,
            "done_bytes": 0,
            "total_bytes": task.get("total_bytes", 0),
            "percent": 0.0,
        }

    known = task.get("total_bytes", 0)
    bigs = task.get("check_files", {})

    if task.get("auto_detect"):
        has_pipeline = (check_dir / "model_index.json").is_file()
        has_checkpoint = any(
            p for ext in (".safetensors", ".ckpt")
            for p in check_dir.glob(f"*{ext}")
        )
        total = sum(f.stat().st_size for f in check_dir.rglob("*") if f.is_file())
        if has_pipeline or has_checkpoint:
            return {
                "installed": True,
                "done_bytes": total,
                "total_bytes": total,
                "percent": 100.0,
            }
        return {
            "installed": False,
            "done_bytes": 0,
            "total_bytes": known,
            "percent": 0.0,
        }

    done = _dir_bytes(check_dir, bigs)
    percent = round(100.0 * done / known, 1) if known else 0.0
    installed = percent >= 100.0
    if task_id == "torch":
        done = _dir_bytes_prefix(check_dir, bigs)
        percent = round(100.0 * done / known, 1) if known else 0.0
        installed = percent >= 100.0
    return {"installed": installed, "done_bytes": done, "total_bytes": known, "percent": percent}


TASKS = [
    {
        "id": "tiny_sd",
        "name": "Model Tiny-SD (diffusers)",
        "description": "Model Stable Diffusion ringan dari HuggingFace "
        "(~1 GB) yang dipakai Image Generation.",
        "info": "Model AI teks-ke-gambar. Ringan & cepat, cocok untuk "
        "GPU 4 GB+. Paling cocok untuk pemula.",
        "script": "dl_model.ps1",
        "script_args": ["-RepoId", "segmind/tiny-sd"],
        "category": "model",
        "total_bytes": TINYSD_TOTAL,
        "check_dir": TINYSD_DIR,
        "check_files": TINYSD_BIG,
        "needs_python": False,
    },
    {
        "id": "sd15",
        "name": "Model Stable Diffusion 1.5",
        "description": "Model SD 1.5 standar industri dari HuggingFace (~4,3 GB).",
        "info": "Model paling populer di komunitas. Hasil bagus dan "
        "kompatibel dengan LoRA & ControlNet.",
        "script": "dl_model.ps1",
        "script_args": ["-RepoId", "runwayml/stable-diffusion-v1-5"],
        "category": "model",
        "total_bytes": SD15_TOTAL,
        "check_dir": SD15_DIR,
        "auto_detect": True,
        "needs_python": False,
    },
    {
        "id": "dreamshaper",
        "name": "Model DreamShaper 8",
        "description": "Fine-tune SD 1.5 untuk ilustrasi artistik (~3,7 GB).",
        "info": "Versi lebih detail dari SD 1.5. Unggul untuk ilustrasi, "
        "konsep art, dan fantasy.",
        "script": "dl_model.ps1",
        "script_args": ["-RepoId", "Lykon/DreamShaper"],
        "category": "model",
        "total_bytes": DREAMSHAPER_TOTAL,
        "check_dir": DREAMSHAPER_DIR,
        "auto_detect": True,
        "needs_python": False,
    },
    {
        "id": "stem_htdemucs",
        "name": "Stem Model — Standard (htdemucs)",
        "description": "Bobot Demucs standar untuk pemisahan stem "
        "(~80 MB) — cepat & pas untuk lagu umum.",
        "info": "Model bawaan Demucs. Memisahkan lagu jadi vocals, "
        "drums, bass & other. Kecepatan dan kualitas seimbang.",
        "script": "dl_stem.ps1",
        "script_args": ["-Model", "htdemucs"],
        "category": "stem",
        "total_bytes": STEM_HTDEMUCS_TOTAL,
        "check_dir": STEM_DIR,
        "check_files": STEM_HTDEMUCS,
        "needs_python": False,
    },
    {
        "id": "stem_htdemucs_ft",
        "name": "Stem Model — High Quality (htdemucs_ft)",
        "description": "Bobot Demucs fine-tuned untuk kualitas pemisahan "
        "lebih bersih (~320 MB, 4 sub-model).",
        "info": "Runs 4 sub-model sehingga hasil pemisahan lebih detail "
        "dan bersih, tapi butuh waktu lebih lama. Pilihan 'High Quality'.",
        "script": "dl_stem.ps1",
        "script_args": ["-Model", "htdemucs_ft"],
        "category": "stem",
        "total_bytes": STEM_HTDEMUCS_FT_TOTAL,
        "check_dir": STEM_DIR,
        "check_files": STEM_HTDEMUCS_FT,
        "needs_python": False,
    },
    {
        "id": "stem_mdx_extra",
        "name": "Stem Model — Alternative (mdx_extra)",
        "description": "Bobot MDX v2 untuk pemisahan stem model "
        "alternatif (~640 MB, 4 sub-model).",
        "info": "Arsitektur MDX-A. Cocok sebagai alternatif saat "
        "htdemucs kurang pas untuk jenis musik tertentu. Pilihan 'Alternative'.",
        "script": "dl_stem.ps1",
        "script_args": ["-Model", "mdx_extra"],
        "category": "stem",
        "total_bytes": STEM_MDX_EXTRA_TOTAL,
        "check_dir": STEM_DIR,
        "check_files": STEM_MDX_EXTRA,
        "needs_python": False,
    },
    {
        "id": "torch",
        "name": "PyTorch + Torchaudio (CUDA 12.6)",
        "description": "Wheel PyTorch CUDA 12.6 dari mirror Aliyun (~2,6 GB) "
        "untuk difusi & training. Bisa langsung dipasang ke Python tujuan "
        "supaya dipakai ulang tanpa unduh ulang.",
        "info": "Framework komputasi GPU dari NVIDIA. Dibutuhkan agar "
        "model AI bisa berjalan cepat di GPU. Bukan model gambar — ini runtime-nya.",
        "script": "dl_torch.ps1",
        "category": "runtime",
        "total_bytes": TORCH_TOTAL,
        "check_dir": TORCH_DIR,
        "check_files": TORCH_BIG,
        "needs_python": True,
    },
]


@router.get("/tasks")
async def list_tasks():
    """Daftar tugas setup lengkap dengan status tersimpan di disk."""
    result = []
    for t in TASKS:
        state = _task_state(t["id"])
        result.append(
            {
                "id": t["id"],
                "name": t["name"],
                "description": t["description"],
                "info": t.get("info", ""),
                "category": t["category"],
                "script": t["script"],
                "installed": state["installed"],
                "percent": state["percent"],
                "done_bytes": state["done_bytes"],
                "total_bytes": state["total_bytes"],
                "needs_python": t["needs_python"],
            }
        )
    return {"tasks": result}


# =====================================================================
#  Deteksi interpreter Python (untuk dropdown "install ke python")
# =====================================================================

def _suggested_pythons() -> list[str]:
    """Daftar python yang tersedia di sistem (py -0p + where python)."""
    found: list[str] = []
    seen: set[str] = set()

    try:
        out = subprocess.run(
            ["py", "-0p"], capture_output=True, text=True, timeout=10
        ).stdout
        for line in out.splitlines():
            m = re.search(r"\*?\s*((?:[A-Za-z]:)[\\/][^\s]+python\.exe)", line)
            if m:
                p = m.group(1).strip().strip("'\"").rstrip("\\")
                if p and p not in seen:
                    found.append(p)
                    seen.add(p)
    except (OSError, subprocess.SubprocessError):
        pass

    # venv lokal (yang paling sering dipakai backend Waves).
    for venv in (PROJECT_ROOT / ".venv", PROJECT_ROOT / "venv"):
        p = venv / "Scripts" / "python.exe"
        if p.is_file() and str(p) not in seen:
            found.insert(0, str(p))
            seen.add(str(p))

    # fallback where.exe
    if not found:
        try:
            out = subprocess.run(
                ["where.exe", "python"], capture_output=True, text=True, timeout=10
            ).stdout
            for p in out.splitlines():
                p = p.strip()
                if p.endswith("python.exe") and p not in seen:
                    found.append(p)
                    seen.add(p)
        except (OSError, subprocess.SubprocessError):
            pass

    return found


@router.get("/pythons")
async def list_pythons():
    out = []
    for p in _suggested_pythons():
        try:
            r = subprocess.run([p, "--version"], capture_output=True, text=True, timeout=5)
            ver = (r.stdout or r.stderr).strip().replace("Python ", "")
        except (OSError, subprocess.SubprocessError):
            ver = ""
        out.append({"path": p, "version": ver, "display": f"Python {ver} — {p}" if ver else p})
    return {"pythons": out}


# =====================================================================
#  Job runner (thread + subprocess, SSE)
# =====================================================================

@dataclass
class SetupJob:
    id: str
    task_id: str
    task_name: str = ""
    status: str = "queued"        # queued | running | done | error
    stage: str = "Menunggu mulai"
    progress: float = 0.0         # 0..100
    done_bytes: int = 0
    total_bytes: int = 0
    eta_seconds: Optional[float] = None
    error: Optional[str] = None
    log: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    # ------- internal -------
    _done_at_event: float = 0.0
    _bytes_at_event: int = 0
    _rate: float = 0.0
    _finished: bool = False


class SetupJobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, SetupJob] = {}
        self._lock = threading.Lock()

    def create(self, job: SetupJob) -> None:
        with self._lock:
            self._jobs[job.id] = job

    def get(self, job_id: str) -> Optional[SetupJob]:
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job_id: str, **fields) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            for k, v in fields.items():
                setattr(job, k, v)

    def snapshot(self, job: SetupJob) -> dict:
        with self._lock:
            return asdict(job)


store = SetupJobStore()

# Numero-curr job id.
_job_counter = 0
_job_lock = threading.Lock()


def _next_job_id() -> str:
    global _job_counter
    with _job_lock:
        _job_counter += 1
        return f"setup-{_job_counter:04d}"


# ---------------------------------------------------------------------
#  Thread yang menjalankan skrip PowerShell + mem-parse protokol WAVES.
# ---------------------------------------------------------------------

def _run_script(job: SetupJob, script: Path, args: list[str]) -> None:
    handle = subprocess.Popen(
        [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", str(script),
            *args,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(PROJECT_ROOT),
    )

    last_progress = 0.0
    for raw in handle.stdout:
        line = raw.rstrip("\r\n")
        if not line:
            continue
        if line.startswith("WAVES:"):
            _handle_waves(job, line[6:])
        else:
            # output bebas (curl dll) — jadikan log, tapi jangan spam.
            job_log(job, line)
        last_progress = time.time()

    rc = handle.wait()
    with store._lock:
        if not job._finished:
            job.status = "error" if rc != 0 else "done"
            job.progress = 100.0 if rc == 0 else job.progress
            job._finished = True
            if rc != 0 and not job.error:
                job.error = f"Proses keluar dengan kode {rc}"


def _handle_waves(job: SetupJob, payload: str) -> None:
    """Interpret satu pesan protokol WAVES:<...>"""
    key, _, value = payload.partition(" ")
    value = value.strip()

    with store._lock:
        now = time.time()
        if key == "STAGE":
            job.stage = value
        elif key == "LOG":
            job.log.append(value)
        elif key == "PROGRESS":
            parts = value.split()
            if len(parts) == 2:
                try:
                    done, total = int(float(parts[0])), int(float(parts[1]))
                except ValueError:
                    return
                # hitung laju byte (sliding) → ETA
                dt = now - job._done_at_event
                if dt > 0:
                    job._rate = (done - job._bytes_at_event) / dt
                job._bytes_at_event = done
                job._done_at_event = now
                job.done_bytes = min(done, total)
                job.total_bytes = total
                if total > 0:
                    job.progress = round(100.0 * job.done_bytes / total, 1)
                    if job.done_bytes >= total:
                        job.progress = 99.0   # tunggu DONE utk 100
                if job._rate > 0:
                    remain = max(total - job.done_bytes, 0)
                    job.eta_seconds = remain / job._rate
        elif key == "ERROR":
            job.status = "error"
            job.error = value
            job._finished = True
        elif key == "DONE":
            job.status = "done"
            job.progress = 100.0
            job.eta_seconds = 0.0
            job._finished = True


def job_log(job: SetupJob, text: str) -> None:
    with store._lock:
        job.log.append(text)
        if len(job.log) > 200:
            del job.log[: len(job.log) - 200]


# ---------------------------------------------------------------------

def _script_for(task_id: str) -> Path:
    name = next((t["script"] for t in TASKS if t["id"] == task_id), None)
    if name is None:
        raise HTTPException(404, "Task tidak dikenal")
    script = SCRIPTS_DIR / name
    if not script.is_file():
        raise HTTPException(500, f"Skrip {name} tidak ditemukan di {SCRIPTS_DIR}")
    return script


@router.post("/tasks/{task_id}/run")
async def run_task(
    task_id: str,
    python_path: str | None = None,
    install: bool = False,
):
    """Mulai unduh & (opsional) install task. Untuk `torch`, beri
    `python_path` + `install=True` kalau mau wheels dipasang ke Python
    tujuan (system/venv) sehingga bisa dipanggil tanpa unduh ulang."""
    task = next((t for t in TASKS if t["id"] == task_id), None)
    if task is None:
        raise HTTPException(404, "Task tidak dikenal")

    script = _script_for(task_id)
    args: list[str] = task.get("script_args", []).copy()
    if task.get("needs_python"):
        # wheel torch punya opsi install ke python tujuan.
        args += ["-PythonPath", python_path or ""]
        if install:
            args += ["-Install"]

    job = SetupJob(
        id=_next_job_id(),
        task_id=task_id,
        task_name=task["name"],
        total_bytes=task["total_bytes"],
    )
    store.create(job)

    thread = threading.Thread(
        target=_run_script, args=(job, script, args), daemon=True
    )
    thread.start()

    # lampirkan thread-nya supaya bisa dicek selesai (best-effort).
    store.update(job.id, _thread=thread)

    return {"job_id": job.id, "task_id": task_id}


# ---------------------------------------------------------------------
#  SSE stream: percent + ETA + stage + log, untuk satu job.
# ---------------------------------------------------------------------

def _event_payload(job: SetupJob, interpolate: bool = True) -> dict:
    with store._lock:
        snap = asdict(job)
        rate = job._rate
        done = job.done_bytes
        total = job.total_bytes
        eta = job.eta_seconds
        status = job.status
        progress = job.progress

    # Interpolasi halus antara dua event PROGRESS agar bar terasa "live".
    if (interpolate and status == "running" and rate > 0 and done < total):
        now = time.time()
        dt = now - job._done_at_event
        if dt > 0:
            done = min(done + int(rate * dt), total)
            progress = round(100.0 * done / total, 1) if total else progress
            remain = total - done
            if rate > 0:
                eta = remain / rate
            snap["done_bytes"] = done
            snap["progress"] = progress
            snap["eta_seconds"] = eta

    snap.pop("_done_at_event", None)
    snap.pop("_bytes_at_event", None)
    snap.pop("_rate", None)
    snap.pop("_finished", None)
    snap.pop("_thread", None)
    return snap


async def _sse_stream(job_id: str):
    job = store.get(job_id)
    if job is None:
        yield 'data: {"error": "Job tidak ditemukan"}\n\n'
        return
    yield "retry: 1500\n\n"
    while True:
        payload = _event_payload(job)
        yield f"data: {json.dumps(payload)}\n\n"
        if job.status in ("done", "error"):
            break
        await asyncio.sleep(0.5)


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "Job tidak ditemukan")
    return _event_payload(job, interpolate=False)


@router.get("/jobs/{job_id}/stream")
async def stream_job(job_id: str):
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "Job tidak ditemukan")
    return StreamingResponse(
        _sse_stream(job_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
