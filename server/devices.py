"""Shared device resolution (cpu / cuda / auto) across features.

Semua fitur yang berat (stem demucs, VITS, fine-tune, diffusers) memakai
helper ini supaya pilihan "Auto / CPU / CUDA" konsisten: frontend memilih
string mentah, backend menyelesaikan ke device betulan. "auto" berarti
CUDA kalau tersedia, fallback ke CPU.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["devices"])

AUTO = "auto"
CPU = "cpu"
CUDA = "cuda"

_ALLOWED = (AUTO, CPU, CUDA)


def _cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except ImportError:
        return False


def available_devices() -> list[str]:
    devices = [CPU]
    if _cuda_available():
        devices.append(CUDA)
    return devices


def resolve_device(device: str) -> str:
    """Ubah pilihan user menjadi device betulan ('cpu'/'cuda').

    'auto' / kosong -> CUDA kalau tersedia, kalau tidak CPU. 'cuda' eksplisit
    saat GPU tidak ada -> ValueError supaya bisa dilaporkan sebagai 400.
    """
    choice = (device or AUTO).strip().lower() or AUTO
    if choice not in _ALLOWED:
        raise ValueError(f"Device tak dikenal: '{device}'.")
    if choice == AUTO:
        return CUDA if _cuda_available() else CPU
    if choice == CUDA and not _cuda_available():
        raise ValueError("CUDA diminta tapi tidak tersedia (torch tidak melihat GPU).")
    return choice


@router.get("/devices")
async def get_devices():
    return {"devices": available_devices()}