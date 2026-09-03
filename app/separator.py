"""Runs Demucs as a subprocess and reports live progress.

Demucs prints a tqdm progress bar to stderr per model pass (htdemucs_ft
runs 4 internal models, so we scale progress across all of them). We
parse the "NN%|" pattern tqdm emits rather than depending on any
demucs internals, so this keeps working across demucs versions.
"""

from __future__ import annotations

import re
import subprocess
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


def run_separation(job_id: str, input_path: Path, model: str) -> None:
    store.update(job_id, status=JobStatus.PROCESSING, stage="Loading model", progress=1)

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    passes_expected = MODEL_PASSES.get(model, 1)

    cmd = [
        "python3",
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

    assert process.stdout is not None
    for line in process.stdout:
        match = PERCENT_RE.search(line)
        if match:
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
        store.update(job_id, status=JobStatus.ERROR, error="Demucs exited with an error. Check server logs.")
        return

    stem_dir = OUTPUT_ROOT / model / input_path.stem
    if not stem_dir.exists():
        store.update(job_id, status=JobStatus.ERROR, error="Separation finished but output was not found.")
        return

    stems = sorted(p.stem for p in stem_dir.glob("*.wav"))
    store.update(job_id, status=JobStatus.DONE, progress=100, stage="Done", stems=stems)


def stem_file_path(job_id: str, model: str, input_stem_name: str, stem: str) -> Path:
    return OUTPUT_ROOT / model / input_stem_name / f"{stem}.wav"
