r"""Smoke test keamanan untuk perubahan A01-A08.

Jalankan: .venv\Scripts\python.exe -m tests.security_regression
"""
from __future__ import annotations

import io
import json
import sys
import warnings

warnings.filterwarnings("ignore")

# noqa: E402
from fastapi.testclient import TestClient

# noqa: E402
from server.waves import app
# noqa: E402
from server import llm, training, tts, image

PASSED: list[str] = []
FAILED: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    (PASSED if condition else FAILED).append(f"{name} {detail}".strip())


def expect_raises(name: str, fn, exc=Exception) -> None:
    try:
        fn()
    except exc:
        PASSED.append(name)
    # noqa: BLE001
    except Exception as other:
        FAILED.append(f"{name} (raised {type(other).__name__}: {other})")
    else:
        FAILED.append(f"{name} (no exception raised)")


def main() -> int:
    # --- A01: dataset_id path traversal ---
    expect_raises(
        "A01 training._dataset_dir rejects '..'",
        lambda: training._dataset_dir(".."),
        Exception,
    )
    expect_raises(
        "A01 training._dataset_dir rejects '../generate'",
        lambda: training._dataset_dir("../generate"),
        Exception,
    )
    expect_raises(
        "A01 training._dataset_dir rejects absolute-ish path",
        lambda: training._dataset_dir("....//"),
        Exception,
    )
    check(
        "A01 training._dataset_dir accepts plain id",
        training._dataset_dir("ab12cd34").name == "ab12cd34",
    )

    client = TestClient(app)
    r = client.delete("/api/training/datasets/..")
    check("A01 DELETE /api/training/datasets/.. blocked", r.status_code in (400, 404), f"status={r.status_code}")

    # --- A01: llm repo id ---
    for bad in ("..", "../..", "a/..", "/etc/passwd", "owner/name/extra", "own..er/name", "a b/c"):
        expect_raises(
            f"A01 llm._safe_repo_id rejects {bad!r}",
            lambda b=bad: llm._safe_repo_id(b),
            Exception,
        )
    check("A01 llm._safe_repo_id accepts owner/name", llm._safe_repo_id("TheBloke/Mistral-7B-GGUF") == "TheBloke/Mistral-7B-GGUF")

    r = client.post(
        "/api/llm/download",
        json={"repoId": "../../../evil", "filename": "x.gguf"},
    )
    check("A01 POST /api/llm/download traversal blocked", r.status_code == 400, f"status={r.status_code}")

    # Subpath di filename dikurangi ke basename (perilaku asli), tapi hasil
    # path WAJIB tetap di dalam LLM_DIR.
    llm_root = llm.LLM_DIR.resolve()
    for raw_name in ("../../evil.gguf", "a/b/evil.gguf", "..\\..\\evil.gguf", "....//evil.gguf"):
        try:
            dest = llm._dest_for("owner/name", raw_name)
        # noqa: BLE001
        except Exception as exc:
            PASSED.append(f"A01 _dest_for({raw_name!r}) rejected: {type(exc).__name__}")
            continue
        resolved = dest.resolve()
        contained = llm_root in resolved.parents
        check(
            f"A01 _dest_for({raw_name!r}) stays under LLM_DIR",
            contained,
            f"dest={dest}",
        )
        check(
            f"A01 _dest_for({raw_name!r}) lands in <LLM_DIR>/<owner>/<name>/<basename>",
            resolved.name == "evil.gguf" and resolved.parent.parent.parent == llm_root,
            f"dest={resolved}",
        )

    r = client.post(
        "/api/llm/download",
        json={"repoId": "owner/name", "filename": "evil.exe"},
    )
    check("A01 POST /api/llm/download rejects non-gguf", r.status_code == 400, f"status={r.status_code}")

    # --- A01: model_id ---
    for bad in ("..", "../../etc", "a/b", ".hidden", ""):
        expect_raises(
            f"A01 tts.model_dir_for rejects {bad!r}",
            lambda b=bad: tts.model_dir_for(b),
            Exception,
        )
    expect_raises(
        "A01 image._model_dir_for rejects '..'",
        lambda: image._model_dir_for(".."),
        Exception,
    )
    r = client.get("/api/voice/models/../../..%2F..%2Fetc/cover")
    check("A01 GET /api/voice/models/../ cover blocked", r.status_code in (400, 404), f"status={r.status_code}")

    r = client.post("/api/voice/synthesize", json={"model_id": "../../evil", "text": "hi"})
    check("A01 POST /api/voice/synthesize traversal rejected by schema", r.status_code == 422, f"status={r.status_code}")

    r = client.post("/api/generate", json={"model_id": "../../evil", "prompt": "hi"})
    check("A01 POST /api/generate traversal rejected by schema", r.status_code == 422, f"status={r.status_code}")

    # --- A04: upload limits ---
    big = io.BytesIO(b"0" * (25 * 1024 * 1024))
    r = client.post(
        "/api/remover/remove",
        files={"file": ("big.png", big, "image/png")},
        data={"model": "u2net"},
    )
    check(
        "A04 POST /api/remover/remove rejects >20MB",
        r.status_code in (413, 403, 500),
        f"status={r.status_code}",
    )

    # --- A01/CSRF: origin guard ---
    r = client.post("/api/jobs", json={}, headers={"Origin": "http://evil.example"})
    check("CSRF origin guard rejects foreign origin", r.status_code == 403, f"status={r.status_code}")

    r = client.post("/api/jobs", json={}, headers={"Origin": "http://localhost:3095"})
    check("CSRF origin guard allows local origin", r.status_code != 403, f"status={r.status_code}")

    # --- A02: api key masking on raw config endpoint ---
    from server import coder  # noqa: E402

    saved = coder.CONFIG_PATH.read_text(encoding="utf-8") if coder.CONFIG_PATH.is_file() else None
    try:
        coder.CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        coder.CONFIG_PATH.write_text(
            json.dumps({"providers": {"openai": {"api_key": "sk-super-secret-value-1234"}}}),
            encoding="utf-8",
        )
        r = client.get("/api/coder/config/raw")
        body = r.json()
        leaked = "sk-super-secret-value-1234" in json.dumps(body)
        check("A02 GET /api/coder/config/raw masks api key", not leaked, f"body_keys={sorted(body)}")
        check("A02 masked marker present", body.get("secrets_masked") is True)

        masked_raw = body["raw"]
        r = client.put("/api/coder/config/raw", json={"raw": masked_raw})
        stored = json.loads(coder.CONFIG_PATH.read_text(encoding="utf-8"))
        check(
            "A02 PUT raw preserves existing key when mask submitted",
            stored["providers"]["openai"]["api_key"] == "sk-super-secret-value-1234",
            f"stored={stored}",
        )
    finally:
        if saved is not None:
            coder.CONFIG_PATH.write_text(saved, encoding="utf-8")
        else:
            coder.CONFIG_PATH.unlink(missing_ok=True)

    # --- A05: jobs.json atomic write ---
    # noqa: E402
    from server import jobs as jobs_mod

    check(
        "A05 jobs.py has no leftover .tmp file",
        not (jobs_mod.JOBS_FILE.with_name(jobs_mod.JOBS_FILE.name + ".tmp")).exists(),
    )

    # --- report ---
    print(f"\nPASS {len(PASSED)}")
    for line in PASSED:
        print(f"  [ok]   {line}")
    print(f"\nFAIL {len(FAILED)}")
    for line in FAILED:
        print(f"  [FAIL] {line}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
