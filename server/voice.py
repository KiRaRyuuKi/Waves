from __future__ import annotations

import io

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import tts

router = APIRouter(prefix="/api/voice", tags=["voice"])


@router.get("/models")
async def get_models():
    return {"models": tts.list_models()}


@router.get("/models/{model_id}/cover")
async def get_cover(model_id: str):
    model_dir = tts.MODELS_DIR / model_id
    if not model_dir.is_dir():
        raise HTTPException(404, "Model not found")
    for candidate in sorted(model_dir.glob("cover.*")):
        return FileResponse(candidate, headers={"Cache-Control": "no-store"})
    raise HTTPException(404, "Cover not found")


class SynthesizeRequest(BaseModel):
    model_id: str
    text: str = Field(min_length=1, max_length=500)
    speaker_id: int = 0
    noise_scale: float = 0.667
    noise_scale_w: float = 0.8
    length_scale: float = 1.0


@router.post("/synthesize")
def synthesize(req: SynthesizeRequest):
    # Declared as a plain `def` (not async) so FastAPI runs this CPU-bound
    # inference in its worker threadpool instead of blocking the event loop.
    try:
        sample_rate, audio = tts.synthesize(
            model_id=req.model_id,
            text=req.text,
            speaker_id=req.speaker_id,
            noise_scale=req.noise_scale,
            noise_scale_w=req.noise_scale_w,
            length_scale=req.length_scale,
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    except Exception as exc:  # noqa: BLE001 - surface inference failures as 500s with detail
        raise HTTPException(500, f"Sintesis gagal: {exc}")

    import soundfile as sf

    buffer = io.BytesIO()
    sf.write(buffer, audio, sample_rate, format="WAV", subtype="PCM_16")
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="audio/wav")
