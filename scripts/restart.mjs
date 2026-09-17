#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = platform() === "win32";
const STATE_DIR = path.join(ROOT, ".waves");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const LOG_DIR = path.join(STATE_DIR, "logs");

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

const exitWith = (code) => setTimeout(() => process.exit(code), 150);

let state = null;
try {
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
const fd = openSync(path.join(LOG_DIR, "backend.log"), "a");
const child = spawn(
  py,
  ["-m", "uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", port],
  {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, FORCE_COLOR: "1" },
  }
);
child.on("error", (e) => {
  console.error("Gagal spawn backend:", e.message);
  exitWith(1);
});
child.unref();

state.backendPid = child.pid;
state.restartedAt = new Date().toISOString();

try {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
} catch (e) {
  console.error("Gagal menulis state:", e.message);
}
console.log(`Backend pid baru: ${child.pid}. Hentikan dengan stop.mjs / tombol sidebar.`);

// tunggu backend benar-benar siap sebelum keluar
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