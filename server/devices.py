from __future__ import annotations

import ctypes
import os
import sys

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


def _ram_info() -> dict | None:
    """Total & sisa RAM sistem (bytes). Pakai ctypes di Windows agar tanpa
    dependensi ekstra (psutil belum ada di requirements)."""
    try:
        if sys.platform == "win32":

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
                return {"total": stat.ullTotalPhys, "available": stat.ullAvailPhys}
        else:
            page = os.sysconf("SC_PAGE_SIZE")
            total = os.sysconf("SC_PHYS_PAGES") * page
            avail = os.sysconf("SC_AVPHYS_PAGES") * page
            return {"total": total, "available": avail}
    except (AttributeError, OSError, ValueError):
        pass
    return None


def _gpu_info() -> dict | None:
    """Info GPU pertama kalau CUDA tersedia (pakai torch yang sudah diinstall)."""
    try:
        import torch

        if not torch.cuda.is_available():
            return None
        props = torch.cuda.get_device_properties(0)
        return {
            "name": props.name,
            "vram": props.total_memory,
            "cuda_version": torch.version.cuda or "",
            "torch_version": torch.__version__,
        }
    except ImportError:
        return None


@router.get("/devices")
async def get_devices():
    return {
        "devices": available_devices(),
        "system": {"ram": _ram_info(), "gpu": _gpu_info()},
    }