from __future__ import annotations

from pathlib import Path
from typing import BinaryIO, Iterable

from fastapi import HTTPException, UploadFile

CHUNK_SIZE = 1024 * 256

MAX_AUDIO_UPLOAD = 500 * 1024 * 1024
MAX_IMAGE_UPLOAD = 20 * 1024 * 1024
MAX_DATASET_AUDIO = 100 * 1024 * 1024
MAX_DATASET_FILES = 200

AUDIO_SUFFIXES = {
    ".wav", ".mp3", ".flac", ".ogg", ".opus", ".m4a",
    ".aac", ".aiff", ".aif", ".wma", ".caf",
}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}


def _human(size: int) -> str:
    if size >= 1024**3:
        return f"{size / 1024**3:.1f} GB"
    return f"{size / 1024**2:.0f} MB"


def safe_suffix(filename: str | None, allowed: Iterable[str], fallback: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    return suffix if suffix in set(allowed) else fallback


def copy_limited(src: BinaryIO, dest: Path, max_bytes: int) -> int:
    """Salin stream ke disk dengan batas ukuran keras.

    Streaming (bukan read() penuh) supaya file raksasa tidak dimakan seluruhnya
    di RAM; begitu melewati batas, file parsial dihapus dan request ditolak.
    """
    written = 0
    try:
        with dest.open("wb") as out:
            while True:
                chunk = src.read(CHUNK_SIZE)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(
                        413, f"Ukuran file melebihi batas {_human(max_bytes)}"
                    )
                out.write(chunk)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise
    except OSError as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(500, f"Gagal menyimpan file: {exc}") from exc
    return written


async def read_limited(file: UploadFile, max_bytes: int) -> bytes:
    """Baca UploadFile ke memory dengan batas ukuran (anti memory-DoS)."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(413, f"Ukuran file melebihi batas {_human(max_bytes)}")
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        raise HTTPException(400, "File kosong")
    return data
