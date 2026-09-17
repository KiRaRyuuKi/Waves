import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

export interface ServerState {
  running: boolean;
  mode?: string;
  backendPid?: number;
  frontendPid?: number;
  backendPort?: string;
  frontendPort?: string;
  startedAt?: string;
}

export function readServerState(): ServerState {
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
    return { running: false };
  }
}

export async function GET() {
  return Response.json(readServerState(), {
    headers: { "Cache-Control": "no-store" },
  });
}