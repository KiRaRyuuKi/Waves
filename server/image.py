from __future__ import annotations

import base64
import io
import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import devices

router = APIRouter(prefix="/api", tags=["sd"])

MODELS_DIR = Path(__file__).resolve().parent / "storage" / "generate" / "image"

# Pipeline is loaded once and reused, cached per (model, device).
_cache: dict[tuple[str, str], object] = {}

_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")
_CHECKPOINT_EXTS = (".safetensors", ".ckpt")


def _load_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        return None


def _meta(model_dir: Path) -> dict:
    return _load_json(model_dir / "meta.json") or {}


def _pretty_name(model_id: str) -> str:
    """Convert a folder id into a display name, e.g. 'tiny-sd' -> 'Tiny SD'."""
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
    """Scan the image directory and list folders containing a valid model (mode A
    or B). The list is available even without diffusers installed."""
    if not MODELS_DIR.is_dir():
        return []
    out = []
    for entry in sorted(MODELS_DIR.iterdir()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        has_pipeline = (entry / "model_index.json").is_file()
        has_checkpoint = any(
            p for ext in _CHECKPOINT_EXTS for p in entry.glob(f"*{ext}")
        )
        if not (has_pipeline or has_checkpoint):
            continue
        meta = _meta(entry)
        out.append(
            {
                "id": entry.name,
                "name": meta.get("name") or _pretty_name(entry.name),
                "description": meta.get("description", ""),
                "has_cover": _find_cover(entry) is not None,
                "installed": True,
            }
        )
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
    model_dir = MODELS_DIR / model_id
    if not model_dir.is_dir():
        raise FileNotFoundError(f"Model '{model_id}' tidak ditemukan di {MODELS_DIR}")

    cache_key = (model_id, device)
    if cache_key in _cache:
        return _cache[cache_key]

    pipe = _load_pipeline(model_dir, device)
    _cache[cache_key] = pipe
    return pipe


def _img2img_pipe(pipe: object, device: str = "cpu"):
    """Build an img2img pipeline that reuses already loaded components
    to avoid loading a separate model twice (saves VRAM/RAM)."""
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
) -> tuple[list[bytes], int | None]:
    """Run the pipeline and return (list of PNG bytes, used seed)."""
    import torch

    pipe = _get_or_load(model_id, device)

    kwargs = {}
    if negative_prompt:
        kwargs["negative_prompt"] = negative_prompt
    generator = None
    if seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(seed)

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
        images = _img2img_pipe(_get_or_load(model_id, device), device)(
            prompt=prompt,
            image=init,
            strength=st,
            num_inference_steps=steps,
            guidance_scale=guidance_scale,
            generator=generator,
            num_images_per_prompt=n_images,
            **kwargs,
        ).images
    else:
        images = pipe(
            prompt=prompt,
            num_inference_steps=steps,
            guidance_scale=guidance_scale,
            width=width,
            height=height,
            generator=generator,
            num_images_per_prompt=n_images,
            **kwargs,
        ).images

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
    model_dir = MODELS_DIR / model_id
    if not model_dir.is_dir():
        raise HTTPException(404, "Model not found")
    cover = _find_cover(model_dir)
    if cover is None:
        raise HTTPException(404, "Cover not found")
    return FileResponse(cover, headers={"Cache-Control": "no-store"})


class GenerateRequest(BaseModel):
    model_id: str
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
def generate_image(req: GenerateRequest):
    # Use plain `def` (not async) so FastAPI runs this heavy inference
    # in a threadpool without blocking the event loop — same as
    # /api/voice/synthesize.
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

    try:
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
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:  # noqa: BLE001 - inference failure -> 500 dengan detail
        raise HTTPException(500, f"Generasi gagal: {exc}")

    encoded = [
        f"data:image/png;base64,{base64.b64encode(p).decode('ascii')}" for p in payloads
    ]
    return {"images": encoded, "seed": seed}