"""Runs Demucs as a subprocess and reports live progress.

Demucs prints a tqdm progress bar to stderr per model pass (htdemucs_ft
runs 4 internal models, so we scale progress across all of them). We
parse the "NN%|" pattern tqdm emits rather than depending on any
demucs internals, so this keeps working across demucs versions.
"""

from __future__ import annotations

import re
import subprocess
import sys
import typing as tp
from collections import deque
from pathlib import Path

from .jobs import JobStatus, store

PERCENT_RE = re.compile(r"(\d+(?:\.\d+)?)%\|")

# htdemucs_ft bags 4 sub-model passes; everything else is a single pass.
MODEL_PASSES = {
    "htdemucs": 1,
    "htdemucs_ft": 4,
    "mdx_extra": 1,
}

STORAGE_ROOT = Path(__file__).parent / "storage"
OUTPUT_ROOT = STORAGE_ROOT / "separated"


def _iter_lines(stream) -> "tp.Iterator[str]":
    """Yield each terminal 'line' from a subprocess stream, splitting on
    both \\n and \\r. tqdm (used for both demucs' own progress bars and
    torch's model-download progress) redraws a line in place with \\r —
    Python's default line iteration only splits on \\n, so a redraw can
    merge with whatever comes right after it into one unflushed chunk,
    and if the process dies mid-redraw that chunk (often containing the
    real error) never gets yielded at all. Splitting on \\r too avoids that.
    """
    buffer = ""
    while True:
        chunk = stream.read(256)
        if not chunk:
            break
        buffer += chunk
        while True:
            idx_n = buffer.find("\n")
            idx_r = buffer.find("\r")
            candidates = [i for i in (idx_n, idx_r) if i != -1]
            if not candidates:
                break
            idx = min(candidates)
            yield buffer[:idx]
            buffer = buffer[idx + 1:]
    if buffer:
        yield buffer


def run_separation(job_id: str, input_path: Path, model: str) -> None:
    store.update(job_id, status=JobStatus.PROCESSING, stage="Loading model", progress=1)

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    passes_expected = MODEL_PASSES.get(model, 1)

    cmd = [
        sys.executable,
        "-m",
        "demucs.separate",
        "-n",
        model,
        "-o",
        str(OUTPUT_ROOT),
        str(input_path),
    ]

    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError as exc:
        store.update(job_id, status=JobStatus.ERROR, error=f"Could not launch demucs: {exc}")
        return

    passes_seen = 0
    last_percent = 0.0
    downloading = False
    separating_started = False
    tail: deque[str] = deque(maxlen=40)

    assert process.stdout is not None
    for line in _iter_lines(process.stdout):
        print(line)  # keep it visible live in the server console too
        stripped = line.strip()
        if stripped:
            tail.append(stripped)

        if "Downloading:" in line:
            downloading = True
            store.update(job_id, stage="Mengunduh model (pertama kali, mungkin beberapa menit)…")
        elif "Separating track" in line:
            downloading = False
            separating_started = True

        match = PERCENT_RE.search(line)
        if match and downloading and not separating_started:
            # Model download progress (0-100 per checkpoint file) — kept
            # separate from separation-pass progress below so it doesn't
            # make the UI claim stems are being separated while a
            # multi-hundred-MB checkpoint is still downloading.
            store.update(job_id, progress=min(float(match.group(1)) * 0.99, 99.0))
        elif match and separating_started:
            percent = float(match.group(1))
            # A new pass restarts near 0% right after a previous pass hit 100%.
            if percent < last_percent - 5:
                passes_seen += 1
            last_percent = percent
            overall = ((passes_seen + percent / 100.0) / passes_expected) * 100
            store.update(
                job_id,
                progress=min(overall, 99.0),
                stage=f"Separating stems (pass {min(passes_seen + 1, passes_expected)}/{passes_expected})",
            )

    return_code = process.wait()

    if return_code != 0:
        # Prefer a line that actually looks like an error/exception over
        # just "the last thing printed" — the last printed line is very
        # often an unrelated status line (e.g. "Downloading: ...") rather
        # than the real cause.
        error_keywords = ("error", "exception", "traceback")
        error_lines = [l for l in tail if any(k in l.lower() for k in error_keywords)]
        if error_lines:
            detail = " | ".join(error_lines[-3:])
        else:
            detail = " | ".join(list(tail)[-3:])
        store.update(
            job_id,
            status=JobStatus.ERROR,
            error=f"Demucs exited with an error: {detail}" if detail else "Demucs exited with an error.",
        )
        return

    stem_dir = OUTPUT_ROOT / model / input_path.stem
    if not stem_dir.exists():
        store.update(job_id, status=JobStatus.ERROR, error="Separation finished but output was not found.")
        return

    stems = sorted(p.stem for p in stem_dir.glob("*.wav"))
    store.update(job_id, status=JobStatus.DONE, progress=100, stage="Done", stems=stems)


def stem_file_path(job_id: str, model: str, input_stem_name: str, stem: str) -> Path:
    return OUTPUT_ROOT / model / input_stem_name / f"{stem}.wav"
