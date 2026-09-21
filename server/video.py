from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import devices

router = APIRouter(prefix="/api/video", tags=["video"])

VIDEO_DIR = Path(__file__).resolve().parent / "storage" / "generate" / "video"
OUTPUTS_DIR = VIDEO_DIR / "outputs"
AD_DIR = VIDEO_DIR / "animate-diff"
AD_MOTION_DIR = AD_DIR / "motion-adapter"
AD_CLIP_DIR = AD_DIR / "clip-vit-large"
WAN_DIR = VIDEO_DIR / "wan"

AD_BASE_DIR = Path(__file__).resolve().parent / "storage" / "generate" / "image"

# Pipeline dimuat sekali lalu dipakai bersama, di-cache per (kind, base, device).
_cache: dict[tuple[str, str, str], object] = {}


def _load_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        return None


def _dir_has_weights(folder: Path) -> bool:
    """Folder dianggap 'berisi model' kalau ada file bobot diffusers/transformers."""
    if not folder.is_dir():
        return False
    for ext in (".safetensors", ".bin", ".ckpt"):
        if any(folder.glob(f"*{ext}")):
            return True
    return False


def _readable(bytes_: int) -> str:
    if bytes_ >= 1024**3:
        return f"{bytes_ / 1024**3:.1f} GB"
    if bytes_ >= 1024**2:
        return f"{bytes_ / 1024**2:.0f} MB"
    return f"{bytes_} B"


_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")

def _find_cover_in_dir(model_dir: Path) -> bool:
    for ext in _IMAGE_EXTS:
        if any(model_dir.glob(f"cover{ext}")):
            return True
    return False


def _sd_base_models() -> list[dict]:
    """Daftar model SD di storage/generate/image yang bisa jadi dasar AnimateDiff."""
    if not AD_BASE_DIR.is_dir():
        return []
    out = []
    for entry in sorted(AD_BASE_DIR.iterdir()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        has_pipeline = (entry / "model_index.json").is_file()
        has_ckpt = any(
            p for ext in (".safetensors", ".ckpt") for p in entry.glob(f"*{ext}")
        )
        if not (has_pipeline or has_ckpt):
            continue
        meta = _load_json(entry / "meta.json") or {}
        name = meta.get("name") or " ".join(
            w[:1].upper() + w[1:] if not w.isupper() else w
            for w in re.split(r"[-_\s]+", entry.name) if w
        )
        out.append(
            {
                "id": entry.name,
                "name": name,
                "description": meta.get("description", ""),
                "has_cover": _find_cover_in_dir(entry),
            }
        )
    return out


def _ad_installed() -> bool:
    return _dir_has_weights(AD_MOTION_DIR) and _dir_has_weights(AD_CLIP_DIR)


def _wan_installed() -> bool:
    return (WAN_DIR / "model_index.json").is_file() and bool(
        (WAN_DIR / "transformer").is_dir()
    )


def _folder_bytes(folder: Path) -> int:
    if not folder.is_dir():
        return 0
    return sum(f.stat().st_size for f in folder.rglob("*") if f.is_file())


class VideoModelInfo(BaseModel):
    id: str
    kind: str
    name: str
    description: str
    installed: bool
    installed_bytes: int = 0
    note: str | None = None
    bases: list[dict] = Field(default_factory=list)


@router.get("/models")
async def list_video_models():
    ad_bases = _sd_base_models()

    ad_desc = (
        "Motion module yang ditempel ke model SD 1.5 yang sudah terpasang. "
        "Memanfaatkan model gambar yang sudah terpasang untuk menghasilkan " 
        "video pendek. Lebih ringan dan cepat, cocok untuk perangkat dengan " 
        "memori terbatas. Output 512x512, 16 frame."
    )
    if not _ad_installed():
        ad_note = (
            "Belum terpasang. Unduh lewat Setup & Runtime → "
            "'Motion Adapter AnimateDiff' dan 'CLIP Vision'."
        )
    elif not ad_bases:
        ad_note = "Motion adapter ada, tapi belum ada model SD 1.5 dasar di storage."
    else:
        ad_note = None

    wan_desc = (
        "Menghasilkan video pendek dari teks dengan gerakan yang lebih halus dan "
        "natural. Membutuhkan ruang penyimpanan lebih besar namun memberi hasil lebih detail."
    )
    wan_note = (
        "Belum terpasang. Unduh lewat Setup & Runtime → 'Wan 2.1 T2V 1.3B' "
        "(~28 GB)."
        if not _wan_installed()
        else None
    )

    models = [
        VideoModelInfo(
            id="animatediff",
            kind="animatediff",
            name="Animate Diff",
            description=ad_desc,
            installed=_ad_installed() and bool(ad_bases),
            installed_bytes=_folder_bytes(AD_MOTION_DIR) + _folder_bytes(AD_CLIP_DIR),
            note=ad_note,
            bases=ad_bases,
        ).model_dump(),
        VideoModelInfo(
            id="wan",
            kind="wan",
            name="Wan Alibaba",
            description=wan_desc,
            installed=_wan_installed(),
            installed_bytes=_folder_bytes(WAN_DIR),
            note=wan_note,
        ).model_dump(),
    ]
    return {"models": models}


# ---------------------------------------------------------------------------
#  Pipeline loading
# ---------------------------------------------------------------------------

def _get_or_load_animatediff(base_id: str, device: str):
    base_dir = AD_BASE_DIR / base_id
    if not base_dir.is_dir() or not (base_dir / "model_index.json").is_file():
        raise FileNotFoundError(
            f"Model dasar SD '{base_id}' tidak ditemukan di {AD_BASE_DIR}"
        )
    if not _ad_installed():
        raise FileNotFoundError(
            "Motion adapter / CLIP vision AnimateDiff belum terpasang. "
            f"Unduh dulu: {AD_MOTION_DIR} + {AD_CLIP_DIR}"
        )

    key = ("animatediff", base_id, device)
    if key not in _cache:
        _cache[key] = _load_animatediff(base_dir, device)
    return _cache[key]


def _load_animatediff(base_dir: Path, device: str):
    try:
        import torch
        from diffusers import AnimateDiffPipeline, DDIMScheduler, MotionAdapter
        from transformers import CLIPVisionModel
    except ImportError as exc:
        raise RuntimeError(
            "Library 'diffusers' / 'transformers' belum terpasang. "
            "Jalankan `pip install -r requirements.txt` di venv proyek."
        ) from exc

    dtype = torch.float16 if device == "cuda" else torch.float32
    adapter = MotionAdapter.from_pretrained(str(AD_MOTION_DIR), torch_dtype=dtype)
    image_encoder = CLIPVisionModel.from_pretrained(
        str(AD_CLIP_DIR), torch_dtype=dtype
    )

    pipe = AnimateDiffPipeline.from_pretrained(
        str(base_dir),
        motion_adapter=adapter,
        image_encoder=image_encoder,
        torch_dtype=dtype,
        safety_checker=None,
    )
    pipe.scheduler = DDIMScheduler.from_pretrained(
        str(base_dir),
        subfolder="scheduler",
        beta_start=0.00085,
        beta_end=0.012,
        beta_schedule="scaled_linear",
        clip_sample=False,
    )

    pipe.enable_vae_slicing()
    pipe.enable_vae_tiling()
    if device == "cuda":
        # Pe-rendah 4 GB — selalu offload ke RAM supaya muat.
        pipe.enable_attention_slicing()
        pipe.enable_model_cpu_offload()
    else:
        pipe.enable_attention_slicing()
        pipe = pipe.to(device)
    return pipe


def _get_or_load_wan(device: str):
    if not _wan_installed():
        raise FileNotFoundError(
            "Model Wan 2.1 T2V 1.3B belum terpasang di " + str(WAN_DIR)
        )
    key = ("wan", "", device)
    if key not in _cache:
        _cache[key] = _load_wan(device)
    return _cache[key]


def _load_wan(device: str):
    try:
        import torch
        from diffusers import WanPipeline
    except ImportError as exc:
        raise RuntimeError(
            "Library 'diffusers' terlalu lama / belum terpasang. "
            "Wan butuh diffusers >= 0.33 — `pip install -r requirements.txt`."
        ) from exc

    # RTX 2050 = Ampere (CC 8.6) → bf16 didukung dan paling cocok untuk Wan.
    dtype = torch.bfloat16 if device == "cuda" else torch.float32
    pipe = WanPipeline.from_pretrained(str(WAN_DIR), torch_dtype=dtype)

    if hasattr(pipe.vae, "enable_tiling"):
        pipe.vae.enable_tiling()
    if device == "cuda":
        pipe.enable_model_cpu_offload()
    else:
        pipe = pipe.to(device)
    return pipe


def _get_or_load_wan_i2v(device: str):
    key = ("wan_i2v", "", device)
    if key not in _cache:
        _cache[key] = _load_wan_i2v(device)
    return _cache[key]


def _load_wan_i2v(device: str):
    try:
        import torch
        from diffusers import WanImageToVideoPipeline
    except ImportError as exc:
        raise RuntimeError(
            "Wan Image-to-Video butuh diffusers dengan WanImageToVideoPipeline."
        ) from exc
    dtype = torch.bfloat16 if device == "cuda" else torch.float32
    pipe = WanImageToVideoPipeline.from_pretrained(str(WAN_DIR), torch_dtype=dtype)
    if hasattr(pipe.vae, "enable_tiling"):
        pipe.vae.enable_tiling()
    if device == "cuda":
        pipe.enable_model_cpu_offload()
    else:
        pipe = pipe.to(device)
    return pipe


def _apply_init_image(frames, init_pil, target_w: int, target_h: int, strength: float):
    """Blend gambar awal ke frame hasil (untuk img2vid fallback).
    strength kecil = tetap mirip gambar, besar = lebih bebas."""
    from PIL import Image

    pil_frames = _to_pil_frames(frames)
    if not pil_frames:
        return pil_frames
    # Resize gambar awal ke resolusi output (dibulatkan pipeline)
    w = target_w - (target_w % 8)
    h = target_h - (target_h % 8)
    try:
        init_resized = init_pil.resize((w, h), Image.LANCZOS)
    except Exception:
        init_resized = init_pil
    # Frame pertama blend, sisanya tetap; jika strength ~1, frame tetap dari model
    if 0 <= strength < 1:
        try:
            blended = Image.blend(init_resized, pil_frames[0].resize((w, h)), float(strength))
            pil_frames[0] = blended
        except Exception:
            pil_frames[0] = init_resized
    else:
        pil_frames[0] = init_resized
    return pil_frames


# ---------------------------------------------------------------------------
#  Encoding hasil → mp4
# ---------------------------------------------------------------------------

def _to_pil_frames(frames):
    """Normalisasi output pipeline (list PIL / np.ndarray / torch.Tensor) jadi
    list PIL.Image yang siap di-encode."""
    import numpy as np
    import torch
    from PIL import Image

    if isinstance(frames, (list, tuple)):
        if not frames:
            return []
        first = frames[0]
        if isinstance(first, Image.Image):
            return list(frames)
        # tiap elemen bisa juga tensor/array video → rekursi.
        out: list = []
        for f in frames:
            out.extend(_to_pil_frames(f))
        return out

    arr = frames
    if isinstance(arr, torch.Tensor):
        arr = arr.detach().cpu()
        if arr.is_floating_point():
            arr = arr.float()
            if arr.numel() and (arr.min() < 0 or arr.max() > 1.001):
                arr = (arr - arr.min()) / (arr.max() - arr.min())
            arr = (arr * 255.0).byte()
        arr = arr.numpy()

    if isinstance(arr, np.ndarray):
        if arr.dtype.kind == "f":
            if arr.min() < 0 or arr.max() > 1.001:
                arr = (arr - arr.min()) / (arr.max() - arr.min())
            arr = (arr * 255.0).astype(np.uint8)
        if arr.ndim == 4:
            # Normalisasi ke (T,H,W,C). Tiga layout lazim:
            #   (T,H,W,C) -> sudah benar
            #   (T,C,H,W) -> pindah channel ke belakang
            #   (C,T,H,W) -> pindah channel ke belakang
            if arr.shape[-1] in (1, 3, 4) and arr.shape[-1] != arr.shape[-2]:
                pass
            elif arr.shape[1] in (1, 3) and arr.shape[1] != arr.shape[2]:
                arr = arr.transpose(0, 2, 3, 1)
            elif arr.shape[0] in (1, 3, 4):
                arr = arr.transpose(1, 2, 3, 0)
        outs = []
        for t in range(arr.shape[0]):
            frame = arr[t]
            if frame.shape[-1] == 1:
                frame = frame[..., 0]
            outs.append(Image.fromarray(frame))
        return outs

    raise TypeError(f"Tipe frames tidak dikenal: {type(frames)!r}")


def _encode_mp4_to_bytes(frames, fps: int) -> bytes:
    """Encode frames jadi bytes mp4 via FFmpeg (tidak disimpan ke disk permanen, mirip image.py)."""
    import base64  # noqa: F401 - keep import check

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise RuntimeError(
            "FFmpeg tidak ditemukan di PATH. Pasang FFmpeg dulu (lihat README)."
        )
    images = _to_pil_frames(frames)
    if not images:
        raise RuntimeError("Tidak ada frame untuk di-encode.")

    with tempfile.TemporaryDirectory(prefix="waves-frames-") as td:
        for i, img in enumerate(images):
            img.save(os.path.join(td, f"frame_{i:05d}.png"))
        pattern = os.path.join(td, "frame_%05d.png")
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            args = [
                ffmpeg, "-y", "-loglevel", "error",
                "-framerate", str(fps),
                "-i", pattern,
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
                tmp_path,
            ]
            proc = subprocess.run(args, capture_output=True, text=True)
            if proc.returncode != 0:
                raise RuntimeError("Encode video gagal: " + (proc.stderr or "").strip()[-500:])
            return Path(tmp_path).read_bytes()
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


# Legacy: simpan ke file jika ada endpoint lama yang butuh — sekarang tidak dipakai utama.
def _encode_mp4(frames, out_path: Path, fps: int) -> None:
    data = _encode_mp4_to_bytes(frames, fps)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(data)


# ---------------------------------------------------------------------------
#  Endpoint API
# ---------------------------------------------------------------------------

@router.get("/outputs")
async def list_outputs(limit: int = 20):
    if not OUTPUTS_DIR.is_dir():
        return {"videos": []}
    files = sorted(OUTPUTS_DIR.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    return {
        "videos": [
            {
                "name": p.stem,
                "url": f"/api/video/outputs/{p.name}",
                "size": p.stat().st_size,
                "size_human": _readable(p.stat().st_size),
                "created": p.stat().st_mtime,
            }
            for p in files[:max(1, min(limit, 100))]
        ]
    }


@router.get("/outputs/{filename}")
async def get_output(filename: str):
    if filename != Path(filename).name or not filename.endswith(".mp4"):
        raise HTTPException(404, "File not found")
    path = OUTPUTS_DIR / filename
    if not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(path, media_type="video/mp4")


class VideoGenerateRequest(BaseModel):
    model_id: str = Field(pattern="^(animatediff|wan)$")
    base_id: str = Field("", description="Model dasar SD untuk AnimateDiff")
    prompt: str = Field(min_length=1, max_length=2000)
    negative_prompt: str = Field(default="", max_length=1000)
    steps: int = Field(20, ge=1, le=150)
    guidance_scale: float = Field(6.0, ge=0.0, le=30.0)
    width: int = Field(512, ge=64, le=1024)
    height: int = Field(512, ge=64, le=1024)
    num_frames: int = Field(16, ge=4, le=120)
    fps: int = Field(8, ge=1, le=60)
    seed: int | None = Field(None, ge=0, le=2**32 - 1)
    device: str = "auto"
    init_image_b64: str | None = Field(
        None, description="Data URL atau base64 untuk Gambar → Video. Jika diisi, gambar jadi frame awal."
    )
    strength: float = Field(0.6, ge=0.0, le=1.0)


@router.post("/generate")
def generate_video(req: VideoGenerateRequest):
    # Plain `def` → FastAPI jalankan di threadpool (inferensi berat).
    try:
        device = devices.resolve_device(req.device)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    import torch

    # Decode gambar awal jika mode Gambar → Video
    init_pil = None
    if req.init_image_b64:
        import base64
        import io
        from PIL import Image

        raw = req.init_image_b64.strip()
        if raw.startswith("data:"):
            raw = raw.split(",", 1)[1] if "," in raw else ""
        try:
            init_bytes = base64.b64decode(raw)
        except Exception as exc:
            raise HTTPException(400, f"Gambar awal tidak valid: {exc}") from exc
        if not init_bytes:
            raise HTTPException(400, "Gambar awal kosong.")
        try:
            init_pil = Image.open(io.BytesIO(init_bytes)).convert("RGB")
        except Exception as exc:
            raise HTTPException(400, f"Gagal membaca gambar awal: {exc}") from exc

    generator = None
    if req.seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(req.seed)

    try:
        if req.model_id == "animatediff":
            if not req.base_id:
                # Tetap izinkan tanpa base — akan fallback ke Wan-style txt2vid dengan note
                # tapi untuk AnimateDiff yang butuh base, beri pesan jelas
                raise HTTPException(
                    400,
                    "AnimateDiff butuh model dasar SD 1.5. Pilih salah satu di dropdown 'Model dasar', "
                    "atau ganti ke model Wan 2.1 / pilih '— Tanpa model dasar —' untuk coba mode lain.",
                )
            pipe = _get_or_load_animatediff(req.base_id, device)
            frames = pipe(
                prompt=req.prompt,
                negative_prompt=req.negative_prompt or None,
                num_frames=min(req.num_frames, 24),
                num_inference_steps=req.steps,
                guidance_scale=req.guidance_scale,
                width=req.width - (req.width % 16),
                height=req.height - (req.height % 16),
                generator=generator,
            ).frames[0]
            effective_frames = min(req.num_frames, 24)
            fps = max(4, min(req.fps, 16))
            # Jika ada gambar awal, pakai sebagai frame pertama (blend sesuai strength)
            if init_pil is not None:
                frames = _apply_init_image(frames, init_pil, req.width, req.height, req.strength)
        else:
            # Wan: coba Image-to-Video jika ada gambar awal dan pipeline I2V tersedia
            if init_pil is not None:
                try:
                    import diffusers  # noqa: F401

                    pipe_i2v = _get_or_load_wan_i2v(device)
                    result = pipe_i2v(
                        image=init_pil,
                        prompt=req.prompt,
                        negative_prompt=req.negative_prompt or None,
                        num_frames=req.num_frames,
                        num_inference_steps=req.steps,
                        guidance_scale=req.guidance_scale,
                        width=req.width - (req.width % 8),
                        height=req.height - (req.height % 8),
                        generator=generator,
                    )
                    frames = result.frames[0]
                    effective_frames = req.num_frames
                    fps = max(1, min(req.fps, 30))
                except Exception:
                    # Fallback ke T2V + blend frame pertama
                    pipe = _get_or_load_wan(device)
                    result = pipe(
                        prompt=req.prompt,
                        negative_prompt=req.negative_prompt or None,
                        num_frames=req.num_frames,
                        num_inference_steps=req.steps,
                        guidance_scale=req.guidance_scale,
                        width=req.width - (req.width % 8),
                        height=req.height - (req.height % 8),
                        generator=generator,
                    )
                    frames = result.frames[0]
                    frames = _apply_init_image(frames, init_pil, req.width, req.height, req.strength)
                    effective_frames = req.num_frames
                    fps = max(1, min(req.fps, 30))
            else:
                pipe = _get_or_load_wan(device)
                result = pipe(
                    prompt=req.prompt,
                    negative_prompt=req.negative_prompt or None,
                    num_frames=req.num_frames,
                    num_inference_steps=req.steps,
                    guidance_scale=req.guidance_scale,
                    width=req.width - (req.width % 8),
                    height=req.height - (req.height % 8),
                    generator=generator,
                )
                frames = result.frames[0]
                effective_frames = req.num_frames
                fps = max(1, min(req.fps, 30))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Generasi video gagal: {exc}")

    try:
        mp4_bytes = _encode_mp4_to_bytes(frames, fps)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))

    import base64
    b64 = base64.b64encode(mp4_bytes).decode("ascii")
    data_url = f"data:video/mp4;base64,{b64}"

    return {
        "video": data_url,
        "video_url": data_url,
        "seed": req.seed,
        "num_frames": effective_frames,
        "fps": fps,
        "width": req.width,
        "height": req.height,
        "model_id": req.model_id,
        "device": device,
    }


_io_counter = 0
_io_lock = threading.Lock()


def _next_io_id() -> int:
    global _io_counter
    with _io_lock:
        _io_counter += 1
        return int(time.time() * 1000) + _io_counter


# Pastikan folder output ada sejak awal (biar deploy/UX nyaman).
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)