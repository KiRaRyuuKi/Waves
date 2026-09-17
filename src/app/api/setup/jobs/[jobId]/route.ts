import { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { jobId } = await ctx.params;

  let upstream: Response;
  try {
    upstream = await fetch(
      `http://localhost:9035/api/setup/jobs/${encodeURIComponent(jobId)}`,
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

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
