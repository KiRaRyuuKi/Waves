import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { platform } from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IS_WIN = platform() === "win32";

function pidAlive(pid: number): boolean {
  if (!pid) return false;
  try {
    if (IS_WIN) {
      const r = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
      return r.status === 0 && r.stdout.toLowerCase().includes(`"${pid}"`);
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(800);
    sock
      .once("connect", () => { sock.destroy(); resolve(true); })
      .once("error", () => { sock.destroy(); resolve(false); })
      .once("timeout", () => { sock.destroy(); resolve(false); })
      .connect(port, "127.0.0.1");
  });
}

interface ServerState {
  running: boolean;
  mode?: string;
  backendPid?: number;
  frontendPid?: number;
  backendPort?: string;
  frontendPort?: string;
  startedAt?: string;
}

async function readServerState(): Promise<ServerState> {
  const stateFile = path.resolve(process.cwd(), ".waves", "state.json");
  try {
    const raw = JSON.parse(readFileSync(stateFile, "utf8"));
    const backendAlive = pidAlive(Number(raw.backendPid));
    const frontendAlive = pidAlive(Number(raw.frontendPid));
    return {
      running: backendAlive || frontendAlive,
      mode: raw.mode,
      backendPid: raw.backendPid,
      frontendPid: raw.frontendPid,
      backendPort: raw.backendPort,
      frontendPort: raw.frontendPort,
      startedAt: raw.startedAt,
    };
  } catch {
    // state.json tidak ada — deteksi langsung apakah port backend/frontend aktif
    const [bePort, fePort] = await Promise.all([portOpen(9035), portOpen(3095)]);
    if (bePort || fePort) {
      return {
        running: true,
        mode: undefined,
        backendPort: bePort ? "9035" : undefined,
        frontendPort: fePort ? "3095" : undefined,
      };
    }
    return { running: false };
  }
}

export async function GET() {
  const state = await readServerState();
  return Response.json(state, {
    headers: { "Cache-Control": "no-store" },
  });
}