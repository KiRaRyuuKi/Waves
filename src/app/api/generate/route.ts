import { NextRequest } from "next/server";
import { requireLocalOrigin } from "@/lib/api/originGuard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const blocked = requireLocalOrigin(req);
  if (blocked) return blocked;

  const body = await req.text();
  const res = await fetch("http://localhost:9035/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}