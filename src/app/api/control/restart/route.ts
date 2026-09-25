import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import { NextRequest } from "next/server";
import { requireLocalOrigin } from "@/lib/api/originGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST(req: NextRequest) {
  const blocked = requireLocalOrigin(req);
  if (blocked) return blocked;

  const root = process.cwd();
  const backendUp = await portOpen(9035);

  if (backendUp) {
    // Backend sudah jalan → cukup restart backend.
    const script = path.resolve(root, "scripts", "restart.mjs");
    const child = spawn(process.execPath, [script], {
      cwd: root,
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return Response.json({ ok: true, message: "Backend sedang di-restart." });
  }

  // Backend mati → start penuh (backend + frontend) lewat start.mjs.
  // Mode start (produksi) kalau sudah pernah di-build, else dev.
  const isBuilt = existsSync(path.join(root, ".next", "BUILD_ID"));
  const stateFile = path.join(root, ".waves", "state.json");
  let state: { mode?: string } | null = null;
  try {
    state = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    state = null;
  }
  const mode = state?.mode ?? (isBuilt ? "start" : "dev");

  const script = path.resolve(root, "scripts", "start.mjs");
  const args = [
    script,
    `--action=background`,
    `--mode=${mode}`,
    "--no-browser",
    "--yes",
  ];
  const child = spawn(process.execPath, args, {
    cwd: root,
    windowsHide: true,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return Response.json({ ok: true, message: "Server sedang di-start." });
}