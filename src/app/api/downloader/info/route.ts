import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Parameter 'url' diperlukan" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `http://localhost:9035/api/downloader/info?url=${encodeURIComponent(url)}`,
      { cache: "no-store" }
    );
    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "Server tidak dapat dijangkau" }, { status: 502 });
  }
}