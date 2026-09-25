import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS = new Set(["http://localhost:3095", "http://127.0.0.1:3095"]);

export function requireLocalOrigin(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin");
  if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json(
      { error: "Origin tidak diizinkan" },
      { status: 403 }
    );
  }
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin" && secFetchSite !== "same-site" && secFetchSite !== "none") {
    return NextResponse.json(
      { error: "Cross-site request ditolak" },
      { status: 403 }
    );
  }
  return null;
}
