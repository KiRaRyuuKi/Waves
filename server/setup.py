from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api/setup", tags=["setup"])

# Project root is the parent of the server/ directory.
SERVER_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SERVER_DIR.parent
SCRIPTS_DIR = PROJECT_ROOT / "scripts"

# Target storage locations (consistent with PS1 script and downloader).
TORCH_DIR = PROJECT_ROOT / "server" / "storage" / "torch" 
GENERATE_DIR = PROJECT_ROOT / "server" / "storage" / "generate"
IMAGE_DIR = GENERATE_DIR / "image"
TINYSD_DIR = IMAGE_DIR / "tiny-sd"
DIFFUSERS_DIR = IMAGE_DIR  
SD15_DIR = IMAGE_DIR / "stable-diffusion"
DREAMSHAPER_DIR = IMAGE_DIR / "dream-shaper"

# Video models (Video Generation feature), see server/video.py.
VIDEO_DIR = GENERATE_DIR / "video"
ANIMATEDIFF_DIR = VIDEO_DIR / "animate-diff"
AD_MOTION_DIR = ANIMATEDIFF_DIR / "motion-adapter"
AD_CLIP_DIR = ANIMATEDIFF_DIR / "clip-vit-large"
WAN_DIR = VIDEO_DIR / "wan"

# Remover ONNX (Background Remover) — server/storage/remover/<model>/<model>.onnx
REMOVER_DIR = PROJECT_ROOT / "server" / "storage" / "remover"
U2NET_DIR = REMOVER_DIR / "u2net"
ISNET_DIR = REMOVER_DIR / "isnet"
SILUETA_DIR = REMOVER_DIR / "silueta"

# Cache bobot Demucs (dibaca oleh torch.hub → separator.py). Disamakan
# Aligned with the default torch hub directory on this platform.
STEM_DIR = Path.home() / ".cache" / "torch" / "hub" / "checkpoints"

# Known byte totals for progress estimation without running scripts.
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
SD15_TOTAL = 4265380512                     # v1-5-pruned-emaonly.ckpt (safetensors 4265146304 dibulatkan)
DREAMSHAPER_TOTAL = 4265203904              # DreamShaper_4BakedVae-inpainting versi fp32

# --- Model video (fitur Video Generation) ---
# AnimateDiff: motion adapter (v1-5-2, fp16) + CLIP vision (model.safetensors).
AD_MOTION_TOTAL = 1815329816
AD_CLIP_TOTAL = 1710540580
# Wan 2.1 T2V 1.3B (layout diffusers): text_encoder UMT5-XXL (~21,7 GB, 5 shard)
# + transformer (~5,4 GB) + vae (~0,5 GB) ≈ 27,6 GB. Angka estimasi — setelah
# terpasang, status memakai ukuran asli di disk (auto_detect).
WAN_TOTAL = 21670 * 1024 * 1024 + 5413 * 1024 * 1024 + 484 * 1024 * 1024

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

# Bobot Demucs (per-model), nama persis file di cache torch hub.
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

# Remover ONNX totals (dari server/storage/remover saat ini)
REMOVER_U2NET_TOTAL = 175997641
REMOVER_ISNET_TOTAL = 178648008
REMOVER_SILUETA_TOTAL = 44173029

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
    total = 0
    for rel, expected in rel_map.items():
        f = directory / rel
        n = _len(f)
        total += min(n, expected)
    return total


def _dir_bytes_prefix(directory: Path, prefix_map: dict[str, int]) -> int:
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
        known = task.get("total_bytes", 0)
        percent = round(100.0 * total / known, 1) if known else 0.0
        return {
            "installed": False,
            "done_bytes": total,
            "total_bytes": known,
            "percent": min(percent, 99.0) if total > 0 else 0.0,
        }

    # Special handling for AnimateDiff: check both safetensors variants (fp16 and full) for backward compatibility
    if task_id == "animate_diff":
        motion_main = check_dir / "motion-adapter" / "diffusion_pytorch_model.safetensors"
        motion_fp16 = check_dir / "motion-adapter" / "diffusion_pytorch_model.fp16.safetensors"
        clip_file = check_dir / "clip-vit-large" / "model.safetensors"
        # Count motion as installed if either file exists with correct size
        motion_done = 0
        if motion_main.is_file():
            motion_done = min(motion_main.stat().st_size, AD_MOTION_TOTAL)
        elif motion_fp16.is_file():
            motion_done = min(motion_fp16.stat().st_size, AD_MOTION_TOTAL)
        clip_done = min(clip_file.stat().st_size, AD_CLIP_TOTAL) if clip_file.is_file() else 0
        done = motion_done + clip_done
        percent = round(100.0 * done / known, 1) if known else 0.0
        installed = percent >= 100.0
        return {"installed": installed, "done_bytes": done, "total_bytes": known, "percent": percent}

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
        "name": "Tiny-SD",
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
        "name": "Stable Diffusion 1.5",
        "description": "Model SD 1.5 standar industri dari HuggingFace (~5,1 GB).",
        "info": "Model paling populer di komunitas. Hasil bagus dan "
        "kompatibel dengan LoRA & ControlNet.",
        "script": "dl_model.ps1",
        "script_args": [
            "-RepoId", "runwayml/stable-diffusion-v1-5",
            "-Folder", "stable-diffusion",
            "-Exclude", "*.bin,*.fp16.safetensors,*.non_ema.safetensors",
        ],
        "category": "model",
        "total_bytes": SD15_TOTAL,
        "check_dir": SD15_DIR,
        "auto_detect": True,
        "needs_python": False,
    },
    {
        "id": "dreamshaper",
        "name": "DreamShaper 8",
        "description": "Fine-tune SD 1.5 untuk ilustrasi artistik (~5,1 GB).",
        "info": "Versi lebih detail dari SD 1.5. Unggul untuk ilustrasi, "
        "konsep art, dan fantasy.",
        "script": "dl_model.ps1",
        "script_args": ["-RepoId", "Lykon/DreamShaper", "-Folder", "dream-shaper"],
        "category": "model",
        "total_bytes": DREAMSHAPER_TOTAL,
        "check_dir": DREAMSHAPER_DIR,
        "auto_detect": True,
        "needs_python": False,
    },
    {
        "id": "animate_diff",
        "name": "AnimateDiff",
        "description": "Model video AnimateDiff (~3,5 GB) — motion adapter + CLIP Vision untuk video pendek dari model SD 1.5.",
        "info": "Gabungan motion adapter (v1-5-2) dan CLIP Vision ViT-Large/14. Ringan & cepat, cocok untuk GPU 4 GB. Output 512x512, 16 frame. Folder: animate-diff/.",
        "script": "dl_model.ps1",
        "script_args": ["-RepoId", "animatediff-bundle"],
        "category": "model_video",
        "total_bytes": AD_MOTION_TOTAL + AD_CLIP_TOTAL,
        "check_dir": ANIMATEDIFF_DIR,
        "check_files": {
            "motion-adapter/diffusion_pytorch_model.safetensors": AD_MOTION_TOTAL,
            "clip-vit-large/model.safetensors": AD_CLIP_TOTAL,
        },
        "needs_python": False,
    },
    {
        "id": "wan_t2v_13b",
        "name": "Wan 2.1 T2V 1.3B",
        "description": "Model video Wan 2.1 dari Alibaba (~28 GB, "
        "layout diffusers). Kualitas gerak lebih baik dari AnimateDiff.",
        "info": "Butuh unduhan besar (~28 GB) & RAM 24 GB+. "
        "Pilih ini kalau ingin hasil video yang lebih natural.",
        "script": "dl_model.ps1",
        "script_args": [
            "-RepoId", "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
            "-Base", "server\\storage\\generate\\video",
            "-Folder", "wan",
            "-Exclude", "*.jpg,*.JPG,*.jpeg,*.png,*.md,.gitattributes",
        ],
        "category": "model_video",
        "total_bytes": WAN_TOTAL,
        "check_dir": WAN_DIR,
        "auto_detect": True,
        "needs_python": False,
    },
    {
        "id": "stem_htdemucs",
        "name": "Standard (htdemucs)",
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
        "name": "High Quality (htdemucs_ft)",
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
        "name": "Alternative (mdx_extra)",
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
        "id": "remover_u2net",
        "name": "U²-Net",
        "description": "Model U²-Net general-purpose untuk hapus background (~168 MB).",
        "info": "Paling stabil untuk foto produk & objek umum. Seimbang cepat & akurat.",
        "script": "dl_remover.ps1",
        "script_args": ["-Model", "u2net"],
        "category": "remover",
        "total_bytes": REMOVER_U2NET_TOTAL,
        "check_dir": U2NET_DIR,
        "check_files": {"u2net.onnx": REMOVER_U2NET_TOTAL},
        "needs_python": False,
    },
    {
        "id": "remover_isnet",
        "name": "ISNet General Use",
        "description": "Model ISNet detail tinggi untuk rambut/bulu/tepi halus (~170 MB).",
        "info": "Presisi tepi terbaik untuk rambut, bulu, dedaunan. Hasil paling detail.",
        "script": "dl_remover.ps1",
        "script_args": ["-Model", "isnet"],
        "category": "remover",
        "total_bytes": REMOVER_ISNET_TOTAL,
        "check_dir": ISNET_DIR,
        "check_files": {"isnet-general-use.onnx": REMOVER_ISNET_TOTAL},
        "needs_python": False,
    },
    {
        "id": "remover_silueta",
        "name": "Silueta",
        "description": "Model Silueta ringan untuk manusia full-body (~42 MB).",
        "info": "Varian U²-Net ringan khusus siluet manusia. Paling cepat untuk foto orang.",
        "script": "dl_remover.ps1",
        "script_args": ["-Model", "silueta"],
        "category": "remover",
        "total_bytes": REMOVER_SILUETA_TOTAL,
        "check_dir": SILUETA_DIR,
        "check_files": {"silueta.onnx": REMOVER_SILUETA_TOTAL},
        "needs_python": False,
    },
    {
        "id": "torch",
        "name": "PyTorch + Torchaudio (CUDA 12.6)",
        "description": "Wheel PyTorch CUDA 12.6 dari mirror Aliyun (~2,4 GB) "
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

# Log unduhan + berkas jejak job (supaya job bisa dipulihkan saat
# backend restart — proses unduhan yang masih hidup tetap terpantau).
WAVES_DIR = PROJECT_ROOT / ".waves"
WAVES_LOG_DIR = WAVES_DIR / "logs"
JOBS_FILE = WAVES_DIR / "jobs.json"


def _download_log(job_id: str) -> Path:
    return WAVES_LOG_DIR / f"download-{job_id}.log"


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
    _proc: Optional[subprocess.Popen] = None
    _stopped: bool = False
    _pid: int = 0                 # PID powershell/job (untuk deteksi yatim & taskkill)
    _monitor: bool = False        # True bila job dipulihkan (hanya bisa dipantau via PID+disk)


# --- persistensi jejak job (.waves/jobs.json) ---

def _load_jobs_file() -> list[dict]:
    try:
        if JOBS_FILE.is_file():
            data = json.loads(JOBS_FILE.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
    except (OSError, ValueError):
        pass
    return []


def _save_jobs_file(entries: list[dict]) -> None:
    try:
        WAVES_DIR.mkdir(parents=True, exist_ok=True)
        JOBS_FILE.write_text(json.dumps(entries), encoding="utf-8")
    except OSError:
        pass


def _persist_job(job: SetupJob) -> None:
    entries = _load_jobs_file()
    entries = [e for e in entries if e.get("id") != job.id]
    entries.append({
        "id": job.id,
        "task_id": job.task_id,
        "pid": job._pid,
        "created_at": job.created_at,
    })
    _save_jobs_file(entries)


def _unpersist_job(job_id: str) -> None:
    entries = [e for e in _load_jobs_file() if e.get("id") != job_id]
    _save_jobs_file(entries)


def _persist_waves(job: SetupJob, line: str) -> None:
    try:
        WAVES_LOG_DIR.mkdir(parents=True, exist_ok=True)
        with open(_download_log(job.id), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        import ctypes
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION, False, pid
        )
        if not handle:
            return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    except Exception:
        try:
            r = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True, text=True, timeout=5,
            )
            return f"\"{pid}\"" in r.stdout
        except (OSError, subprocess.SubprocessError):
            return False


def _kill_tree(pid: int) -> None:
    if pid <= 0:
        return
    try:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        pass


def _prime_job_from_log(job: SetupJob) -> None:
    try:
        lines = _download_log(job.id).read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        if line.startswith("WAVES:"):
            payload = line[6:]
            key, _, value = payload.partition(" ")
            if key == "STAGE":
                job.stage = value.strip()
            elif key == "PROGRESS":
                parts = value.split()
                if len(parts) == 2:
                    try:
                        job.done_bytes = int(float(parts[0]))
                        job.total_bytes = int(float(parts[1])) or job.total_bytes
                    except ValueError:
                        pass
            elif key == "LOG":
                job.log.append(value.strip())
            elif key == "ERROR":
                job.error = value.strip()
    if job.total_bytes > 0:
        job.progress = round(100.0 * job.done_bytes / job.total_bytes, 1)
    job.log = job.log[-200:]


def _monitor_orphan(job: SetupJob) -> None:
    last = 0.0
    last_done = job.done_bytes
    while _pid_alive(job._pid):
        time.sleep(1)
        if job._finished:
            return
        try:
            st = _task_state(job.task_id)
        except HTTPException:
            break
        with store._lock:
            now = time.time()
            total = st["total_bytes"] or job.total_bytes
            done = min(st["done_bytes"], total)
            if last and now > last:
                inst = (done - last_done) / (now - last)
                if inst > 0:
                    job._rate = inst if job._rate <= 0 else job._rate * 0.6 + inst * 0.4
            last, last_done = now, done
            job.done_bytes = done
            job.total_bytes = total
            if total > 0:
                job.progress = round(100.0 * done / total, 1)
                if job.progress >= 100.0:
                    job.progress = 99.0   # tunggu DONE / PID mati
            if job._rate >= 1024:
                job.eta_seconds = max(total - done, 0) / job._rate
            else:
                job.eta_seconds = None
    with store._lock:
        if job._finished:
            return
        job._finished = True
        job.status = "error" if job._stopped else "done"
        if job._stopped:
            job.error = "Dijeda pengguna"
            job.progress = min(job.progress, 99.0)
        else:
            job.progress = 100.0
            job.error = None
    _unpersist_job(job.id)


def _restore_jobs() -> None:
    global _job_counter
    max_counter = _job_counter
    for e in _load_jobs_file():
        jid = e.get("id") or ""
        m = re.fullmatch(r"setup-(\d+)", jid)
        if m:
            max_counter = max(max_counter, int(m.group(1)))
        pid = int(e.get("pid") or 0)
        if not pid or not _pid_alive(pid):
            continue
        task = next((t for t in TASKS if t["id"] == e.get("task_id")), None)
        if task is None:
            continue
        job = SetupJob(
            id=jid,
            task_id=task["id"],
            task_name=task["name"],
            total_bytes=task.get("total_bytes", 0),
        )
        job.status = "running"
        job.stage = "Mengunduh — dipulihkan"
        job._pid = pid
        job._monitor = True
        _prime_job_from_log(job)
        store.create(job)
        threading.Thread(target=_monitor_orphan, args=(job,), daemon=True).start()
        job.log.append("(backend dimulai ulang — pantauan dipulihkan dari sesi sebelumnya)")
    _job_counter = max_counter


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

    def active_for_task(self, task_id: str) -> Optional[SetupJob]:
        with self._lock:
            for job in self._jobs.values():
                if job.task_id == task_id and not job._finished:
                    return job
            return None

    def all(self) -> list["SetupJob"]:
        with self._lock:
            return list(self._jobs.values())

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

    with store._lock:
        job.status = "running"
        job._pid = handle.pid
        job._proc = handle
    _persist_job(job)

    # Poll disk for live progress, ETA and speed (especially for large video models where WAVES:PROGRESS may lag)
    def _poll_disk():
        last_done = job.done_bytes
        last_time = time.time()
        while True:
            time.sleep(2)
            with store._lock:
                if job._finished or handle.poll() is not None:
                    break
                try:
                    st = _task_state(job.task_id)
                    now = time.time()
                    # Update done_bytes from disk if larger
                    if st["done_bytes"] > job.done_bytes:
                        # Calculate rate from disk delta
                        dt = now - last_time
                        if dt > 0:
                            inst = (st["done_bytes"] - last_done) / dt
                            if inst > 0:
                                job._rate = inst if job._rate <= 0 else job._rate * 0.6 + inst * 0.4
                        job.done_bytes = st["done_bytes"]
                        job.total_bytes = st["total_bytes"] or job.total_bytes
                        if job.total_bytes:
                            job.progress = round(100.0 * job.done_bytes / job.total_bytes, 1)
                            if job.progress >= 100:
                                job.progress = 99.0
                        # Update ETA from rate
                        if job._rate and job._rate > 1024 and job.total_bytes:
                            job.eta_seconds = max(job.total_bytes - job.done_bytes, 0) / job._rate
                        last_done = st["done_bytes"]
                        last_time = now
                except Exception:
                    pass
    threading.Thread(target=_poll_disk, daemon=True).start()

    last_progress = 0.0
    for raw in handle.stdout:
        line = raw.rstrip("\r\n")
        if not line:
            continue
        if line.startswith("WAVES:"):
            _persist_waves(job, line)
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
                job.error = "Dijeda pengguna" if job._stopped else f"Proses keluar dengan kode {rc}"
    _unpersist_job(job.id)


def _handle_waves(job: SetupJob, payload: str) -> None:
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
                    inst = (done - job._bytes_at_event) / dt
                    if inst > 0:
                        # haluskan supaya ETA tidak melompat-lompat
                        job._rate = inst if job._rate <= 0 else job._rate * 0.6 + inst * 0.4
                job._bytes_at_event = done
                job._done_at_event = now
                job.done_bytes = min(done, total)
                job.total_bytes = total
                if total > 0:
                    job.progress = round(100.0 * job.done_bytes / total, 1)
                    if job.done_bytes >= total:
                        job.progress = 99.0   # tunggu DONE utk 100
                # ETA hanya masuk akal kalau laju >= 1 KB/s; selain itu jangan
                # tampilkan angka raksasa (mis. saat koneksi macet).
                if job.done_bytes >= total:
                    job.eta_seconds = 0.0
                elif job._rate >= 1024:
                    remain = max(total - job.done_bytes, 0)
                    job.eta_seconds = remain / job._rate
                else:
                    job.eta_seconds = None
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
    task = next((t for t in TASKS if t["id"] == task_id), None)
    if task is None:
        raise HTTPException(404, "Task tidak dikenal")

    # Kalau task ini sedang berjalan, kembalikan job yang ada — jangan
    # spawn proses kedua yang berebut folder & memperlambat unduhan.
    existing = store.active_for_task(task_id)
    if existing is not None:
        return {"job_id": existing.id, "task_id": task_id}

    # A03 fix: validasi python_path tanpa login — hanya izinkan python.exe yang sah
    if python_path:
        # hanya huruf, angka, : \ / . _ - dan harus berakhir python.exe
        if not re.match(r"^[A-Za-z]:[\\/][^<>:\"|?*\n]+python\.exe$", python_path):
            raise HTTPException(400, "python_path tidak valid")
        p = Path(python_path)
        # canonicalize & must be file
        try:
            rp = p.resolve()
        except OSError:
            raise HTTPException(400, "python_path tidak dapat di-resolve")
        if not rp.is_file() or rp.name.lower() != "python.exe":
            raise HTTPException(400, "python.exe tidak ditemukan")
        # hanya izinkan di PROJECT_ROOT/.venv atau di C:\Python / Program Files
        allowed_roots = [PROJECT_ROOT.resolve(), Path("C:/Python").resolve(), Path("C:/Program Files/Python").resolve()]
        # juga izinkan yang terdaftar di _suggested_pythons()
        try:
            suggested = [Path(s).resolve() for s in _suggested_pythons()]
        except Exception:
            suggested = []
        if not any(str(rp).lower().startswith(str(r).lower()) for r in allowed_roots + suggested):
            # fallback: izinkan jika memang ada di suggested list (sudah di atas) atau di venv
            if str(rp).lower() not in [str(s).lower() for s in suggested]:
                raise HTTPException(403, "python_path di luar lokasi yang diizinkan")

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
        snap = {
            "id": job.id,
            "task_id": job.task_id,
            "task_name": job.task_name,
            "status": job.status,
            "stage": job.stage,
            "progress": job.progress,
            "done_bytes": job.done_bytes,
            "total_bytes": job.total_bytes,
            "eta_seconds": job.eta_seconds,
            "error": job.error,
            "log": list(job.log),
            "created_at": job.created_at,
        }
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

    # field yang dipakai frontend
    snap["job_id"] = job.id
    snap["rate_bps"] = rate if rate > 0 else None
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


@router.get("/jobs")
async def list_jobs():
    jobs = store.all()
    return {"jobs": [_event_payload(j, interpolate=False) for j in jobs]}


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


@router.post("/jobs/{job_id}/stop")
async def stop_job(job_id: str):
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "Job tidak ditemukan")
    proc = job._proc
    if proc is not None and proc.poll() is None:
        with store._lock:
            job._stopped = True
        _kill_tree(proc.pid)   # bunuh powershell + curl anaknya
    elif job._pid and _pid_alive(job._pid):
        # job dipulihkan (backend sempat restart) — bunuh via PID.
        with store._lock:
            job._stopped = True
        _kill_tree(job._pid)
    else:
        with store._lock:
            job._stopped = True
    return {"job_id": job_id, "status": "stopped"}


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str):
    task = next((t for t in TASKS if t["id"] == task_id), None)
    if task is None:
        raise HTTPException(404, "Task tidak dikenal")
    if task.get("category") not in ("model", "model_video", "remover"):
        raise HTTPException(400, "Hanya task model yang bisa dihapus dari sini")

    target = task.get("check_dir")
    if target is None or not target.is_dir():
        return {"task_id": task_id, "status": "noop", "deleted_bytes": 0}

    # Hentikan job aktif untuk task ini supaya tidak menulis ke folder
    # yang sedang dihapus.
    active = store.active_for_task(task_id)
    if active is not None:
        proc = active._proc
        if proc is not None and proc.poll() is None:
            with store._lock:
                active._stopped = True
            _kill_tree(proc.pid)
        elif active._pid and _pid_alive(active._pid):
            with store._lock:
                active._stopped = True
            _kill_tree(active._pid)

    deleted_bytes = sum(
        f.stat().st_size for f in target.rglob("*") if f.is_file()
    )
    shutil.rmtree(target, ignore_errors=True)
    return {"task_id": task_id, "status": "deleted", "deleted_bytes": deleted_bytes}


# Pulihkan unduhan yang masih jalan dari sesi sebelumnya (backend sempat
# restart) supaya UI tetap tahu dan tidak ada spawn ganda.
_restore_jobs()

