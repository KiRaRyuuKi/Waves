import { NextRequest } from "next/server";
import { requireLocalOrigin } from "@/lib/api/originGuard";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const blocked = requireLocalOrigin(req);
  if (blocked) return blocked;

  const { id } = await ctx.params;

  let upstream: Response;
  try {
    upstream = await fetch(
      `http://localhost:9035/api/setup/tasks/${encodeURIComponent(id)}`,
      { method: "DELETE", cache: "no-store" }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Backend setup sedang tidak dijangkau" }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const text = await upstream.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }

  return new Response(JSON.stringify(payload), {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}