import { spawn } from "node:child_process";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const script = path.resolve(process.cwd(), "scripts", "stop.mjs");
  const child = spawn(process.execPath, [script], {
    cwd: process.cwd(),
    windowsHide: true,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return Response.json({ ok: true, message: "Server dihentikan." });
}