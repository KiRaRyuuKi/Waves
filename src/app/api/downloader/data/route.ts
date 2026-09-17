import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const type = req.nextUrl.searchParams.get("type") || "video";
  const formatId = req.nextUrl.searchParams.get("format_id") || "";

  if (!url) {
    return new Response(
      JSON.stringify({ error: "Parameter 'url' diperlukan" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const upstream = await fetch(
    `http://localhost:9035/api/downloader/data?url=${encodeURIComponent(url)}` +
      `&type=${encodeURIComponent(type)}&format_id=${encodeURIComponent(formatId)}`,
    { cache: "no-store" }
  );

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type":
        upstream.headers.get("Content-Type") ||
        (type === "audio" ? "audio/mpeg" : "video/mp4"),
      "Content-Disposition":
        upstream.headers.get("Content-Disposition") ||
        `attachment; filename="download.${type === "audio" ? "mp3" : "mp4"}"`,
      "Cache-Control": "no-store",
    },
  });
}