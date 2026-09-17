import { NextRequest } from "next/server";

export async function GET() {
  const upstream = await fetch("http://localhost:9035/api/setup/pythons", {
    cache: "no-store",
  });

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
