from __future__ import annotations

import inspect
import io
import os
import sys
from pathlib import Path
from typing import Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
REMOVER_ROOT = PROJECT_ROOT / "server" / "storage" / "remover"

# Paksa env agar rembg tidak pernah menyentuh ~/.rembg atau ~/.u2net
os.environ["REMBG_HOME"] = str(REMOVER_ROOT)
os.environ["U2NET_HOME"] = str(REMOVER_ROOT)
# Optional: cegah pooch download ulang via XDG
os.environ["XDG_DATA_HOME"] = str(PROJECT_ROOT / "server" / "storage")

REMOVER_ROOT.mkdir(parents=True, exist_ok=True)

def _is_in_project(p: Path) -> bool:
    try:
        p.resolve().relative_to(PROJECT_ROOT.resolve())
        return True
    except ValueError:
        return False

def _enforce_project_runtime():
    exe = Path(sys.executable).resolve()
    # Hanya izinkan python yang berada di dalam PROJECT_ROOT (.venv)
    # Ini menjamin "hanya di project ini dan python project ini saja yang bisa"
    if not _is_in_project(exe):
        # Beri pesan jelas — user diminta pakai .venv
        raise PermissionError(
            f"remove background hanya bisa digunakan di project Waves. "
            f"Python yang dipakai ({exe}) berada di luar project. "
            f"Gunakan: {PROJECT_ROOT / '.venv' / 'Scripts' / 'python.exe'}"
        )
    # Pastikan REMBG_HOME masih mengarah ke dalam project
    rh = Path(os.environ.get("REMBG_HOME", "")).resolve()
    if not _is_in_project(rh):
        raise PermissionError(
            f"REMBG_HOME harus di dalam project ({REMOVER_ROOT}), tapi sekarang: {rh}"
        )
    # Validasi caller berada di dalam project (cegah import dari script luar)
    for frame in inspect.stack()[2:8]:
        fname = frame.filename
        # lewati frame internal / site-packages / stdlib
        if "site-packages" in fname or "importlib" in fname:
            continue
        # file caller harus ada dan di dalam project
        caller = Path(fname)
        if caller.is_file():
            # jika caller adalah file di luar project -> tolak
            if not _is_in_project(caller):
                raise PermissionError(
                    f"remove background hanya bisa dipanggil di dalam project Waves. "
                    f"Caller di luar project: {caller}"
                )
            # caller valid di dalam project -> izinkan
            return
    # jika tidak ada caller file eksternal, anggap dari dalam project (mis. API)

try:
    from rembg.sessions.base import BaseSession
    from rembg.sessions import sessions_class

    # Simpan original untuk debug (optional)
    _orig_rembg_home = BaseSession.rembg_home
    _orig_legacy_home = BaseSession.legacy_home
    _orig_model_dir = BaseSession.model_dir
    _orig_resolve = BaseSession.resolve_existing
    _orig_validate = BaseSession.validate_model_path

    @classmethod
    def _patched_rembg_home(cls, *a, **k):
        return str(REMOVER_ROOT)

    @classmethod
    def _patched_legacy_home(cls, *a, **k):
        return str(REMOVER_ROOT)

    @classmethod
    def _patched_model_dir(cls, *a, **k):
        # Layout project: server/storage/remover/<model>/<model>.onnx
        # Juga dukung layout standar: server/storage/remover/models/<model>/<model>.onnx
        # Prioritaskan layout project (tanpa models)
        direct = REMOVER_ROOT / cls.name(*a, **k)
        # jika folder direct ada, pakai itu; fallback ke models/
        if direct.is_dir():
            return str(direct)
        return str(REMOVER_ROOT / "models" / cls.name(*a, **k))

    @classmethod
    def _patched_resolve_existing(cls, fname, *a, **k):
        # Cek semua kemungkinan layout di dalam REMOVER_ROOT saja
        name = cls.name(*a, **k)
        candidates = [
            REMOVER_ROOT / name / fname,
            REMOVER_ROOT / "models" / name / fname,
            REMOVER_ROOT / fname,
        ]
        for p in candidates:
            if p.is_file():
                return str(p)
        return None

    @classmethod
    def _patched_validate(cls, *a, **k):
        model_path = k.get("model_path")
        if model_path is None:
            raise ValueError("model_path is required")
        abs_path = os.path.abspath(os.path.expanduser(model_path))
        allowed_root = os.path.abspath(str(REMOVER_ROOT))
        if abs_path == allowed_root or abs_path.startswith(allowed_root + os.sep):
            return abs_path
        raise ValueError(
            f"model_path harus di dalam {allowed_root}. "
            f"Tolak akses luar project: {abs_path}"
        )

    BaseSession.rembg_home = _patched_rembg_home
    BaseSession.legacy_home = _patched_legacy_home
    BaseSession.u2net_home = _patched_rembg_home
    BaseSession.model_dir = _patched_model_dir
    BaseSession.resolve_existing = _patched_resolve_existing
    BaseSession.validate_model_path = _patched_validate

    # Patch setiap session agar tidak pernah download via pooch
    for _cls in sessions_class:
        @classmethod
        def _patched_download(cls_, *a, **kw):
            fname = f"{cls_.name(*a, **kw)}.onnx"
            existing = cls_.resolve_existing(fname, *a, **kw)
            if existing is not None:
                return existing
            raise FileNotFoundError(
                f"Model '{cls_.name(*a, **kw)}' tidak ditemukan di {REMOVER_ROOT}. "
                f"Letakkan file ONNX di: {REMOVER_ROOT / cls_.name(*a, **kw) / fname} "
                f"atau {REMOVER_ROOT / 'models' / cls_.name(*a, **kw) / fname}. "
                f"Tidak ada download otomatis ke ~/.rembg."
            )
        _cls.download_models = _patched_download

except Exception as _e:
    # Jika rembg belum terpasang di venv, biarkan error muncul saat endpoint dipanggil
    # Jangan crash saat import server.waves
    import warnings
    warnings.warn(f"remover patch gagal (rembg belum terpasang?): {_e}")

def _scan_models() -> list[dict]:
    out = []
    if not REMOVER_ROOT.is_dir():
        return out
    # Cari folder yang berisi *.onnx
    for entry in sorted(REMOVER_ROOT.iterdir()):
        if entry.name.startswith(".") or entry.name == "models":
            continue
        if entry.is_dir():
            onnx = entry / f"{entry.name}.onnx"
            alt = list(entry.glob("*.onnx"))
            if onnx.is_file() or alt:
                size = sum(f.stat().st_size for f in alt if f.is_file())
                out.append({
                    "id": entry.name,
                    "name": entry.name,
                    "path": str((onnx if onnx.is_file() else alt[0]).resolve()),
                    "size": size,
                    "installed": True,
                })
    # Juga cek layout models/
    models_dir = REMOVER_ROOT / "models"
    if models_dir.is_dir():
        for entry in sorted(models_dir.iterdir()):
            if entry.is_dir() and not any(o["id"] == entry.name for o in out):
                alt = list(entry.glob("*.onnx"))
                if alt:
                    size = sum(f.stat().st_size for f in alt if f.is_file())
                    out.append({
                        "id": entry.name,
                        "name": entry.name,
                        "path": str(alt[0].resolve()),
                        "size": size,
                        "installed": True,
                    })
    return out

def list_models() -> list[dict]:
    _enforce_project_runtime()
    # Known models from Setup tasks (remover) — muncul meski belum diunduh.
    known_defs = [
        {"id": "u2net", "name": "U²-Net", "description": "Model general-purpose seimbang untuk objek umum (~168 MB)."},
        {"id": "isnet", "name": "ISNet General Use", "description": "ISNet detail tinggi untuk rambut/bulu/tepi halus (~170 MB)."},
        {"id": "silueta", "name": "Silueta", "description": "Ringan khusus siluet manusia full-body (~42 MB)."},
    ]
    existing = {m["id"]: m for m in _scan_models()}
    out: list[dict] = []
    # Pertama, kembalikan model yang dikenal dengan status installed.
    for kd in known_defs:
        mid = kd["id"]
        if mid in existing:
            out.append(existing[mid])
        else:
            out.append({
                "id": mid,
                "name": kd["name"],
                "description": kd["description"],
                "path": "",
                "size": 0,
                "installed": False,
            })
    # Lalu tambahkan model kustom yang tidak ada di daftar dikenal.
    for mid, info in existing.items():
        if mid not in {kd["id"] for kd in known_defs}:
            out.append(info)
    return out

# Cache session per model agar tidak reload ONNX tiap request
_session_cache: dict[str, object] = {}

def _get_session(model_id: str):
    _enforce_project_runtime()
    if model_id in _session_cache:
        return _session_cache[model_id]
    # Validasi model_id hanya huruf/angka/-_
    import re
    if not re.fullmatch(r"[a-z0-9_-]+", model_id):
        raise ValueError(f"model_id tidak valid: {model_id}")
    # Pastikan model ada di disk
    models = {m["id"]: m for m in _scan_models()}
    if model_id not in models:
        raise FileNotFoundError(
            f"Model '{model_id}' tidak ditemukan di {REMOVER_ROOT}. "
            f"Model tersedia: {list(models.keys()) or 'tidak ada'}"
        )
    from rembg.session_factory import new_session
    # REMBG_HOME sudah dipaksa ke REMOVER_ROOT, jadi new_session akan
    # memanggil patched download_models yang hanya cek lokal
    sess = new_session(model_id)
    _session_cache[model_id] = sess
    return sess

def remove_background_bytes(image_bytes: bytes, model_id: str = "u2net") -> bytes:
    """Hapus background dari image bytes, return PNG bytes (RGBA). Hanya di project."""
    _enforce_project_runtime()
    from rembg import remove
    sess = _get_session(model_id)
    out = remove(image_bytes, session=sess)
    if isinstance(out, bytes):
        return out
    # fallback PIL
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import Response

router = APIRouter(prefix="/api/remover", tags=["remover"])

@router.get("/models")
async def api_list_models(request: Request):
    # Tolak jika bukan dari localhost (cegah akses luar project via network)
    host = request.client.host if request.client else ""
    if host not in ("127.0.0.1", "::1", "localhost"):
        # Tetap izinkan jika origin localhost (frontend proxy)
        # di dev, host bisa 127.0.0.1 — jika deploy lokal, ini aman
        pass  # tidak strict block, tapi log
    try:
        models = list_models()
    except PermissionError as e:
        raise HTTPException(403, str(e))
    return {"remover_root": str(REMOVER_ROOT), "models": models, "project": str(PROJECT_ROOT)}

@router.post("/remove")
async def api_remove(
    request: Request,
    file: UploadFile = File(...),
    model: str = Form("u2net"),
):
    # Guard project
    try:
        _enforce_project_runtime()
    except PermissionError as e:
        raise HTTPException(403, str(e))
    # Validasi model
    model = model.strip().lower()
    data = await file.read()
    if not data:
        raise HTTPException(400, "File kosong")
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(400, "File terlalu besar (maks 20MB)")
    # Validasi magic bytes gambar
    if not (data.startswith(b"\x89PNG") or data.startswith(b"\xff\xd8\xff") or data.startswith(b"GIF") or data.startswith(b"RIFF") or data[:2] == b"BM"):
        # tetap izinkan, rembg/Pillow akan error jika bukan gambar
        pass
    try:
        out = remove_background_bytes(data, model_id=model)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"Gagal hapus background: {e}")
    return Response(content=out, media_type="image/png", headers={
        "Content-Disposition": f'inline; filename="{Path(file.filename or "output").stem or "output"}-nobg.png"'
    })

@router.get("/health")
async def health():
    return {
        "status": "ok",
        "rembg_home": os.environ.get("REMBG_HOME"),
        "u2net_home": os.environ.get("U2NET_HOME"),
        "remover_root": str(REMOVER_ROOT),
        "python": sys.executable,
        "in_project": _is_in_project(Path(sys.executable)),
        "models": _scan_models(),
    }
