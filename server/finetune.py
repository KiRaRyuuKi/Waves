"""Fine-tuning VITS (kafka base) ke bahasa Indonesia.

Alur:
  1. Muat bobot model dasar (kafka) + hyperparameter dari _default_config.json.
  2. Baca pasangan audio+transkrip dari folder dataset (hasil upload API).
  3. Loop pelatihan GAN (generator + MultiPeriodDiscriminator) ala upstream
     vits/train.py, jalan di CPU tanpa perlu CUDA.
  4. Simpan hasil sebagai model baru di server/storage/models/<model_id>/,
     lalu muncul otomatis di list_models() / /api/voice/models.

Catatan penting yang membedakan dengan upstream:
  - `segment_size` instan model dipakai dalam FRAME z (8192 sampel / 256 hop
    = 32 frame), jadi segmen latih cukup audio >= 8192 sampel (~0.4 dtk).
  - Mel target dihitung dari irisan audio (bukan slice spektrogram frame),
    konsisten dengan mel y_hat generator.
  - Cleaner teks: indonesian_cleaners (vendor/vits/text/id.py).
"""

from __future__ import annotations

import json
import random
import time
from pathlib import Path

import librosa
import numpy as np
import torch
import torch.nn.functional as F

from . import tts

torch.set_num_threads(max(1, min(8, torch.get_num_threads())))


def _load_base_net(hps, checkpoint_path: Path) -> torch.nn.Module:
    from models import SynthesizerTrn

    net_g = SynthesizerTrn(
        len(hps.symbols),
        hps.data.filter_length // 2 + 1,
        hps.train.segment_size // hps.data.hop_length,
        n_speakers=getattr(hps.data, "n_speakers", 0) or 0,
        **hps.model,
    )
    state = tts._load_state_dict(checkpoint_path)
    missing = net_g.load_state_dict(state, strict=False).missing_keys
    if missing:
        print(f"[finetune] {len(missing)} tensor tidak ada di checkpoint dasar")
    return net_g


def _base_checkpoint(model_id: str) -> Path:
    model_dir = tts.MODELS_DIR / model_id
    checkpoint = next(iter(tts._real_checkpoint_candidates(model_dir)), None)
    if checkpoint is not None:
        return checkpoint
    for pointer in sorted(model_dir.glob("*.pth")):
        size = tts._pointer_target_size(pointer)
        if size is None:
            continue
        shared = tts._shared_weights_path(size)
        if shared is not None:
            return shared
    raise FileNotFoundError(f"Tidak ada checkpoint asli untuk model dasar '{model_id}'.")


def _loop_extend(audio: np.ndarray, target: int, sampling_rate: int) -> np.ndarray:
    """Ulangi klip pendek sampai mencapai target, dengan crossfade 20 ms agar
    putaran tidak berbunyi klik/hard boundary."""
    if audio.shape[0] >= target:
        return audio
    cf = min(int(sampling_rate * 0.02), audio.shape[0])
    fade_in = np.linspace(0.0, 1.0, cf, dtype=np.float32)
    fade_out = 1.0 - fade_in
    out = audio
    while out.shape[0] < target:
        nxt = audio.copy()
        joined = out[-cf:] * fade_in + nxt[:cf] * fade_out
        out = np.concatenate([out[:-cf], joined, nxt[cf:]])
    return out


def _mel_spectrogram(audio: torch.Tensor, hps) -> torch.Tensor:
    import mel_processing as M

    fmax = hps.data.mel_fmax or 8000.0
    spec = M.mel_spectrogram_torch(
        audio,
        hps.data.filter_length,
        hps.data.n_mel_channels,
        hps.data.sampling_rate,
        hps.data.hop_length,
        hps.data.win_length,
        hps.data.mel_fmin or 0.0,
        fmax,
        center=False,
    )
    return spec


def _spectrogram(audio: torch.Tensor, hps) -> torch.Tensor:
    import mel_processing as M

    return M.spectrogram_torch(
        audio,
        hps.data.filter_length,
        hps.data.sampling_rate,
        hps.data.hop_length,
        hps.data.win_length,
        center=False,
    )


def _audio_to_tensors(audio: np.ndarray, hps) -> dict:
    sampling_rate = hps.data.sampling_rate
    seg_samples = hps.train.segment_size
    audio = audio.astype(np.float32)
    if audio.shape[0] < seg_samples:
        audio = _loop_extend(audio, seg_samples, sampling_rate)
    # Bersihkan jeda panjang di ujung (umumnya hasil rekaman), sisakan ~0.4 s
    # agar pembatas segmen latih tidak diisi kesunyian terus-menerus.
    lead = max(0, min(seg_samples // 4, audio.shape[0] - seg_samples))
    if lead > 0:
        y_trim, _ = librosa.effects.trim(audio, top_db=25)
        if y_trim.shape[0] >= seg_samples:
            audio = y_trim
    peak = np.abs(audio).max()
    if peak > 0:
        audio = audio / peak * 0.98

    t = torch.from_numpy(audio)
    spec = _spectrogram(t.view(1, -1), hps)  # (1, n_fft//2+1, frames)
    return {
        "audio": t.view(1, 1, -1),
        "spec": spec,
        "audio_len": t.shape[0],
        "spec_len": spec.shape[-1],
    }


def _text_to_ids(text: str, hps) -> list[int]:
    from text import text_to_sequence

    sequence, _ = text_to_sequence(text, hps.symbols, ["indonesian_cleaners"])
    if getattr(hps.data, "add_blank", False):
        import commons

        sequence = commons.intersperse(sequence, 0)
    return sequence


def load_dataset(dataset_dir: Path) -> tuple[list[dict], list[str]]:
    """Membaca folder dataset (audio + transcripts.json). Kembalikan item
    audio+teks (sudah diubah menjadi tensor) dan daftar deskripsi untuk log."""
    meta_path = dataset_dir / "transcripts.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    import utils as vits_utils

    hps = vits_utils.get_hparams_from_file(str(tts.DEFAULT_CONFIG_PATH))
    items = []
    descriptions = []
    for entry in meta:
        stored = dataset_dir / entry["file"]
        text = str(entry.get("text", "")).strip()
        if not stored.exists() or not text:
            continue
        audio, _sr = librosa.load(str(stored), sr=hps.data.sampling_rate, mono=True)
        if audio.shape[0] < 64:
            descriptions.append(f"- {entry['file']}: audio terlalu pendek (skip)")
            continue
        ids = _text_to_ids(text, hps)
        if len(ids) < 2:
            descriptions.append(f"- {entry['file']}: transkrip tidak menghasilkan fonem (skip)")
            continue
        items.append({**_audio_to_tensors(audio, hps), "ids": torch.LongTensor(ids)})
        descriptions.append(f"- {entry['file']}: {len(ids)} fonem, {audio.shape[0] / hps.data.sampling_rate:.1f} dtk")
    return items, descriptions


def _write_model(hps_obj, state: dict, model_dir: Path, meta: dict) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    torch.save({"model": state, "meta": meta}, model_dir / "model.pth")
    hps_dict = json.loads(
        Path(tts.DEFAULT_CONFIG_PATH).read_text(encoding="utf-8")
    )
    hps_dict["data"]["text_cleaners"] = ["indonesian_cleaners"]
    (model_dir / "config.json").write_text(
        json.dumps(hps_dict, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (model_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    cover = Path(tts.MODELS_DIR) / meta.get("base_model", "") / "cover.png"
    if cover.exists():
        try:
            import shutil

            shutil.copyfile(cover, model_dir / "cover.png")
        except OSError:
            pass


def train_session(
    session: dict,
    dataset_dir: Path,
    model_id: str,
    *,
    steps: int,
    learning_rate: float,
    sample_text: str,
    speaker_id: int,
    base_model: str = "kafka",
    save_every: int = 100,
) -> None:
    """Jalan di thread background; session = dict status yang dibaca UI."""
    import commons
    import models as vits_models
    import utils as vits_utils
    from losses import discriminator_loss, feature_loss, generator_loss, kl_loss

    session["status"] = "preparing"
    try:
        checkpoint_path = _base_checkpoint(base_model)
        hps = vits_utils.get_hparams_from_file(str(tts.DEFAULT_CONFIG_PATH))
        seg_samples = hps.train.segment_size
        hop = hps.data.hop_length
        net_g = _load_base_net(hps, checkpoint_path)
        net_g.train()
        net_d = vits_models.MultiPeriodDiscriminator(
            use_spectral_norm=getattr(hps.model, "use_spectral_norm", False)
        )
        net_d.train()

        items, descriptions = load_dataset(dataset_dir)
        if not items:
            raise RuntimeError("Dataset tidak berisi pasangan audio+teks yang valid.")
        session["dataset_desc"] = descriptions
        session["n_samples"] = len(items)

        g_opt = torch.optim.AdamW(
            net_g.parameters(), lr=learning_rate, betas=(0.8, 0.99)
        )
        d_opt = torch.optim.AdamW(
            net_d.parameters(), lr=learning_rate, betas=(0.8, 0.99)
        )

        model_dir = tts.MODELS_DIR / model_id
        display = meta_name(base_model)
        meta = {
            "name": f"{display} (Indonesia)",
            "language": "Indonesian",
            "sample_text": sample_text or "Halo, apa kabar teman-teman?",
            "speakers": [{"id": speaker_id, "name": meta_name(base_model)}],
            "default_sid": speaker_id,
            "ready": True,
            "base_model": base_model,
            "trained": True,
            "steps": steps,
            "learning_rate": learning_rate,
        }
        _write_model(hps, net_g.state_dict(), model_dir, meta)

        sid = torch.LongTensor([speaker_id])
        session["status"] = "training"
        session["total"] = steps
        session["step"] = 0
        session["model_id"] = model_id
        cancel = session.get("cancel")

        start = time.time()
        step_times: list[float] = []
        for step in range(1, steps + 1):
            if cancel is not None and cancel.is_set():
                session["status"] = "cancelled"
                break
            t0 = time.time()
            item = random.choice(items)

            x = item["ids"].unsqueeze(0)
            xl = torch.LongTensor([x.shape[1]])
            spec = item["spec"]
            spl = torch.LongTensor([spec.shape[-1]])
            y = item["audio"]

            g_opt.zero_grad()
            d_opt.zero_grad()

            y_hat, l_length, _attn, ids_slice, x_mask, y_mask, zinfo = net_g(
                x, xl, spec, spl, sid=sid
            )
            z, z_p, m_p, logs_p, m_q, logs_q = zinfo

            y_seg = commons.slice_segments(y, ids_slice * hop, seg_samples)
            y_hat_mel = _mel_spectrogram(y_hat.squeeze(1), hps)
            y_seg_mel = _mel_spectrogram(y_seg.squeeze(1), hps)
            loss_mel = hps.train.c_mel * F.l1_loss(y_hat_mel, y_seg_mel)
            loss_kl = hps.train.c_kl * kl_loss(z_p, logs_q, m_p, logs_p, y_mask)
            loss_dur = torch.sum(l_length.float()) * hps.train.c_kl

            # --- Discriminator ---
            y_d_hat_r, y_d_hat_g, fmap_r, fmap_g = net_d(y_seg.detach(), y_hat.detach())
            loss_disc_all, _r, _g = discriminator_loss(y_d_hat_r, y_d_hat_g)
            loss_disc_all.backward()
            d_opt.step()

            # --- Generator ---
            y_d_hat_r, y_d_hat_g, fmap_r, fmap_g = net_d(y_seg, y_hat)
            loss_gen_all, _ = generator_loss(y_d_hat_g)
            loss_feat = 0.1 * feature_loss(fmap_r, fmap_g)
            loss_gen = (
                loss_gen_all
                + loss_feat
                + loss_mel
                + loss_kl
                + loss_dur
            )
            loss_gen.backward()
            g_opt.step()

            step_times.append(time.time() - t0)
            window = step_times[-20:] if len(step_times) > 20 else step_times
            avg = sum(window) / len(window)
            session["loss_gen"] = round(float(loss_gen_all.item()), 4)
            session["loss_mel"] = round(float(loss_mel.item()), 4)
            session["loss_kl"] = round(float(loss_kl.item()), 4)
            session["loss_dur"] = round(float(loss_dur.item()), 4)
            session["loss_disc"] = round(float(loss_disc_all.item()), 4)
            session["step"] = step
            session["eta_seconds"] = round(avg * (steps - step), 1)
            session["last_msg"] = (
                f"step {step}/{steps} | gen {session['loss_gen']} | mel {session['loss_mel']}"
                f" | kl {session['loss_kl']} | dur {session['loss_dur']}"
            )

            if step % save_every == 0 or step == steps:
                _write_model(hps, net_g.state_dict(), model_dir, meta)
                message = (
                    f"Checkpoint tersimpan di step {step}: {model_id}"
                )
                session["last_checkpoint"] = message

        elapsed = time.time() - start
        session["status"] = "done" if session["status"] != "cancelled" else "cancelled"
        session["elapsed"] = round(elapsed, 1)
        session["done"] = True
    except Exception as exc:  # noqa: BLE001
        session["status"] = "error"
        session["error"] = str(exc)
        session["done"] = True
        raise


def meta_name(base_model: str) -> str:
    index = tts._load_info_index()
    info = index.get(base_model)
    return tts._display_name(info) or base_model