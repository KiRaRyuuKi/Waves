#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

// Konstanta path root, platform, dan lokasi state/logs.
// Sama seperti start/stop, harus absolut dan konsisten.
// Hitung dari `import.meta.url`, bedakan Windows vs Unix.
// Hardcode path relatif akan gagal bila dipanggil dari `src/`.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = platform() === "win32";
const STATE_DIR = path.join(ROOT, ".waves");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const LOG_DIR = path.join(STATE_DIR, "logs");

// Kill PID lintas platform (duplikat dari stop.mjs supaya file ini mandiri tanpa import).
// Windows butuh `taskkill /T /F`, Unix cukup `SIGTERM`.
// Tanpa try/catch, `ESRCH` (PID tidak ada) akan throw dan menghentikan flow padahal itu kondisi normal bila backend sudah mati.
function killPid(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    /* proses mungkin sudah mati */
  }
}

// Exit tertunda untuk hindari crash libuv (penjelasan lihat start.mjs).
const exitWith = (code) => setTimeout(() => process.exit(code), 150);

let state = null;
try {
  // Wajib ada state, tanpa ini tidak tahu `pythonPath` & port untuk spawn.
  // Restart tanpa state berarti user belum pernah `start` dan tidak ada konteks untuk melanjutkan.
  state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
} catch {
  console.error("Tidak ada state server (.waves/state.json). Jalankan start.mjs dulu.");
  exitWith(1);
}

const py = state.pythonPath || "python";
const port = state.backendPort || "9035";
const oldPid = state.backendPid;

console.log(`Restart backend — menghentikan pid ${oldPid} …`);
killPid(oldPid);

console.log(`Memulai ulang backend (uvicorn) dengan ${py} di port ${port} …`);
mkdirSync(LOG_DIR, { recursive: true });
// Buka fd log file untuk redirect stdout/stderr backend baru.
// Sama seperti start.mjs — hindari pipe ke parent yang rawan libuv.
// `openSync(..., "a")` append, lalu `stdio: ["ignore", fd, fd]`.
const fd = openSync(path.join(LOG_DIR, "backend.log"), "a");
const child = spawn(
  py,
  ["-m", "uvicorn", "server.waves:app", "--host", "127.0.0.1", "--port", port],
  {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, FORCE_COLOR: "1" },
  }
);
child.on("error", (e) => {
  // Tangani gagal spawn (mis. python path salah setelah venv dihapus).
  // Tanpa handler, error hilang silent karena `detached`.
  console.error("Gagal spawn backend:", e.message);
  exitWith(1);
});
child.unref();

// Update state dengan PID baru + timestamp restart.
// Stop berikutnya harus kill PID yang baru, bukan yang lama.
// Tulis JSON dengan indent 2 agar mudah dibaca manual.
// Jika tulis gagal (disk penuh), user akan kebingungan dari catch + log.
state.backendPid = child.pid;
state.restartedAt = new Date().toISOString();

try {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
} catch (e) {
  console.error("Gagal menulis state:", e.message);
}
console.log(`Backend pid baru: ${child.pid}. Hentikan dengan stop.mjs / tombol sidebar.`);

// Tunggu backend benar-benar siap sebelum exit (UX: jangan `exit 0` palsu).
// Frontend masih mengira backend ready — jika restart belum siap, API akan 502. Polling memberi kepastian.
// Loop `fetch(/api/health)` tiap 700ms, timeout 30s.
// Uvicorn butuh ~2-5s untuk import torch/demucs, tanpa polling, user langsung coba request dan gagal.
const start = Date.now();
const wait = () => {
  fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
    .then((r) => {
      if (r.ok) {
        console.log("Backend siap.");
        exitWith(0);
      } else retry();
    })
    .catch(retry);
};
const retry = () => {
  if (Date.now() - start > 30000) {
    console.error("Backend belum merespons dalam 30 detik. Cek .waves/logs/backend.log.");
    exitWith(1);
  }
  setTimeout(wait, 700);
};
wait();
