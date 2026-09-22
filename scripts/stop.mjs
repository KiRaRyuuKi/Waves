#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

// Hitung root proyek dan flag platform.
// Path `state.json` harus absolut dari posisi file ini, bukan dari cwd.
// `fileURLToPath(import.meta.url)` → `path.dirname` → `..`.
// Jika pakai `process.cwd()` bisa salah bila dipanggil dari subfolder.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = platform() === "win32";
const STATE_FILE = path.join(ROOT, ".waves", "state.json");

// Membunuh PID tergantung OS.
// Windows tidak punya `SIGTERM` POSIX — harus pakai `taskkill`.
// Windows `taskkill /PID <pid> /T /F` (T = tree, F = force); Unix `process.kill(pid, "SIGTERM")`.
// `process.kill` di Windows tanpa `taskkill` hanya kill parent, 
// anak (uvicorn worker) tetap hidup. `taskkill /T` memastikan tree bersih.
// Try/catch mengabaikan error bila proses sudah mati duluan.
function killPid(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    /* proses mungkin sudah mati, abaikan, tidak perlu fatal */
  }
}

// Exit tertunda 150ms (lihat start.mjs:exitWith).
// Sama, hindari `UV_HANDLE_CLOSING` saat stdout libuv belum tutup.
const exitWith = (code) => setTimeout(() => process.exit(code), 150);

let state = null;
try {
  // Coba baca state. Jika gagal, berarti belum pernah start atau file sudah dihapus manual.
  // Tanpa state, tidak tahu PID mana yang harus di-kill dan kita cukup informasikan dan exit 0 (bukan error).
  state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
} catch {
  console.log("Tidak ada state server (.waves/state.json). Tidak ada yang dihentikan.");
  exitWith(0);
}

console.log(
  `Menghentikan server (mode=${state.mode}) — backend pid ${state.backendPid}, frontend pid ${state.frontendPid}…`,
);

// Hapus state DULU sebelum kill.
// Seperti dijelaskan di header, `stop.mjs` adalah child dari frontend,
// `taskkill /T` pada frontend akan ikut membunuh script ini sebelum baris bawah tereksekusi. 
// Dengan hapus dulu, state tidak nyangkut meski terbunuh.
// `rmSync(..., {force:true})` dengan try/catch.
// Tanpa ini, `.waves/state.json` tertinggal dan start berikutnya mengira server masih jalan (padahal sudah mati) dan harus manual hapus.
try {
  rmSync(STATE_FILE, { force: true });
} catch {
  /* abaikan */
}
console.log("State server dibersihkan.");

// Bunuh kedua PID yang tercatat di state.
// Melepaskan port 3095/9035 agar bisa start ulang tanpa `EADDRINUSE`.
killPid(state.backendPid);
killPid(state.frontendPid);

console.log("Server dihentikan.");
exitWith(0);
