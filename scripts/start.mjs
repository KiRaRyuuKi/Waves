#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = platform() === "win32";
const VERSION = "0.1.5-alpha";

const FE_PORT = process.env.FRONTEND_PORT || "3095";
const BE_PORT = process.env.BACKEND_PORT || "9035";
const FE_URL = `http://localhost:${FE_PORT}`;
const BE_URL = `http://localhost:${BE_PORT}`;

const STATE_DIR = path.join(ROOT, ".waves");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const LOG_DIR = path.join(STATE_DIR, "logs");

// Tema monocrom: hanya reset/bold/dim — tanpa warna.
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "",
  green: "",
  yellow: "",
  cyan: "",
  magenta: "",
};

const now = () => new Date().toLocaleTimeString("id-ID", { hour12: false });
const log = (tag, color, msg) =>
  process.stdout.write(
    `${C.dim}[${now()}]${C.reset} ${color}${tag}${C.reset} ${msg}\n`,
  );

const INFO = (m) => log("[info]", C.cyan, m);
const STEP = (m) => log("[ok]", C.green, m);
const WARN = (m) => log("[!]", C.yellow, m);

function fatal(msg) {
  console.error(
    `${C.dim}[${now()}]${C.reset} ${C.red}[error]${C.reset} ${msg}`,
  );
  exitWith(1);
}

// Keluar dengan jeda singkat: memaksa process.exit() saat undici/stdout masih
// menutup handle di Windows memicu crash libuv (UV_HANDLE_CLOSING, async.c).
function exitWith(code) {
  setTimeout(() => process.exit(code), 150);
}

// ---------------------------------------------------------------------------
//  Argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const strArg = (name) =>
  (
    (args.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1] || ""
  ).toLowerCase();
const modeArg = strArg("mode");
const actionArg = strArg("action");
const ASSUME_YES = args.includes("--yes");
const NO_BROWSER = args.includes("--no-browser");
const TTY = process.stdin.isTTY === true && !process.env.CI;

// ---------------------------------------------------------------------------
//  State (PID management)
// ---------------------------------------------------------------------------
function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}
function writeState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
function clearState() {
  try {
    rmSync(STATE_FILE, { force: true });
  } catch {
    /* abaikan */
  }
}

// Cek apakah PID masih hidup (Windows: tasklist; lain: process.kill(pid, 0)).
function isPidAlive(pid) {
  if (!pid) return false;
  try {
    if (IS_WIN) {
      const r = spawnSync(
        "tasklist",
        ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
        { encoding: "utf-8" },
      );
      return r.status === 0 && r.stdout.toLowerCase().includes(`"${pid}"`);
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
//  Python / Node detection
// ---------------------------------------------------------------------------
function venvPythonPath() {
  const candidates = [
    path.join(ROOT, ".venv", "Scripts", "python.exe"),
    path.join(ROOT, "venv", "Scripts", "python.exe"),
    path.join(ROOT, ".venv", "bin", "python"),
    path.join(ROOT, "venv", "bin", "python"),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

function run(cmd, args = []) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf-8",
    stdio: "inherit",
    shell: IS_WIN,
  });
  return r.status ?? 1;
}

function probe(cmd, args) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: "utf-8" }).status === 0;
}

// ---------------------------------------------------------------------------
//  Banner / TUI helpers
// ---------------------------------------------------------------------------
const ART = [
  "██╗    ██╗ █████╗ ██╗   ██╗███████╗███████╗",
  "██║    ██║██╔══██╗██║   ██║██╔════╝██╔════╝",
  "██║ █╗ ██║███████║██║   ██║█████╗  ███████╗",
  "██║███╗██║██╔══██║╚██╗ ██╔╝██╔══╝  ╚════██║",
  "╚███╔███╔╝██║  ██║ ╚████╔╝ ███████╗███████║",
  " ╚══╝╚══╝ ╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚══════╝",
];

const banner = () => {
  for (const row of ART) console.log(C.cyan + row + C.reset);
  console.log("");
};

// Spinner sederhana (hanya dipakai saat TTY, jalur tunggu).
// Setiap baris (frame maupun hasil akhir) selalu berawalan timestamp.
function spinner(text, tag = "") {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const ts = () => `${C.dim}[${now()}]${C.reset}`;
  const prefix = () => (tag ? `${ts()} ${C.cyan}${tag}${C.reset}` : `${ts()} `);
  const set = (t) => (text = t);
  const stop = (ok = true) => {
    clearInterval(timer);
    const mark = ok ? C.green + "✓" + C.reset : C.red + "✗" + C.reset;
    // Tampa \x1b[1A: frame terakhir tetap terlihat, ✓ berada di baris baru.
    process.stdout.write(`${prefix()} ${mark}  ${text}\n`);
  };
  if (!TTY)
    return {
      set,
      stop: (ok = true) =>
        console.log(`${prefix()} ${ok ? "✓" : "✗"}  ${text}`),
    };
  const timer = setInterval(() => {
    process.stdout.write(
      `\x1b[1A\x1b[K${prefix()} ${C.cyan}${frames[i++ % frames.length]}${C.reset}  ${text}\n`,
    );
  }, 90);
  return { set, stop };
}

// Menu interaktif (panah atas/bawah + Enter). Hanya berfungsi di TTY.
function select(title, options, hint) {
  if (!TTY) return options[0].id;
  const lines = 1 + options.length * 2 + 2; // judul + 2 baris/opsi + hint + baris kosong

  const printBlock = () => {
    console.log(`${C.bold}${title}${C.reset}`);
    options.forEach((o, i) => {
      const sel = i === cursor;
      const cursorMark = sel ? `${C.cyan}~>${C.reset} ` : "   "; // lebar 3 supaya nama sejajar
      const bullet = sel ? `${C.bold}●${C.reset}` : `${C.dim}  ○${C.reset}`;
      const name = o.label;
      console.log(` ${cursorMark}${bullet} ${name}`);
      console.log(`      ${C.dim}${o.desc}${C.reset}`);
    });
    console.log(
      `${C.dim}${hint || "↑/↓ navigasi · Enter pilih · Esc keluar"}${C.reset}`,
    );
    console.log("");
  };

  let cursor = 0;
  printBlock();
  const move = (dir) => {
    cursor = (cursor + dir + options.length) % options.length;
    process.stdout.write(`\x1b[${lines}A\x1b[J`);
    printBlock();
  };

  let finish;
  let onKey;

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve) => {
    finish = (id) => {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(id);
    };
    onKey = (str, key) => {
      if (key.name === "up") move(-1);
      else if (key.name === "down") move(1);
      else if (key.name === "return") finish(options[cursor].id);
      else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        finish("exit");
      } else if (/^[1-9]$/.test(str)) {
        const n = Number(str) - 1;
        if (n < options.length) {
          cursor = n;
          process.stdout.write(`\x1b[${lines}A\x1b[J`);
          printBlock();
        }
      }
    };
    process.stdin.on("keypress", onKey);
  });
}

// ---------------------------------------------------------------------------
//  Setup awal (venv + requirements + node_modules)
// ---------------------------------------------------------------------------
async function ensureSetup() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const confirm = async (msg) => {
    if (ASSUME_YES || !TTY) return true;
    const ans = await rl.question(`${C.yellow}${msg}${C.reset} [Y/n] `);
    return !/^n/i.test(ans.trim());
  };

  STEP("Memeriksa environment…");

  const HAS_NEXT = existsSync(
    path.join(ROOT, "node_modules", "next", "dist", "bin", "next"),
  );
  if (!HAS_NEXT) {
    WARN("node_modules/next tidak ditemukan.");
    if (await confirm("Jalankan `npm install` sekarang? ")) {
      INFO("Menjalankan npm install (bisa memakan waktu)…");
      if (run("npm", ["install"]) !== 0) fatal("npm install gagal.");
      STEP("npm install selesai.");
    } else {
      fatal(
        "Node dependencies belum terpasang. Jalankan `npm install` lalu ulangi.",
      );
    }
  } else {
    STEP("Node dependencies sudah ada.");
  }

  let py = venvPythonPath();
  if (!py) {
    WARN("venv proyek tidak ditemukan (.venv).");
    if (
      await confirm("Buat `.venv` dan install backend requirements sekarang? ")
    ) {
      INFO("Membuat venv…");
      if (run("python", ["-m", "venv", ".venv"]) !== 0) {
        fatal("Gagal membuat venv. Pastikan `python` ada di PATH.");
      }
      py = venvPythonPath();
      INFO("Menginstall requirements.txt (bisa memakan waktu)…");
      if (run(py, ["-m", "pip", "install", "-r", "requirements.txt"]) !== 0) {
        fatal("pip install -r requirements.txt gagal.");
      }
      STEP("Backend dependencies selesai terpasang.");
    } else {
      fatal("Backend perlu venv. Jalankan manual atau ulangi dengan `--yes`.");
    }
  } else {
    STEP("venv proyek ditemukan.");
    if (!probe(py, ["-c", "import fastapi, uvicorn"])) {
      WARN("fastapi/uvicorn belum terpasang di venv.");
      if (await confirm("Install requirements.txt sekarang? ")) {
        INFO("Menginstall requirements.txt…");
        if (run(py, ["-m", "pip", "install", "-r", "requirements.txt"]) !== 0) {
          fatal("pip install -r requirements.txt gagal.");
        }
        STEP("Backend dependencies selesai terpasang.");
      } else {
        fatal(
          "Backend tidak bisa jalan tanpa dependencies. Jalankan pip install lalu ulangi.",
        );
      }
    } else {
      STEP("Backend dependencies sudah terpasang.");
    }
  }

  rl.close();
  return py;
}

// ---------------------------------------------------------------------------
//  Spawn (selalu detached + log ke file) dan tunggu siap
// ---------------------------------------------------------------------------
function spawnBackground(cmd, args, logFile) {
  mkdirSync(LOG_DIR, { recursive: true });
  // Redirect stdout/stderr langsung ke file (fd) tanpa pipe di parent.
  // Pipe lewat parent memacu crash libuv (UV_HANDLE_CLOSING) saat
  // process.exit() dan memperlambat server karena backpressure.
  const fd = openSync(logFile, "a");
  const child = spawn(cmd, args, {
    cwd: ROOT,
    // detached membuat anak bertahan setelah loader keluar. windowsHide +
    // stdio langsung ke file mencegah jendela console baru di Windows.
    detached: true,
    windowsHide: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, FORCE_COLOR: "1", NEXT_TELEMETRY_DISABLED: "1" },
  });
  child.unref();
  return child;
}

// python.exe selalu subsystem console (bisa kelihatan sebagai jendela baru
// tergantung terminal host-nya). pythonw.exe adalah build Windows yang
// memang tidak pernah punya console sama sekali — dipakai khusus untuk
// proses backend yang di-spawn di background.
function toPythonw(pyPath) {
  if (!IS_WIN) return pyPath;
  const w = pyPath.replace(/python\.exe$/i, "pythonw.exe");
  return existsSync(w) ? w : pyPath;
}

function openBrowser() {
  if (NO_BROWSER) return;
  try {
    if (IS_WIN) {
      spawn("cmd", ["/c", "start", "", FE_URL], {
        detached: true,
        windowsHide: true,
        stdio: "ignore",
      }).unref();
    } else {
      spawn("xdg-open", [FE_URL], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    /* abaikan */
  }
}

function waitHttpReady(url, label, timeoutMs = 60000) {
  const start = Date.now();
  const pad = label.padEnd(23);
  const spin = spinner(`${pad}: (${url})`, "[info]");
  return new Promise((resolve) => {
    const retry = () => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      spin.set(`${pad}: (${url})… ${elapsed}s`);
      if (Date.now() - start > timeoutMs) {
        spin.stop(false);
        resolve(false);
        return;
      }
      setTimeout(tick, 700);
    };
    const tick = () => {
      fetch(url, { signal: AbortSignal.timeout(1500) })
        .then((r) => {
          if (r.ok) {
            spin.stop(true);
            resolve(true);
          } else retry();
        })
        .catch(retry);
    };
    tick();
  });
}

// Tunggu backend benar-benar merespons sebelum browser dibuka.
function waitBackendReady(timeoutMs = 120000) {
  return waitHttpReady(
    BE_URL + "/api/health",
    "Menunggu backend siap",
    timeoutMs,
  );
}

// Tunggu frontend benar-benar merespons sebelum browser dibuka.
function waitFrontendReady(timeoutMs = 120000) {
  return waitHttpReady(FE_URL, "Menunggu frontend siap", timeoutMs);
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------
async function main() {
  const existing = readState();
  if (existing) {
    const alive =
      isPidAlive(existing.backendPid) || isPidAlive(existing.frontendPid);
    if (alive) {
      fatal(
        `Server sudah tercatat jalan (mode=${existing.mode}, backendPid=${existing.backendPid}).\n` +
          `Hentikan dulu lewat tombol server di sidebar atau \`node scripts/stop.mjs\`.`,
      );
      return;
    }
    WARN(
      `State lama ditemukan tapi server tidak berjalan (PID ${existing.backendPid}/${existing.frontendPid}). ` +
        `Membersihkan state dan memulai ulang…`,
    );
    clearState();
  }

  banner();

  let action = actionArg;
  if (!["web", "background", "exit"].includes(action)) {
    if (TTY) {
      action = await select(
        "Pilih Interface:",
        [
          {
            id: "web",
            label: "Web UI (Open in Browser)",
            desc: `Build/Start server lalu buka ${FE_URL}`,
          },
          {
            id: "background",
            label: "Background (Run Silently)",
            desc: "Start kedua server tanpa membuka browser",
          },
          {
            id: "exit",
            label: "Exit",
            desc: "Batal — tutup terminal loader tanpa menjalankan apa pun",
          },
        ],
        "↑/↓ navigasi · Enter pilih · Esc keluar",
      );
    } else {
      action = "web";
    }
  }
  if (action === "exit") {
    INFO("Keluar tanpa menjalankan server.");
    exitWith(0);
    return;
  }

  let mode = modeArg;
  if (!["dev", "start"].includes(mode)) {
    if (TTY) {
      mode = await select(
        "Pilih mode menjalankan:",
        [
          {
            id: "dev",
            label: "Development",
            desc: "next dev — hot reload, cocok untuk pengembangan",
          },
          {
            id: "start",
            label: "Production",
            desc: "next start — butuh build, untuk penggunaan normal",
          },
        ],
        "↑/↓ navigasi · Enter pilih · Esc keluar",
      );
    } else {
      mode = "dev";
    }
  }

  const py = await ensureSetup();
  const isStart = mode === "start";
  const isBuilt = existsSync(path.join(ROOT, ".next", "BUILD_ID"));

  if (isStart && !isBuilt) {
    WARN(
      "Belum ada build produksi (.next/BUILD_ID). Menjalankan `npm run build`…",
    );
    if (run("npm", ["run", "build"]) !== 0) {
      fatal("npm run build gagal.");
      return;
    }
  }

  const nextDevBin = path.join(
    ROOT,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  const nextStartBin = path.join(
    ROOT,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );

  const selectedBin = isStart ? nextStartBin : nextDevBin;
  const nextArgs = ["-p", FE_PORT, "-H", "0.0.0.0"];

  INFO(
    `Mode: ${isStart ? "production (next start)" : "development (next dev)"}`,
  );
  INFO(`Python: ${py}`);

  // ---- backend ----
  INFO(`Memulai backend (uvicorn) di ${BE_URL}…`);
  const backend = spawnBackground(
    toPythonw(py),
    [
      "-m",
      "uvicorn",
      "server.main:app",
      "--host",
      "0.0.0.0",
      "--port",
      BE_PORT,
    ],
    path.join(LOG_DIR, "backend.log"),
  );
  INFO(`backend  pid ${backend.pid}`);

  // Tunggu backend siap dulu sebelum memicu frontend
  const beReady = await waitBackendReady();

  // ---- frontend ----
  INFO(`Memulai frontend (Next.js) di ${FE_URL}…`);
  const frontend = spawnBackground(
    process.execPath,
    [selectedBin, ...nextArgs],
    path.join(LOG_DIR, "frontend.log"),
  );
  INFO(`frontend pid ${frontend.pid}`);

  // simpan state PID
  writeState({
    mode,
    pythonPath: py,
    backendPid: backend.pid,
    frontendPid: frontend.pid,
    backendPort: BE_PORT,
    frontendPort: FE_PORT,
    startedAt: new Date().toISOString(),
  });

  // tunggu backend siap lalu frontend, baru buka browser
  const feReady = beReady ? await waitFrontendReady() : false;

  if (beReady && feReady) {
    INFO(`Aplikasi siap: ${C.bold}${FE_URL}${C.reset}`);
    INFO(`Hentikan                  : ${C.bold}npm stop waves${C.reset}`);
    INFO(`Restart                   : ${C.bold}npm restart waves${C.reset}`);
    INFO(
      `Logs                      : ${C.dim}.waves/logs/{backend,frontend}.log${C.reset}`,
    );
    if (action === "web") openBrowser();
  } else {
    WARN(
      "Server belum merespons. Cek log di .waves/logs/{backend,frontend}.log.",
    );
    INFO(`Frontend tetap berjalan: ${C.bold}${FE_URL}${C.reset}`);
  }
  exitWith(0);
}

main()
  .catch((e) => fatal(e.stack || e.message))
  .finally(() => exitWith(0));
