from __future__ import annotations

import base64
import io
import json
import re
from pathlib import Path

import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import devices

router = APIRouter(prefix="/api", tags=["sd"])

# --- Image generation jobs (async, polling progress seperti video) ---
class ImageJobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    DONE = "done"
    ERROR = "error"

@dataclass
class ImageJob:
    id: str
    status: ImageJobStatus = ImageJobStatus.QUEUED
    progress: float = 0.0
    stage: str = "Menunggu"
    error: str | None = None
    result: dict | None = None
    created_at: float = field(default_factory=time.time)

class ImageJobStore:
    def __init__(self):
        self._jobs: dict[str, ImageJob] = {}
        self._lock = threading.Lock()
    def create(self, job: ImageJob):
        with self._lock:
            self._jobs[job.id] = job
    def get(self, job_id: str) -> ImageJob | None:
        with self._lock:
            return self._jobs.get(job_id)
    def update(self, job_id: str, **fields):
        with self._lock:
            j = self._jobs.get(job_id)
            if j:
                for k, v in fields.items():
                    setattr(j, k, v)

image_store = ImageJobStore()

MODELS_DIR = Path(__file__).resolve().parent / "storage" / "generate" / "image"

# Pipeline is loaded once and reused, cached per (model, device).
_cache: dict[tuple[str, str], object] = {}

_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")
_CHECKPOINT_EXTS = (".safetensors", ".ckpt")

# A01: model_id dari request dipakai untuk membangun path ke folder model.
_MODEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def _model_dir_for(model_id: str) -> Path:
    """Pastikan model_id menunjuk folder langsung di bawah MODELS_DIR."""
    if not isinstance(model_id, str) or not _MODEL_ID_RE.fullmatch(model_id):
        raise ValueError(f"model_id tidak valid: {model_id!r}")
    target = (MODELS_DIR / model_id).resolve()
    if target.parent != MODELS_DIR.resolve():
        raise ValueError(f"model_id tidak valid: {model_id!r}")
    return target


def _load_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        return None


def _meta(model_dir: Path) -> dict:
    return _load_json(model_dir / "meta.json") or {}


def _pretty_name(model_id: str) -> str:
    words = [w for w in re.split(r"[-_\s]+", model_id.strip()) if w]
    out = []
    for w in words:
        up = w.upper()
        if up in {"SD", "XL", "V1", "V2", "V3", "V4", "1.5", "2.1", "LSR"}:
            out.append(up)
        else:
            out.append(w[:1].upper() + w[1:])
    return " ".join(out) or model_id


def _find_cover(model_dir: Path) -> Path | None:
    for ext in _IMAGE_EXTS:
        for candidate in sorted(model_dir.glob(f"cover{ext}")):
            return candidate
    return None


def list_models() -> list[dict]:
    # Known models from Setup tasks (image)
    known_defs = [
        {"id": "tiny-sd", "name": "Tiny SD", "description": "Model Stable Diffusion ringan (~1 GB) untuk Image Generation."},
        {"id": "stable-diffusion", "name": "Stable Diffusion 1.5", "description": "Model SD 1.5 standar industri (~5,1 GB)."},
        {"id": "dream-shaper", "name": "DreamShaper 8", "description": "Fine-tune SD 1.5 untuk ilustrasi artistik (~5,1 GB)."},
    ]
    # Build map of existing models on disk
    existing: dict[str, dict] = {}
    if MODELS_DIR.is_dir():
        for entry in sorted(MODELS_DIR.iterdir()):
            if not entry.is_dir() or entry.name.startswith("."):
                continue
            has_pipeline = (entry / "model_index.json").is_file()
            has_checkpoint = any(p for ext in _CHECKPOINT_EXTS for p in entry.glob(f"*{ext}"))
            if not (has_pipeline or has_checkpoint):
                continue
            meta = _meta(entry)
            existing[entry.name] = {
                "id": entry.name,
                "name": meta.get("name") or _pretty_name(entry.name),
                "description": meta.get("description", ""),
                "has_cover": _find_cover(entry) is not None,
            }

    out: list[dict] = []
    # First, return known models with installed status
    for kd in known_defs:
        mid = kd["id"]
        if mid in existing:
            out.append({**existing[mid], "installed": True})
        else:
            out.append({
                "id": mid,
                "name": kd["name"],
                "description": kd["description"],
                "has_cover": False,
                "installed": False,
            })
    # Then add any custom models not in known list
    for mid, info in existing.items():
        if mid not in {kd["id"] for kd in known_defs}:
            out.append({**info, "installed": True})
    # Sort A-Z by name for consistent dropdown ordering
    out.sort(key=lambda x: x["name"].lower())
    return out


def _load_pipeline(model_dir: Path, device: str = "cpu"):
    try:
        import torch
        from diffusers import StableDiffusionPipeline
    except ImportError as exc:
        raise RuntimeError(
            "Library 'diffusers' belum terpasang. Install dulu di venv proyek: "
            "`pip install diffusers` (lihat requirements.txt)."
        ) from exc

    dtype = torch.float16 if device == "cuda" else torch.float32

    pipeline_index = model_dir / "model_index.json"
    if pipeline_index.is_file():
        pipe = StableDiffusionPipeline.from_pretrained(
            str(model_dir), torch_dtype=dtype, local_files_only=True
        )
    else:
        checkpoint = next(
            (p for ext in _CHECKPOINT_EXTS for p in sorted(model_dir.glob(f"*{ext}"))),
            None,
        )
        if checkpoint is None:
            raise FileNotFoundError(
                f"Folder model '{model_dir.name}' tidak berisi model_index.json "
                "ataupun checkpoint *.safetensors/*.ckpt."
            )
        config = _load_json(model_dir / "config.json") or {}
        kwargs = {}
        vae = str(config.get("vae") or "").strip()
        if vae:
            vae_path = Path(vae)
            if not vae_path.is_absolute():
                vae_path = model_dir / vae
            if not vae_path.is_dir():
                raise FileNotFoundError(
                    f"'vae' di config.json ({vae_path}) bukan folder diffusers "
                    "lokal. Waves tidak men-download VAE dari internet."
                )
            kwargs["vae"] = str(vae_path)
        pipe = StableDiffusionPipeline.from_single_file(
            str(checkpoint), torch_dtype=dtype, **kwargs
        )

    pipe = pipe.to(device)
    if device == "cuda":
        pipe.enable_attention_slicing()
    return pipe


def _get_or_load(model_id: str, device: str = "cpu"):
    try:
        model_dir = _model_dir_for(model_id)
    except ValueError as exc:
        raise FileNotFoundError(str(exc)) from exc
    if not model_dir.is_dir():
        raise FileNotFoundError(f"Model '{model_id}' tidak ditemukan di {MODELS_DIR}")

    cache_key = (model_id, device)
    if cache_key in _cache:
        return _cache[cache_key]

    pipe = _load_pipeline(model_dir, device)
    _cache[cache_key] = pipe
    return pipe


def _img2img_pipe(pipe: object, device: str = "cpu"):
    import torch
    from diffusers import StableDiffusionImg2ImgPipeline

    img2img = StableDiffusionImg2ImgPipeline(
        unet=pipe.unet,
        vae=pipe.vae,
        text_encoder=pipe.text_encoder,
        tokenizer=pipe.tokenizer,
        scheduler=pipe.scheduler,
        safety_checker=None,
        feature_extractor=None,
    )
    img2img = img2img.to(device)
    if device == "cuda":
        img2img.enable_attention_slicing()
    return img2img


def generate(
    model_id: str,
    prompt: str,
    negative_prompt: str = "",
    steps: int = 25,
    guidance_scale: float = 7.5,
    width: int = 512,
    height: int = 512,
    seed: int | None = None,
    n_images: int = 1,
    init_image: bytes | None = None,
    strength: float = 0.5,
    device: str = "cpu",
    on_step: object | None = None,
) -> tuple[list[bytes], int | None]:
    import torch

    pipe = _get_or_load(model_id, device)

    kwargs = {}
    if negative_prompt:
        kwargs["negative_prompt"] = negative_prompt
    generator = None
    if seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(seed)

    # diffusers callback_on_step_end signature: (pipe, step, timestep, callback_kwargs) -> dict
    cb = on_step

    if init_image is not None:
        try:
            from PIL import Image
        except ImportError as exc:
            raise RuntimeError(
                "Library 'Pillow' belum terpasang. Jalankan "
                "`pip install Pillow` di venv proyek."
            ) from exc
        init = Image.open(io.BytesIO(init_image)).convert("RGB")
        st = min(float(strength), 0.999)  # strength >= 1 == txt2img murni
        pipe2 = _img2img_pipe(_get_or_load(model_id, device), device)
        call_kwargs = dict(
            prompt=prompt,
            image=init,
            strength=st,
            num_inference_steps=steps,
            guidance_scale=guidance_scale,
            generator=generator,
            num_images_per_prompt=n_images,
            **kwargs,
        )
        if cb is not None:
            call_kwargs["callback_on_step_end"] = cb  # type: ignore
        images = pipe2(**call_kwargs).images  # type: ignore
    else:
        call_kwargs = dict(
            prompt=prompt,
            num_inference_steps=steps,
            guidance_scale=guidance_scale,
            width=width,
            height=height,
            generator=generator,
            num_images_per_prompt=n_images,
            **kwargs,
        )
        if cb is not None:
            call_kwargs["callback_on_step_end"] = cb  # type: ignore
        images = pipe(**call_kwargs).images  # type: ignore

    payloads = []
    for img in images:
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        payloads.append(buffer.getvalue())
    return payloads, seed


# --- API ---


@router.get("/models")
async def get_models():
    return {"models": list_models()}


@router.get("/models/{model_id}/cover")
async def get_cover(model_id: str):
    try:
        model_dir = _model_dir_for(model_id)
    except ValueError as exc:
        raise HTTPException(404, "Model not found") from exc
    if not model_dir.is_dir():
        raise HTTPException(404, "Model not found")
    cover = _find_cover(model_dir)
    if cover is None:
        raise HTTPException(404, "Cover not found")
    return FileResponse(cover, headers={"Cache-Control": "no-store"})


class GenerateRequest(BaseModel):
    model_id: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
        description="Nama folder model di server/storage/generate/image (tanpa path).",
    )
    prompt: str = Field(min_length=1, max_length=2000)
    negative_prompt: str = Field(default="", max_length=1000)
    steps: int = Field(15, ge=1, le=150)
    guidance_scale: float = Field(7.5, ge=0.0, le=30.0)
    width: int = Field(512, ge=128, le=1024)
    height: int = Field(512, ge=128, le=1024)
    seed: int | None = Field(None, ge=0, le=2**32 - 1)
    n_images: int = Field(1, ge=1, le=4)
    device: str = "auto"
    init_image_b64: str | None = Field(
        None,
        description="Data URL or base64 PNG for image-to-image. "
        "When provided, the output size follows the source image.",
    )
    strength: float = Field(0.5, ge=0.0, le=1.0)


@router.post("/generate")
async def generate_image(req: GenerateRequest):
    try:
        resolved_device = devices.resolve_device(req.device)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    init_bytes = None
    if req.init_image_b64:
        raw = req.init_image_b64.strip()
        if raw.startswith("data:"):
            raw = raw.split(",", 1)[1] if "," in raw else ""
        try:
            init_bytes = base64.b64decode(raw)
        except (ValueError, base64.binascii.Error) as exc:
            raise HTTPException(400, "Gambar inisialisasi tidak valid.") from exc
        if not init_bytes:
            raise HTTPException(400, "Gambar inisialisasi kosong.")

    job_id = uuid.uuid4().hex
    job = ImageJob(id=job_id, status=ImageJobStatus.QUEUED, stage="Menunggu", progress=0)
    image_store.create(job)

    def _run():
        try:
            image_store.update(job_id, status=ImageJobStatus.PROCESSING, stage="Memuat model", progress=5)
            # Callback per-step agar UI tidak diam (0% -> 90% selama denoising)
            def _make_cb(total: int):
                def _cb(pipe, step: int, timestep: int, cb_kwargs: dict):  # type: ignore
                    try:
                        done = step + 1
                        pct = 10 + (done / max(1, total)) * 80
                        image_store.update(
                            job_id,
                            progress=float(max(10, min(90, pct))),
                            stage=f"Menjalankan inference ({done}/{total})",
                        )
                    except Exception:
                        pass
                    return cb_kwargs
                return _cb

            cb = _make_cb(req.steps)
            image_store.update(job_id, stage=f"Menjalankan inference (0/{req.steps})", progress=10)
            payloads, seed = generate(
                model_id=req.model_id,
                prompt=req.prompt,
                negative_prompt=req.negative_prompt,
                steps=req.steps,
                guidance_scale=req.guidance_scale,
                width=req.width,
                height=req.height,
                seed=req.seed,
                n_images=req.n_images,
                init_image=init_bytes,
                strength=req.strength,
                device=resolved_device,
                on_step=cb,
            )
            image_store.update(job_id, stage="Encoding", progress=95)
            encoded = [
                f"data:image/png;base64,{base64.b64encode(p).decode('ascii')}" for p in payloads
            ]
            image_store.update(
                job_id,
                status=ImageJobStatus.DONE,
                stage="Selesai",
                progress=100,
                result={"images": encoded, "seed": seed},
            )
        except HTTPException as exc:
            image_store.update(job_id, status=ImageJobStatus.ERROR, stage="Gagal", error=str(exc.detail) if hasattr(exc, "detail") else str(exc))
        except Exception as exc:  # noqa: BLE001
            # Sampaikan OOM lebih ramah
            msg = str(exc)
            if "out of memory" in msg.lower() or "oom" in msg.lower():
                msg = f"VRAM habis (OOM) saat {req.width}x{req.height} {req.steps} steps. Coba turunkan resolusi/steps atau pilih device CPU. Detail: {exc}"
            image_store.update(job_id, status=ImageJobStatus.ERROR, stage="Gagal", error=f"Generasi gagal: {msg}")

    threading.Thread(target=_run, daemon=True).start()
    return {"job_id": job_id}


@router.get("/generate/jobs/{job_id}")
async def get_image_job(job_id: str):
    try:
        job = image_store.get(job_id)
        if not job:
            raise HTTPException(404, "Job tidak ditemukan atau sudah kedaluwarsa. Silakan generate ulang.")
        status_val = job.status.value if isinstance(job.status, ImageJobStatus) else str(job.status)
        return {
            "id": job.id,
            "status": status_val,
            "progress": float(job.progress),
            "stage": job.stage,
            "error": job.error,
            "result": job.result,
            "created_at": job.created_at,
        }
    except HTTPException:
        raise
    except Exception as exc:
        import logging

        logging.error(f"get_image_job error {job_id}: {exc}", exc_info=True)
        raise HTTPException(500, f"Gagal memuat status job: {exc}")