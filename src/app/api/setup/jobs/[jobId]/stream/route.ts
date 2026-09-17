import { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { jobId } = await ctx.params;

  let upstream: Response;
  try {
    upstream = await fetch(
      `http://localhost:9035/api/setup/jobs/${encodeURIComponent(jobId)}/stream`,
      { cache: "no-store" }
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

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
