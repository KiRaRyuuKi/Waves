from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
from typing import Any
from urllib.parse import urlparse, unquote

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/downloader", tags=["downloader"])

SUPPORTED_HOSTS: set[str] = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "instagram.com",
    "www.instagram.com",
    "facebook.com",
    "www.facebook.com",
    "web.facebook.com",
    "fb.watch",
    "x.com",
    "www.x.com",
    "twitter.com",
    "www.twitter.com",
}

PLATFORM_NAMES: dict[str, str] = {
    "youtube.com": "YouTube",
    "www.youtube.com": "YouTube",
    "m.youtube.com": "YouTube",
    "youtu.be": "YouTube",
    "instagram.com": "Instagram",
    "www.instagram.com": "Instagram",
    "facebook.com": "Facebook",
    "www.facebook.com": "Facebook",
    "web.facebook.com": "Facebook",
    "fb.watch": "Facebook",
    "x.com": "X",
    "www.x.com": "X",
    "twitter.com": "X",
    "www.twitter.com": "X",
}

VIDEO_EXTS: set[str] = {"mp4", "mkv", "webm"}
VIDEO_MIN_HEIGHT = 720
AUDIO_MIN_ABR = 128
AUDIO_NATIVE_EXTS: set[str] = {"m4a", "mp3", "opus", "ogg", "aac"}
AUDIO_BITRATES: list[int] = [128, 192, 256, 320]
MP3_PATTERN = re.compile(r"^mp3@(\d+)$", re.IGNORECASE)

YTDLP_TIMEOUT = 90


def _validate_url(url: str) -> str:
    import ipaddress
    import socket

    try:
        parsed = urlparse(url)
        host = parsed.hostname or ""
        if parsed.scheme not in ("http", "https"):
            raise HTTPException(status_code=400, detail="URL tidak valid")
    except Exception:
        raise HTTPException(status_code=400, detail="URL tidak valid")

    if host not in SUPPORTED_HOSTS:
        raise HTTPException(
            status_code=400,
            detail="Platform tidak didukung. Hanya YouTube, Instagram, Facebook, dan X (Twitter) yang didukung.",
        )

    # A10 SSRF defense-in-depth: blokir IP privat meski host allowlist (anti DNS rebinding)
    try:
        ip = ipaddress.ip_address(socket.gethostbyname(host))
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise HTTPException(status_code=403, detail="Akses ke alamat internal tidak diizinkan")
        # blokir cloud metadata & link-local
        if ip in ipaddress.ip_network("169.254.0.0/16"):
            raise HTTPException(status_code=403, detail="Akses ke metadata tidak diizinkan")
    except HTTPException:
        raise
    except Exception:
        # jika DNS gagal, biarkan yt-dlp yang handle — tapi jangan bocorkan internal
        pass

    return PLATFORM_NAMES.get(host, host)


def _run_ytdlp(args: list[str], timeout: int = YTDLP_TIMEOUT) -> str:
    proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise HTTPException(
            status_code=400,
            detail=proc.stderr.strip() or "Gagal memproses URL",
        )
    return proc.stdout


def _format_bytes(size: int | None) -> str:
    if not size or size <= 0:
        return ""
    if size >= 1024**3:
        return f"{size / 1024**3:.1f} GB"
    if size >= 1024**2:
        return f"{size / 1024**2:.0f} MB"
    return f"{size / 1024:.0f} KB"


def _format_bitrate(kbps: float) -> int:
    return round(kbps / 16) * 16


def _build_formats(data: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    formats = data.get("formats") or []

    video_map: dict[tuple[int, int], dict[str, Any]] = {}
    for f in formats:
        vcodec = f.get("vcodec")
        if not vcodec or vcodec == "none":
            continue
        ext = (f.get("ext") or "").lower()
        if ext not in VIDEO_EXTS:
            continue
        height = int(f.get("height") or 0)
        if height < VIDEO_MIN_HEIGHT:
            continue
        fps = int(f.get("fps") or 30)
        key = (height, fps)
        tbr = float(f.get("tbr") or 0)
        if key not in video_map or tbr > float(video_map[key].get("tbr", 0)):
            video_map[key] = f

    video_formats: list[dict[str, Any]] = []
    for (height, fps), f in sorted(video_map.items(), key=lambda p: -p[0][0]):
        fid = str(f.get("format_id") or "")
        filesize = f.get("filesize") or f.get("filesize_approx")
        video_formats.append(
            {
                "format_id": f"{fid}+bestaudio/best",
                "quality": f"{height}p",
                "fps": fps,
                "ext": f.get("ext") or "mp4",
                "filesize": _format_bytes(filesize),
            }
        )

    video_formats.insert(
        0,
        {
            "format_id": "bestvideo[height>=720]+bestaudio/best",
            "quality": "Terbaik (Auto)",
            "fps": None,
            "ext": "mp4",
            "filesize": "",
        },
    )

    audio_formats: list[dict[str, Any]] = []
    seen_bitrate: set[str] = set()

    for f in formats:
        acodec = f.get("acodec")
        if not acodec or acodec == "none":
            continue
        vcodec = f.get("vcodec")
        if vcodec and vcodec != "none":
            continue
        ext = (f.get("ext") or "").lower()
        if ext not in AUDIO_NATIVE_EXTS:
            continue
        abr = float(f.get("abr") or 0)
        if abr < AUDIO_MIN_ABR:
            continue
        rounded = _format_bitrate(abr)
        if rounded < AUDIO_MIN_ABR:
            continue
        bitrate = f"{rounded}k"
        if bitrate in seen_bitrate:
            continue
        seen_bitrate.add(bitrate)
        audio_formats.append(
            {
                "format_id": str(f.get("format_id") or ""),
                "bitrate": bitrate,
                "ext": ext,
            }
        )

    for bitrate in AUDIO_BITRATES:
        audio_formats.append(
            {
                "format_id": f"mp3@{bitrate}",
                "bitrate": f"{bitrate}k",
                "ext": "mp3",
            }
        )

    return video_formats, audio_formats


@router.get("/info")
async def info(url: str) -> dict[str, Any]:
    platform = _validate_url(url)
    stdout = _run_ytdlp(
        ["yt-dlp", "--dump-single-json", "--no-playlist", "--no-warnings", url]
    )
    data = json.loads(stdout)

    video_formats, audio_formats = _build_formats(data)

    duration = data.get("duration")
    if duration is not None:
        duration = f"{int(duration // 60)}:{int(duration % 60):02d}"

    return {
        "title": data.get("title") or "Unknown Title",
        "thumbnail": data.get("thumbnail") or "",
        "platform": platform,
        "duration": duration,
        "uploader": data.get("uploader") or "",
        "video_formats": video_formats,
        "audio_formats": audio_formats,
    }


@router.get("/data")
async def data(url: str, type: str = "video", format_id: str = "", title: str = ""):
    _validate_url(url)
    format_id = unquote(format_id) if format_id else (
        "bestvideo+bestaudio/best" if type == "video" else "bestaudio/best"
    )

    tmpdir = tempfile.mkdtemp(prefix="waves-dl-")
    template = os.path.join(tmpdir, "%(title)s.%(ext)s")

    args = ["yt-dlp", "--no-playlist", "--no-warnings", "--restrict-filenames", "-o", template]

    mp3_match = MP3_PATTERN.match(format_id) if type == "audio" else None
    if type == "audio" and mp3_match:
        args += [
            "-f", "bestaudio/best",
            "-x", "--audio-format", "mp3",
            "--audio-quality", f"{mp3_match.group(1)}K",
        ]
    else:
        args += ["-f", format_id]
        if type == "video":
            args += ["--merge-output-format", "mp4"]

    args += ["--print", "after_move:filepath", "--print", "filepath", url]

    proc = await asyncio.to_thread(
        subprocess.run, args, capture_output=True, text=True, timeout=600
    )

    if proc.returncode != 0:
        shutil.rmtree(tmpdir, ignore_errors=True)
        detail = (proc.stderr or "").strip().splitlines()
        raise HTTPException(400, detail[-1] if detail else "Gagal mengunduh")

    filepath = ""
    for line in reversed((proc.stdout or "").splitlines()):
        stripped = line.strip().strip('"').strip("'")
        if stripped and os.path.isfile(stripped):
            filepath = stripped
            break

    if not filepath or not os.path.isfile(filepath):
        import glob
        files = glob.glob(os.path.join(tmpdir, "*"))
        if files:
            filepath = max(files, key=os.path.getmtime)
        else:
            shutil.rmtree(tmpdir, ignore_errors=True)
            raise HTTPException(400, "File hasil unduhan tidak ditemukan")

    filename = os.path.basename(filepath)
    if title:
        stem, _ext = os.path.splitext(filename)
        safe = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", title).strip(" .")[:150]
        filename = f"{safe or stem}{os.path.splitext(filepath)[1]}"
    media_type = "audio/mpeg" if type == "audio" else None
    return FileResponse(
        filepath,
        media_type=media_type,
        filename=filename,
        background=BackgroundTask(shutil.rmtree, tmpdir, ignore_errors=True),
    )
