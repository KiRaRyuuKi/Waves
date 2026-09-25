import { NextRequest } from "next/server";
import { requireLocalOrigin } from "@/lib/api/originGuard";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  const blocked = requireLocalOrigin(req);
  if (blocked) return blocked;

  const { id } = await ctx.params;
  const pythonPath = req.nextUrl.searchParams.get("python_path") || "";
  const install = req.nextUrl.searchParams.get("install") || "false";
  const verbose = req.nextUrl.searchParams.get("verbose") || "false";

  const query = new URLSearchParams();
  query.set("python_path", pythonPath);
  query.set("install", String(install === "true"));
  query.set("verbose", String(verbose === "true"));

  let upstream: Response;
  try {
    upstream = await fetch(
      `http://localhost:9035/api/setup/tasks/${encodeURIComponent(id)}/run?${query}`,
      { method: "POST", cache: "no-store" }
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
