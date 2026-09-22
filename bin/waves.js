#!/usr/bin/env node
/**
 * Waves (bin/waves.js)
 * ---------------------------------------------------------------------------
 * Hanya aktif di dalam project ini (tidak global).
 * Dipanggil lewat `npx waves`, `npm exec waves`, atau `node bin/waves.js`.
 *
 * Format bin di package.json memungkinkan npm/npx menemukan executable
 * lokal tanpa `npm install -g`. npx akan resolve ./bin/waves.js dari
 * package.json bin, sehingga `waves` bisa diketik di dalam project layaknya
 * tool global, tapi tetap isolated. Untuk dev yang butuh log, tetap pakai
 * `npm run dev` + `uvicorn` secara terpisah, bin ini khusus untuk pengguna
 * akhir yang ingin aplikasi `waves` langsung berjalan.
 *
 * Alur:
 * `npx waves`            → spawn scripts/start.mjs --action=background --mode=start --yes --no-browser (silent)
 * `npx waves dev`        → jalankan start.mjs interaktif (TUI) tanpa flag silent
 * `npx waves stop`       → jalankan scripts/stop.mjs
 * `npx waves restart`    → jalankan scripts/restart.mjs
 * `npx waves status`     → baca .waves/state.json dan cetak PID/port
 * `npx waves logs`       → tail .waves/logs/backend.log & frontend.log
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = path.join(ROOT, ".waves", "state.json");

// Menjelaskan semua sub-perintah yang didukung CLI lokal ini. 
// Dipanggil ketika user ketik `npx waves --help` atau argumen tidak dikenal.
function printHelp() {
  console.log(`
Waves CLI (lokal, via npx)

Penggunaan:
  npx waves              # jalan silent background produksi (default)
  npx waves dev          # jalan interaktif TUI (pilih mode/interface)
  npx waves start        # alias silent
  npx waves stop         # hentikan backend + frontend
  npx waves restart      # restart backend saja
  npx waves status       # lihat state PID & port
  npx waves logs         # lihat 50 baris akhir log
  npx waves --help       # bantuan ini

Catatan:
  - Tidak perlu npm install -g. Cukup di project: npx akan resolve bin lokal.
  - Untuk dev dengan log live, pakai: npm run dev  +  uvicorn server.waves:app --port 9035
`);
}

// State disimpan oleh scripts/start.mjs di .waves/state.json. 
// Berisi backendPid, frontendPid, mode, dan port. 
// Command ini hanya membaca dan memformat agar user tahu proses masih hidup atau stale.
function showStatus() {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    console.log(`mode: ${s.mode}`);
    console.log(`backend:  pid ${s.backendPid}  port ${s.backendPort}`);
    console.log(`frontend: pid ${s.frontendPid}  port ${s.frontendPort}`);
    console.log(`python: ${s.pythonPath}`);
    console.log(`started: ${s.startedAt}`);
    if (s.restartedAt) console.log(`restarted: ${s.restartedAt}`);
  } catch {
    console.log("Tidak ada state (.waves/state.json) — server belum pernah start atau sudah di-stop.");
  }
}

// Membaca 50 baris akhir dari backend.log dan frontend.log untuk debugging
// cepat tanpa buka file manual. Tidak follow, hanya snapshot.
function showLogs() {
  const logs = ["backend.log", "frontend.log"];
  for (const name of logs) {
    const p = path.join(ROOT, ".waves", "logs", name);
    console.log(`\n=== ${name} ===`);
    if (!existsSync(p)) {
      console.log("(belum ada log)");
      continue;
    }
    try {
      const txt = readFileSync(p, "utf8");
      const lines = txt.trim().split("\n");
      console.log(lines.slice(-50).join("\n") || "(kosong)");
    } catch (e) {
      console.log(`Gagal baca log: ${e.message}`);
    }
  }
}

// npx waves tanpa argumen dianggap `start` silent produksi, ini bukan yang
// diinginkan: `npm run waves` / `npx waves` langsung jalan background tanpa TUI. 
// `dev` sengaja tanpa flag --yes agar TUI muncul untuk interaksi.
const arg = (process.argv[2] || "start").toLowerCase();

if (["-h", "--help", "help"].includes(arg)) {
  printHelp();
  process.exit(0);
}

if (arg === "status") {
  showStatus();
  process.exit(0);
}

if (arg === "logs") {
  showLogs();
  process.exit(0);
}

if (arg === "stop") {
  // Teruskan ke scripts/stop.mjs dengan inherit stdio agar log terlihat
  const r = spawnSync("node", [path.join(ROOT, "scripts", "stop.mjs")], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}

if (arg === "restart") {
  const r = spawnSync("node", [path.join(ROOT, "scripts", "restart.mjs")], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}

if (arg === "dev") {
  // Mode pengembangan — jalankan TUI interaktif tanpa flag silent
  const r = spawnSync("node", [path.join(ROOT, "scripts", "start.mjs")], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}

// Default: start silent background produksi
// spawn detached tidak diperlukan di sini — start.mjs sendiri sudah detached
// untuk backend/frontend. Kita cukup panggil dengan flag yang membuat TUI
// diskip dan browser tidak dibuka.
if (["start", "silent", "waves"].includes(arg)) {
  const r = spawnSync(
    "node",
    [
      path.join(ROOT, "scripts", "start.mjs"),
      "--action=background",
      "--mode=start",
      "--yes",
      "--no-browser",
    ],
    { stdio: "inherit" }
  );
  process.exit(r.status ?? 0);
}

// Argumen tidak dikenal — tampilkan bantuan
console.error(`Perintah tidak dikenal: ${arg}`);
printHelp();
process.exit(1);
