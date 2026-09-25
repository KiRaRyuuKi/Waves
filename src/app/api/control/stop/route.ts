import { spawn } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { requireLocalOrigin } from "@/lib/api/originGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const blocked = requireLocalOrigin(req);
  if (blocked) return blocked;

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