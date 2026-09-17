#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = platform() === "win32";
const STATE_FILE = path.join(ROOT, ".waves", "state.json");

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
  console.log("Tidak ada state server (.waves/state.json). Tidak ada yang dihentikan.");
  exitWith(0);
}

console.log(
  `Menghentikan server (mode=${state.mode}) — backend pid ${state.backendPid}, frontend pid ${state.frontendPid}…`
);

// Hapus state DULU. stop.mjs di-spawn dari proses frontend (via tombol sidebar),
// jadi `taskkill /T` pada frontend akan ikut membunuh script ini sendiri sebelum
// sampai ke baris bawah. State harus bersih lebih dulu supaya tidak "nyangkut".
try {
  rmSync(STATE_FILE, { force: true });
} catch {
  /* abaikan */
}
console.log("State server dibersihkan.");

killPid(state.backendPid);
killPid(state.frontendPid);

console.log("Server dihentikan.");
exitWith(0);