"""Fine-tune VITS (kafka) ke bahasa Indonesia — API + sesi latih.

Alur penggunaan:
  1. POST /api/training/datasets   upload audio (list) + transkrip (JSON).
  2. GET  /api/training/datasets   lihat/ubah transkrip (PATCH).
  3. POST /api/training/start      mulai pelatihan (jalan di thread).
  4. GET  /api/training/status/{id} pantau progres.
  5. Model hasil muncul di /api/voice/models untuk disintesis ulang.
"""

from __future__ import annotations

import json
import re
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from . import finetune
from . import tts
from .separator import STORAGE_ROOT

router = APIRouter(prefix="/api/training", tags=["training"])

TRAINING_ROOT = STORAGE_ROOT / "training"
TRAINING_ROOT.mkdir(parents=True, exist_ok=True)

_sessions: dict[str, dict] = {}
_sessions_lock = threading.Lock()

_DEFAULT_STEPS = 2000
_MAX_STEPS = 50000
_DEFAULT_LR = 2e-4

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    return _SLUG_RE.sub("-", name.strip().lower()).strip("-")


def _unique_model_id(name: str) -> str:
    base = _slugify(name) or "kafka-id"
    candidate = base
    n = 2
    while (tts.MODELS_DIR / candidate).exists():
        candidate = f"{base}-{n}"
        n += 1
    return candidate


def _safe_basename(filename: str) -> str:
    name = Path(filename or "audio.wav").name
    return re.sub(r"[^\w.\-]", "_", name)


def _dataset_entries(dataset_dir: Path) -> list[dict]:
    meta_path = dataset_dir / "transcripts.json"
    if not dataset_dir.is_dir() or not meta_path.exists():
        return []
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        return []


@router.post("/datasets")
async def create_dataset(
    files: list[UploadFile] = File(...),
    transcripts: str = Form(...),
):
    try:
        transcript_list = json.loads(transcripts)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "Field 'transcripts' bukan JSON valid.") from exc
    if not isinstance(transcript_list, list) or not transcript_list:
        raise HTTPException(400, "Minimal satu pasangan audio+transkrip.")

    original_names = [files[i].filename for i in range(len(files))]
    stored_names = {orig: f"{i:04d}_{_safe_basename(orig)}" for i, orig in enumerate(original_names)}

    dataset_id = uuid.uuid4().hex[:8]
    dataset_dir = TRAINING_ROOT / dataset_id
    dataset_dir.mkdir(parents=True, exist_ok=True)

    for uploaded in files:
        orig = uploaded.filename or ""
        if orig not in stored_names:
            continue
        with (dataset_dir / stored_names[orig]).open("wb") as out:
            import shutil

            shutil.copyfileobj(uploaded.file, out)

    saved_count = 0
    entries = []
    for item in transcript_list:
        orig = item.get("file") or ""
        text = str(item.get("text", "")).strip()
        stored_name = stored_names.get(orig)
        if stored_name is None:
            continue
        src = dataset_dir / stored_name
        if not src.exists():
            continue
        if not text:
            raise HTTPException(400, f"Transkrip kosong untuk {orig}.")
        entries.append({"file": stored_name, "original": orig, "text": text})
        saved_count += 1

    if saved_count == 0:
        import shutil

        shutil.rmtree(dataset_dir, ignore_errors=True)
        raise HTTPException(400, "Tidak ada pasangan audio+teks yang diterima.")

    (dataset_dir / "transcripts.json").write_text(
        json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {"id": dataset_id, "files": [e["file"] for e in entries]}


@router.get("/datasets")
async def list_datasets():
    out = []
    for dataset_dir in sorted(TRAINING_ROOT.iterdir(), reverse=True):
        if not dataset_dir.is_dir():
            continue
        entries = _dataset_entries(dataset_dir)
        if not entries:
            continue
        out.append(
            {
                "id": dataset_dir.name,
                "files": [
                    {"file": e["file"], "text": e.get("text", "")}
                    for e in entries
                ],
            }
        )
    return {"datasets": out}


class TranscriptPatch(BaseModel):
    file: str
    text: str


@router.patch("/datasets/{dataset_id}")
async def update_transcript(dataset_id: str, patch: TranscriptPatch):
    dataset_dir = TRAINING_ROOT / dataset_id
    entries = _dataset_entries(dataset_dir)
    if not entries:
        raise HTTPException(404, "Dataset tidak ditemukan.")
    text = patch.text.strip()
    if not text:
        raise HTTPException(400, "Transkrip tidak boleh kosong.")
    found = False
    for entry in entries:
        if entry["file"] == patch.file:
            entry["text"] = text
            found = True
            break
    if not found:
        raise HTTPException(404, f"File '{patch.file}' tidak ada di dataset.")
    (dataset_dir / "transcripts.json").write_text(
        json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {"ok": True}


@router.delete("/datasets/{dataset_id}")
async def delete_dataset(dataset_id: str):
    dataset_dir = TRAINING_ROOT / dataset_id
    if not dataset_dir.is_dir():
        raise HTTPException(404, "Dataset tidak ditemukan.")
    import shutil

    shutil.rmtree(dataset_dir, ignore_errors=True)
    return {"ok": True}


class TrainingStart(BaseModel):
    dataset_id: str
    name: str = "kafka Indonesia"
    steps: int = _DEFAULT_STEPS
    learning_rate: float = _DEFAULT_LR
    sample_text: str = ""
    base_model: str = "kafka"


@router.post("/start")
async def start_training(params: TrainingStart):
    with _sessions_lock:
        active = [s for s in _sessions.values() if s.get("status") in ("training", "preparing")]
        if active:
            raise HTTPException(
                409,
                f"Sesi latih sedang berjalan ({active[0].get('id', '?')}). "
                "Hentikan dulu atau tunggu selesai.",
            )

    dataset_dir = TRAINING_ROOT / params.dataset_id
    if not _dataset_entries(dataset_dir):
        raise HTTPException(404, "Dataset tidak ditemukan.")

    index = tts._load_info_index()
    info = index.get(params.base_model) or {}
    speaker_id = int(info.get("sid", 0) or 0)

    session_id = uuid.uuid4().hex[:8]
    steps = max(10, min(params.steps, _MAX_STEPS))
    lr = max(1e-6, min(params.learning_rate, 1e-3))
    model_id = _unique_model_id(params.name)

    session = {
        "id": session_id,
        "status": "preparing",
        "step": 0,
        "total": steps,
        "model_id": model_id,
        "base_model": params.base_model,
        "speaker_id": speaker_id,
        "error": None,
        "done": False,
        "cancel": threading.Event(),
    }
    with _sessions_lock:
        _sessions[session_id] = session

    thread = threading.Thread(
        target=_run_training,
        args=(
            session,
            dataset_dir,
            model_id,
            steps,
            lr,
            params.sample_text,
            speaker_id,
            params.base_model,
        ),
        daemon=True,
    )
    thread.start()
    return {"session_id": session_id, "model_id": model_id, "steps": steps}


def _run_training(session, dataset_dir, model_id, steps, lr, sample_text, speaker_id, base_model):
    try:
        finetune.train_session(
            session,
            dataset_dir,
            model_id,
            steps=steps,
            learning_rate=lr,
            sample_text=sample_text,
            speaker_id=speaker_id,
            base_model=base_model,
        )
    except Exception:
        # session["error"] sudah diisi train_session; pastikan status tidak "training".
        if session.get("status") == "training":
            session["status"] = "error"


@router.get("/status/{session_id}")
async def get_status(session_id: str):
    with _sessions_lock:
        session = _sessions.get(session_id)
    if session is None:
        raise HTTPException(404, "Sesi tidak ditemukan.")
    keys = [
        "id", "status", "step", "total", "model_id", "base_model", "speaker_id",
        "error", "done", "n_samples", "elapsed", "eta_seconds", "last_msg",
        "last_checkpoint", "loss_gen", "loss_mel", "loss_kl", "loss_dur",
        "loss_disc", "dataset_desc",
    ]
    return {k: session.get(k) for k in keys}


@router.post("/stop")
async def stop_training():
    stopped = False
    with _sessions_lock:
        for session in _sessions.values():
            cancel = session.get("cancel")
            if session.get("status") in ("training", "preparing") and cancel is not None:
                cancel.set()
                stopped = True
    return {"stopped": stopped}


@router.get("/models")
async def list_trained_models():
    out = []
    for entry in sorted(tts.MODELS_DIR.iterdir()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        meta = tts._load_json(entry / "meta.json")
        if not isinstance(meta, dict) or not meta.get("trained"):
            continue
        out.append(
            {
                "model_id": entry.name,
                "name": meta.get("name", entry.name),
                "language": meta.get("language", ""),
                "ready": tts._model_is_ready(entry),
            }
        )
    return {"models": out}