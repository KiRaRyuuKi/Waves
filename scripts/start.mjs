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

// ---------------------------------------------------------------------------
// Konstanta global & path
// ---------------------------------------------------------------------------
// Tentukan root proyek, platform, versi, port, dan lokasi state/logs.
// Semua path harus absolut dari posisi file ini agar konsisten di Windows 
// dan Unix serta tidak bergantung pada cwd saat npm run waves dipanggil.
// ROOT dihitung dari import.meta.url, IS_WIN untuk branching Windows,
// STATE_DIR/LOG_DIR untuk PID dan log, path.resolve menjamin root benar.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = platform() === "win32";
const VERSION = "1.1.5-preview";

const FE_PORT = process.env.FRONTEND_PORT || "3095";
const BE_PORT = process.env.BACKEND_PORT || "9035";
const FE_URL = `http://localhost:${FE_PORT}`;
const BE_URL = `http://localhost:${BE_PORT}`;

const STATE_DIR = path.join(ROOT, ".waves");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const LOG_DIR = path.join(STATE_DIR, "logs");

// Palet warna monokrom untuk log terminal, hanya reset/bold/dim tanpa warna mencolok agar tetap terbaca di terminal minim warna, 
// tidak mengotori log file, dan konsisten dengan tema TUI. Kode ANSI dipakai manual dan terminal Windows lama terhindar dari garbled escape sequence.
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

// Keluar dengan jeda 150ms alih-alih process.exit langsung. 
// Di Windows undici/stdout masih menutup handle async saat exit dipanggil, 
// libuv bisa melempar UV_HANDLE_CLOSING dan proses terlihat crash padahal server sudah berhasil di-spawn. 
// setTimeout memberi waktu merapikan handle.
function exitWith(code) {
  setTimeout(() => process.exit(code), 150);
}

// ---------------------------------------------------------------------------
// Penguraian argumen CLI
// ---------------------------------------------------------------------------
// Baca flag --mode=, --action=, --yes, --no-browser dari process.argv untuk mode non-interaktif. 
// Di TTY tampilkan menu panah, di CI atau tombol sidebar tidak ada interaksi sehingga flag jadi fallback. 
// strArg mencari --name=value,
// TTY mengecek stdin.isTTY dan CI, tanpa guard ini select akan hang menunggu keypress yang tidak pernah datang.
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

const IS_DAEMONIZED = args.includes("--daemonized") || process.env.WAVES_DAEMONIZED === "1";
const WANTS_DAEMON_EARLY =
  !args.includes("--no-daemon") &&
  !TTY &&
  modeArg !== "start" &&
  (actionArg === "background" || args.includes("--daemon") || args.includes("--yes"));

if (WANTS_DAEMON_EARLY && !IS_DAEMONIZED) {
  mkdirSync(LOG_DIR, { recursive: true });
  const wavesLog = path.join(LOG_DIR, "waves.log");
  const fd = openSync(wavesLog, "a");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args, "--daemonized"], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, WAVES_DAEMONIZED: "1", FORCE_COLOR: "1" },
  });
  child.unref();
  INFO(`start daemonized (pid ${child.pid}) — log: .waves/logs/waves.log`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Manajemen state PID (agar server bisa di-stop/restart dari UI)
// ---------------------------------------------------------------------------
// `state.json` menyimpan `backendPid`, `frontendPid`, `mode`, port, 
// dan `pythonPath` agar proses lain (sidebar, stop.mjs, restart.mjs) 
// tahu PID mana yang harus di-kill.
// Proses backend/frontend di-spawn `detached`, parent loader sudah exit, 
// jadi satu-satunya cara melacak mereka adalah file state.
// `readState()` parse JSON dengan try/catch, `writeState()` buat direktori `.waves` dulu, 
// `clearState()` hapus file saat stop.
// File bisa korup/terpotong bila crash di tengah tulis `try/catch`
// untuk mengembalikan `null` sehingga flow lanjut sebagai "tidak ada state".
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
    /* abaikan, file mungkin sudah terhapus oleh stop.mjs */
  }
}

// Mengecek apakah PID masih hidup.
// State lama bisa tertinggal setelah crash listrik / `taskkill` gagal kita harus bedakan,
// "state ada tapi proses mati" (boleh start baru) vs "proses masih hidup" (tolak start duplikat).
// Windows pakai `tasklist /FI "PID eq N"` dan cek CSV output;
// Unix pakai `process.kill(pid, 0)` yang tidak mengirim sinyal tapi throw bila PID tidak ada.
// `tasklist` mengembalikan CSV dengan quote, jadi harus cek `"<pid>"` lowercase; 
// di Unix, `kill` butuh handle `ESRCH` vs `EPERM`.
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
// Deteksi Python & Node
// ---------------------------------------------------------------------------
// Mencari interpreter Python di venv proyek terlebih dulu, baru fallback ke PATH sistem.
// Waves wajib jalan di venv yang sama dengan `requirements.txt` 
// agar `torch`, `demucs`, `fastapi` konsisten, 
// `python` global sering versi berbeda dan menyebabkan `No module named 'demucs'`.
// Cek berurutan `.venv/Scripts/python.exe` → `venv/...` 
// → `.venv/bin/python` → `venv/bin/python`; return path pertama yang ada.
// User kadang membuat venv dengan nama `venv` bukan `.venv`, 
// dengan cek 4 kandidat kita toleran terhadap kedua kebiasaan.
function venvPythonPath() {
  const candidates = [
    path.join(ROOT, ".venv", "Scripts", "python.exe"),
    path.join(ROOT, "venv", "Scripts", "python.exe"),
    path.join(ROOT, ".venv", "bin", "python"),
    path.join(ROOT, "venv", "bin", "python"),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

// Menjalankan command sinkron dengan `stdio: inherit` (output langsung ke terminal parent).
// Untuk setup yang butuh interaksi (`npm install`, `pip install`)
// kita ingin user melihat progress bar asli.
// Di Windows kita pakai `shell` agar `.cmd` (npm/pip shim) ditemukan,
// tapi Node TIDAK meng-escape arg saat shell:true — ia menggabungkan
// `cmd + args` apa adanya. Path dengan spasi (mis. "MUHAMMAD ILHAM") akan
// terpotong oleh cmd.exe. Karena itu kita render sendiri command line-nya:
// token yang mengandung spasi/quotes dibungkus tanda kutip, lalu kirim
// sebagai satu string (tanpa arg terpisah → bebas DEP0190).
function run(cmd, args = []) {
  let r;
  if (IS_WIN) {
    const quote = (s) =>
      /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
    const cmdline = [cmd, ...args].map(quote).join(" ");
    r = spawnSync(cmdline, [], {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: "inherit",
      shell: true,
    });
  } else {
    r = spawnSync(cmd, args, {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: "inherit",
    });
  }
  return r.status ?? 1;
}

// Probe cepat apakah command ada / berhasil (tanpa output).
// Untuk cek `python -c "import fastapi"` tanpa mengotori terminal.
// `spawnSync` tanpa `stdio: inherit`, cek `status === 0`.
// Bila python tidak ada, `spawnSync` return non-nol tanpa throw kita cukup return boolean.
function probe(cmd, args) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: "utf-8" }).status === 0;
}

// ---------------------------------------------------------------------------
// Banner & helper TUI (spinner, menu panah)
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

// Spinner teks dengan timestamp untuk menunggu backend/frontend ready.
// Health-check butuh waktu (uvicorn + Next.js compile), tanpa feedback visual user mengira hang.
// `setInterval` tiap 90ms ganti frame braille `⠋⠙⠹...`; 
// di TTY pakai `\x1b[1A\x1b[K` untuk overwrite baris yang sama, 
// di non-TTY fallback ke `console.log` biasa.
// Di Windows non-TTY (spawn dari frontend), escape sequence tidak diinterpretasi,
// fallback `if (!TTY)` mencegah karakter aneh di log file.
function spinner(text, tag = "") {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const ts = () => `${C.dim}[${now()}]${C.reset}`;
  const prefix = () => (tag ? `${ts()} ${C.cyan}${tag}${C.reset}` : `${ts()} `);
  const set = (t) => (text = t);
  const stop = (ok = true) => {
    clearInterval(timer);
    const mark = ok ? C.green + "✓" + C.reset : C.red + "✗" + C.reset;
    // Tanpa \x1b[1A: frame terakhir tetap terlihat, ✓ berada di baris baru.
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

function select(title, options, hint) {
  if (!TTY) return options[0].id;
  const lines = 1 + options.length * 2 + 2;

  const printBlock = () => {
    console.log(`${C.bold}${title}${C.reset}`);
    options.forEach((o, i) => {
      const sel = i === cursor;
      const cursorMark = sel ? `${C.cyan}~>${C.reset} ` : "   ";
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
// Setup awal (venv + requirements + node_modules)
// ---------------------------------------------------------------------------
// Memastikan environment siap sebelum spawn, cek `node_modules/next`,
// buat `.venv` bila belum ada, dan install `requirements.txt`.
// Instalasi pertama kali sering gagal karena user lupa `npm install`
// atau venv belum dibuat, tanpa guard ini, uvicorn akan langsung error
// `No module named fastapi` yang membingungkan.
// Gunakan `existsSync` untuk deteksi, `readline` untuk konfirmasi
// `[Y/n]`, dan `ASSUME_YES` untuk skip bila `--yes` atau non-TTY.
// `confirm()` harus handle `Ctrl+C` dan input kosong (default Y)
// regex `/^n/i` hanya menolak bila user eksplisit ketik `n`.
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
// Spawn (selalu detached + log ke file) dan tunggu siap
// ---------------------------------------------------------------------------
// Mem-spawn proses anak yang hidup independen dari parent.
// Loader `start.mjs` harus exit setelah spawn agar terminal tidak terblokir, 
// tapi backend/frontend harus tetap jalan — `detached: true` + `unref()` membuat mereka jadi daemon.
// Buka fd file log dengan `openSync(logFile,"a")`, 
// lalu `spawn(cmd,args,{detached:true, windowsHide:true, stdio:["ignore",fd,fd]})`.
// Jika pakai `stdio:"pipe"` dan parent exit, pipe pecah dan libuv crash. 
// Dengan fd file langsung, tidak ada pipe yang perlu ditutup parent.
function spawnBackground(cmd, args, logFile) {
  mkdirSync(LOG_DIR, { recursive: true });
  // Redirect stdout/stderr langsung ke file (fd) tanpa pipe di parent.
  // Pipe lewat parent memacu crash libuv (UV_HANDLE_CLOSING) saat process.exit() dan memperlambat server karena backpressure.
  // `openSync` lalu `stdio: ["ignore", fd, fd]`.
  const fd = openSync(logFile, "a");
  const removerRoot = path.join(ROOT, "server", "storage", "remover");
  const child = spawn(cmd, args, {
    cwd: ROOT,
    // `detached` membuat anak bertahan setelah loader keluar. 
    // `windowsHide` mencegah jendela console baru di Windows, `stdio` langsung ke file.
    // Tanpa ini, menutup terminal loader akan ikut kill anak.
    detached: true,
    windowsHide: true,
    stdio: ["ignore", fd, fd],
    env: {
      ...process.env,
      FORCE_COLOR: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      REMBG_HOME: removerRoot,
      U2NET_HOME: removerRoot,
      XDG_DATA_HOME: path.join(ROOT, "server", "storage"),
    },
  });
  child.unref();
  return child;
}

// Mengubah `python.exe` menjadi `pythonw.exe` bila ada (hanya Windows).
// `python.exe` adalah subsystem console, kadang memunculkan flash jendela hitam sesaat saat di-spawn. 
// `pythonw.exe` adalah build tanpa console sama sekali, cocok untuk daemon.
// Ganti suffix `python.exe` → `pythonw.exe` dan cek `existsSync`.
// Tidak semua distribusi Python menyertakan `pythonw.exe`, fallback ke `python.exe` bila tidak ditemukan.
function toPythonw(pyPath) {
  if (!IS_WIN) return pyPath;
  const w = pyPath.replace(/python\.exe$/i, "pythonw.exe");
  return existsSync(w) ? w : pyPath;
}

// Membuka browser ke FE_URL setelah server siap.
// UX user tidak perlu manual ketik `http://localhost:3095`.
// Windows pakai `cmd /c start "" <url>`, Unix pakai `xdg-open`.
// Di mode `Background` atau `--no-browser` kita skip sama sekali.
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
    /* abaikan jika gagal buka browser bukan fatal, user bisa buka manual */
  }
}

// Polling HTTP sampai `url` merespons 200 OK atau timeout.
// Uvicorn/Next butuh beberapa detik untuk bind port dan tanpa tunggu,
// browser terbuka terlalu cepat dan menampilkan `ERR_CONNECTION_REFUSED`.
// Loop `fetch` tiap 700ms, update spinner dengan elapsed seconds,
// resolve `true` jika `r.ok`, `false` bila lewat `timeoutMs`.
// `fetch` bisa throw `ECONNREFUSED` sebelum server bind,
// `catch(retry)` memastikan retry terus, bukan langsung gagal.
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

// Wrapper khusus untuk menunggu backend `/api/health`.
// Frontend proxy `/api/*` ke backend, jika backend belum ready, frontend akan 502. 
// Kita harus pastikan backend dulu baru frontend.
// Panggil `waitHttpReady` dengan path health dan timeout 120s.
// Cold start model (torch) bisa >60s di HDD, timeout 120s memberi ruang lebih.
function waitBackendReady(timeoutMs = 120000) {
  return waitHttpReady(
    BE_URL + "/api/health",
    "Menunggu backend siap",
    timeoutMs,
  );
}

// Wrapper untuk menunggu frontend `/` ready.
// Next.js dev butuh compile awal, start butuh load `.next`,
// sama seperti backend, perlu health-check sebelum buka browser.
function waitFrontendReady(timeoutMs = 120000) {
  return waitHttpReady(FE_URL, "Menunggu frontend siap", timeoutMs);
}

// ---------------------------------------------------------------------------
// Main orkestrasi keseluruhan
// ---------------------------------------------------------------------------
// Fungsi utama yang menggabungkan semua langkah: cek state lama, pilih interface/mode, 
// setup, spawn backend/frontend, simpan state, dan buka browser.
// Satu tempat untuk urutan yang benar, urutan salah (mis. spawn frontend sebelum backend ready) menyebabkan race condition proxy.
// Cek `readState()` + `isPidAlive()` dulu, lalu `banner()`, `select()` untuk action/mode, `ensureSetup()`, 
// cek `BUILD_ID` untuk mode start, `spawnBackground()` untuk kedua server, `waitBackendReady()` → `waitFrontendReady()` → `openBrowser()`.
// State stale harus dibersihkan sebelum lanjut; mode `dev` tidak butuh build sedangkan `start` wajib dan beda handlingnya.
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
    WARN("Belum ada build produksi (.next/BUILD_ID). Menjalankan `npm run build`…");
    if (run("npm", ["run", "build"]) !== 0) {
      fatal("npm run build gagal. Cek log di atas / .waves/logs/waves.log");
      return;
    }
    STEP("Build produksi selesai.");
  }

  if (isStart && !IS_DAEMONIZED && !args.includes("--no-daemon")) {
    mkdirSync(LOG_DIR, { recursive: true });
    const wavesLog = path.join(LOG_DIR, "waves.log");
    const fd = openSync(wavesLog, "a");
    const daemonArgs = [`--mode=start`, `--action=background`, "--yes", ...(NO_BROWSER || action !== "web" ? ["--no-browser"] : []), "--daemonized"];
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...daemonArgs], {
      cwd: ROOT,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, WAVES_DAEMONIZED: "1", FORCE_COLOR: "1" },
    });
    child.unref();
    INFO(`Production                : ${FE_URL} (pid ${child.pid})`);
    INFO(`Status                    : npx waves status | npx waves logs`);
    INFO(`Logs                      : ${C.dim}.waves/logs/waves.log${C.reset}`);
    process.exit(0);
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
  const nextArgs = ["-p", FE_PORT, "-H", "127.0.0.1"];

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
      "server.waves:app",
      "--host",
      "127.0.0.1",
      "--port",
      BE_PORT,
    ],
    path.join(LOG_DIR, "backend.log"),
  );
  INFO(`backend  pid ${backend.pid}`);

  // Tunggu backend siap dulu sebelum memicu frontend.
  // Menghindari race di mana Next proxy /api/* ke backend yang belum bind ke health-check sequential memastikan urutan benar.
  const beReady = await waitBackendReady();

  // ---- frontend ---- dev & prod sama: full background daemon (log hanya ke file, banner ▲ Next.js tidak bocor)
  INFO(`Memulai frontend (Next.js) di ${FE_URL}… (background daemon)`);
  const frontend = spawnBackground(
    process.execPath,
    [selectedBin, ...nextArgs],
    path.join(LOG_DIR, "frontend.log"),
  );
  INFO(`frontend pid ${frontend.pid} (detached)`);

  // Simpan PID ke state agar bisa di-stop/restart dari UI.
  // Tanpa file, tombol di sidebar tidak tahu PID mana yang harus di-kill — state jadi sumber kebenaran tunggal.
  writeState({
    mode,
    pythonPath: py,
    backendPid: backend.pid,
    frontendPid: frontend.pid,
    backendPort: BE_PORT,
    frontendPort: FE_PORT,
    startedAt: new Date().toISOString(),
  });

  // Tunggu backend lalu frontend, baru buka browser.
  // Memberi kepastian user melihat halaman sudah ready,
  // bukan `ERR_CONNECTION_REFUSED` sesaat.
  const feReady = beReady ? await waitFrontendReady() : false;

  if (beReady && feReady) {
    INFO(`Aplikasi siap: ${C.bold}${FE_URL}${C.reset}`);
    INFO(`Hentikan                  : ${C.bold}npm stop waves${C.reset}`);
    INFO(`Restart                   : ${C.bold}npm restart waves${C.reset}`);
    INFO(`Logs                      : ${C.dim}.waves/logs/{backend,frontend}.log${C.reset}`);
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
