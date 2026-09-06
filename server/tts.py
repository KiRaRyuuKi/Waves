"""Voice synthesis via VITS (vendored in vendor/vits).

Convention for adding a voice model — drop a folder under
server/storage/models/<model_id>/ containing:

  config.json   - the VITS hyperparameters this checkpoint was trained with
  meta.json     - {"name": str, "language": str, "sample_text": str,
                   "speakers": [{"id": int, "name": str}, ...]}
  a checkpoint  - model.pth (or any single *.pth file in the folder)

Nothing is bundled here — model weights are large and specific to
whatever character voices you have, so this only defines the contract
and loads whatever you place there.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import torch

VENDOR_VITS_DIR = Path(__file__).resolve().parent.parent / "vendor" / "vits"
if str(VENDOR_VITS_DIR) not in sys.path:
    # The vendored VITS modules (commons.py, models.py, text/, ...) use
    # flat, absolute imports (e.g. `import commons`), matching the
    # original single-folder repo layout. Adding its folder to sys.path
    # lets them resolve unmodified rather than rewriting every import.
    sys.path.insert(0, str(VENDOR_VITS_DIR))

import commons  # noqa: E402  (see path insert above)
import utils as vits_utils  # noqa: E402
from models import SynthesizerTrn  # noqa: E402
from text import text_to_sequence  # noqa: E402

MODELS_DIR = Path(__file__).resolve().parent / "storage" / "models"

# Dipakai otomatis untuk model yang foldernya tidak punya config.json sendiri.
# Berisi hyperparameter model multi-speaker "vits-models" (804 speaker) yang
# cocok dengan kumpulan checkpoint karakter di folder ini (lihat README).
DEFAULT_CONFIG_PATH = MODELS_DIR / "_default_config.json"


@dataclass
class VoiceModel:
    net_g: SynthesizerTrn
    hps: object
    n_speakers: int
    sampling_rate: int


_cache: dict[str, VoiceModel] = {}


def _load_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        return None


def _load_info_index() -> dict:
    """Catalog karakter (info.json) yang ditempel di akar MODELS_DIR."""
    raw = _load_json(MODELS_DIR / "info.json")
    return raw if isinstance(raw, dict) else {}


def _display_name(info: dict) -> str:
    # name_en duluan supaya yang tampil bukan nama Jepang (title biasanya
    # berisi suffix katakana, mis. "Honkai: Star Rail-カフカ").
    for key in ("name_en", "name_zh", "title"):
        value = info.get(key)
        if value:
            name = str(value).strip()
            return name[:1].upper() + name[1:]
    return ""


def _is_lfs_pointer(path: Path) -> bool:
    """Checkpoint yang masih pointer Git LFS (file kecil 'version https://git-lfs...')."""
    try:
        with open(path, "rb") as f:
            head = f.read(64)
        return head.startswith(b"version https://git-lfs")
    except OSError:
        return True


def _pointer_target_size(path: Path) -> int | None:
    try:
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.startswith("size "):
                return int(line.split()[1])
    except (OSError, ValueError):
        return None
    return None


def _real_checkpoint_candidates(model_dir: Path) -> list[Path]:
    found = []
    for name in ("model.pth", "G.pth", "checkpoint.pth"):
        candidate = model_dir / name
        if candidate.exists() and not _is_lfs_pointer(candidate):
            found.append(candidate)
    for candidate in sorted(model_dir.glob("*.pth")):
        if candidate.exists() and not _is_lfs_pointer(candidate):
            found.append(candidate)
    return found


def _shared_weights_path(size: int) -> Path | None:
    """Cari file .pth asli (bukan pointer) dengan ukuran byte yang sama di koleksi.
    Kumpulan karakter di folder ini adalah satu model multi-speaker yang disalin per
    karakter — selama pointer LFS-nya menyebut ukuran yang sama, bobotnya bisa dipakai
    bersama dari file yang sudah ter-download (mis. kafka.pth)."""
    if not MODELS_DIR.exists():
        return None
    for entry in sorted(MODELS_DIR.iterdir()):
        if not entry.is_dir():
            continue
        for candidate in entry.glob("*.pth"):
            if candidate.exists() and not _is_lfs_pointer(candidate):
                try:
                    if candidate.stat().st_size == size:
                        return candidate
                except OSError:
                    continue
    return None


def _model_is_ready(model_dir: Path) -> bool:
    if _real_checkpoint_candidates(model_dir):
        return True
    for pointer in model_dir.glob("*.pth"):
        size = _pointer_target_size(pointer)
        if size is not None and _shared_weights_path(size) is not None:
            return True
    return False


def _game_of(info: dict) -> str:
    """Nama game/franchise diurai dari prefix title (mis. "Honkai: Star Rail-カフカ")."""
    title = str(info.get("title") or "")
    if "-" in title:
        return title.split("-", 1)[0].strip()
    return ""


def list_models() -> list[dict]:
    """Scan MODELS_DIR dan tampilkan tiap karakter sebagai model.

    Prioritas metadata per folder:
      1. meta.json (model lama/kustom) — dipakai apa adanya.
      2. info.json (catalog karakter) — nama karakter dipakai sebagai nama model;
         `sid` darinya jadi speaker default, jadi user cukup memilih NAMA karakter,
         tidak perlu tahu id numerik.
    Sebuah folder cukup berisi `*.pth` untuk dikenali; `config.json` bisa juga
    diabaikan karena DefaultConfig dipakai otomatis (lihat _get_or_load).
    """
    if not MODELS_DIR.exists():
        return []
    index = _load_info_index()
    found: dict[str, dict] = {}
    for entry in sorted(MODELS_DIR.iterdir()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        model_id = entry.name
        has_pth = any(entry.glob("*.pth")) or any(entry.glob("*.ckpt"))
        if not has_pth:
            continue
        meta = _load_json(entry / "meta.json")
        if isinstance(meta, dict):
            info = index.get(model_id)
            meta.setdefault("default_sid", (info or {}).get("sid", 0))
            meta.setdefault("ready", _model_is_ready(entry))
            found[model_id] = {"id": model_id, **meta}
            continue
        info = index.get(model_id)
        if not isinstance(info, dict) or info.get("enable") is False:
            continue
        name = _display_name(info) or model_id
        sid = int(info.get("sid", 0) or 0)
        ready = _model_is_ready(entry)
        found[model_id] = {
            "id": model_id,
            "name": name,
            "game": _game_of(info),
            "language": info.get("language", ""),
            "sample_text": info.get("example", ""),
            "speakers": [{"id": sid, "name": name}],
            "default_sid": sid,
            "ready": ready,
        }
    return sorted(found.values(), key=lambda m: (not m.get("ready", m.get("enable", True)), str(m["id"])))


def _load_state_dict(checkpoint_path: Path) -> dict:
    # Checkpoints "in the wild" show up in a couple of shapes depending on
    # which training/finetuning script produced them: a plain state_dict,
    # or a dict wrapping one under a "model"/"state_dict" key alongside
    # training metadata (iteration, optimizer, ...). Handle both.
    obj = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    if isinstance(obj, dict):
        for key in ("model", "state_dict", "generator"):
            if key in obj and isinstance(obj[key], dict):
                return obj[key]
        return obj  # assume it's already a raw state_dict
    raise RuntimeError(
        f"Format checkpoint di {checkpoint_path} tidak dikenali (bukan dict/state_dict)."
    )


def _get_or_load(model_id: str) -> VoiceModel:
    model_dir = MODELS_DIR / model_id
    if not model_dir.is_dir():
        raise FileNotFoundError(f"Model '{model_id}' tidak ditemukan di {MODELS_DIR}")

    config_path = model_dir / "config.json"
    shared_checkpoint: Path | None = None
    if not config_path.exists():
        config_path = DEFAULT_CONFIG_PATH
    if not config_path.exists():
        raise FileNotFoundError(
            f"Tidak ada config.json di {model_dir} dan tidak ada config default ({DEFAULT_CONFIG_PATH})."
        )

    checkpoint_path = next(iter(_real_checkpoint_candidates(model_dir)), None)
    if checkpoint_path is None:
        for pointer in sorted(model_dir.glob("*.pth")):
            size = _pointer_target_size(pointer)
            if size is None:
                continue
            shared = _shared_weights_path(size)
            if shared is not None:
                checkpoint_path = shared
                shared_checkpoint = pointer.name
                break
    if checkpoint_path is None:
        raise FileNotFoundError(
            f"Tidak ada checkpoint VITS yang valid di {model_dir}. "
            "File *.pth yang ada masih berisi pointer Git LFS (belum ter-download) "
            "dan tidak ada model lain dengan ukuran sama di koleksi."
        )

    cache_key = str(checkpoint_path) if shared_checkpoint else model_id
    if cache_key in _cache:
        return _cache[cache_key]

    hps = vits_utils.get_hparams_from_file(str(config_path))
    n_speakers = getattr(hps.data, "n_speakers", 0) or 0

    net_g = SynthesizerTrn(
        len(hps.symbols),
        hps.data.filter_length // 2 + 1,
        hps.train.segment_size // hps.data.hop_length,
        n_speakers=n_speakers,
        **hps.model,
    )
    net_g.eval()

    state_dict = _load_state_dict(checkpoint_path)
    missing_or_unexpected = net_g.load_state_dict(state_dict, strict=False)
    if missing_or_unexpected.missing_keys:
        print(f"[vits] {model_id}: {len(missing_or_unexpected.missing_keys)} tensor tidak ada di checkpoint")

    entry = VoiceModel(net_g=net_g, hps=hps, n_speakers=n_speakers, sampling_rate=hps.data.sampling_rate)
    _cache[cache_key] = entry
    if shared_checkpoint:
        print(
            f"[vits] {model_id}: {shared_checkpoint} masih pointer LFS, memakai bobot bersama "
            f"{checkpoint_path.name} (koleksi multi-speaker), speaker via sid dari info.json"
        )
    return entry


_JA_KANA_RE = re.compile(r"[\u3040-\u30ff]")
_ZH_HAN_RE = re.compile(r"[\u4e00-\u9fff]")


def _tag_missing_language(text: str) -> str:
    """Cleaner zh_ja_mixture hanya memproses segmen yang dibungkus [JA]...[JA]
    atau [ZH]...[ZH]; teks yang tidak bertanda dibiarkan apa adanya (kalau yang
    dibiarkan itu kana/kanji, nilainya di luar tabel simbol dan jadi len 1 /
    senyap). Kalau user belum menandai bahasanya, deteksi otomatis dan bungkus."""
    if "[JA]" in text or "[ZH]" in text:
        return text
    if _JA_KANA_RE.search(text):
        return f"[JA]{text}[JA]"
    if _ZH_HAN_RE.search(text):
        return f"[ZH]{text}[ZH]"
    return text


def _prepare_text(text: str, hps) -> torch.LongTensor:
    text = _tag_missing_language(text)
    sequence, _clean = text_to_sequence(text, hps.symbols, hps.data.text_cleaners)
    if getattr(hps.data, "add_blank", False):
        sequence = commons.intersperse(sequence, 0)
    return torch.LongTensor(sequence)


def synthesize(
    model_id: str,
    text: str,
    speaker_id: int = 0,
    noise_scale: float = 0.667,
    noise_scale_w: float = 0.8,
    length_scale: float = 1.0,
) -> tuple[int, np.ndarray]:
    """Returns (sample_rate, mono float32 waveform)."""
    model = _get_or_load(model_id)
    text_ids = _prepare_text(text, model.hps)

    with torch.no_grad():
        x_tst = text_ids.unsqueeze(0)
        x_tst_lengths = torch.LongTensor([text_ids.size(0)])
        sid: Optional[torch.LongTensor] = (
            torch.LongTensor([speaker_id]) if model.n_speakers > 0 else None
        )
        audio = model.net_g.infer(
            x_tst,
            x_tst_lengths,
            sid=sid,
            noise_scale=noise_scale,
            noise_scale_w=noise_scale_w,
            length_scale=length_scale,
        )[0][0, 0].data.cpu().float().numpy()

    return model.sampling_rate, audio
