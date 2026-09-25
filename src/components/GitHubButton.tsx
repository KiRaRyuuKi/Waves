"use client";

import { useEffect, useState } from "react";

const CURRENT_VERSION = "1.1.5-preview";
const REPO = "KiRaRyuuKi/Waves";
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const REPO_URL = `https://github.com/${REPO}`;

interface ReleaseInfo {
  tag: string;
  version: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
}

function normalize(v: string) {
  return v.trim().replace(/^v/i, "");
}

function compareVersions(a: string, b: string): number {
  // return 1 if a > b, -1 if a < b, 0 equal
  const pa = normalize(a);
  const pb = normalize(b);
  const [ma, preA] = pa.split("-", 2);
  const [mb, preB] = pb.split("-", 2);
  const na = ma.split(".").map((x) => parseInt(x, 10) || 0);
  const nb = mb.split(".").map((x) => parseInt(x, 10) || 0);
  const len = Math.max(na.length, nb.length);
  for (let i = 0; i < len; i++) {
    const da = na[i] ?? 0;
    const db = nb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  // main equal, prerelease handling: release > prerelease
  if (!preA && preB) return 1;
  if (preA && !preB) return -1;
  if (!preA && !preB) return 0;
  // both prerelease: lexical compare, beta < rc etc.
  if (preA! > preB!) return 1;
  if (preA! < preB!) return -1;
  return 0;
}

function isNewer(latest: string, current: string) {
  return compareVersions(latest, current) > 0;
}

export default function GitHubButton() {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // cache 1 jam di sessionStorage biar tidak spam API
    const cached = sessionStorage.getItem("waves_release_cache");
    if (cached) {
      try {
        const c = JSON.parse(cached);
        if (Date.now() - c.ts < 60 * 60 * 1000) {
          if (!cancelled) {
            setRelease(c.data);
            setHasUpdate(isNewer(c.data.version, CURRENT_VERSION));
            setLoading(false);
          }
          return;
        }
      } catch {}
    }
    fetch(API_URL, { headers: { Accept: "application/vnd.github+json" } })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const j = await res.json();
        const tag: string = j.tag_name || j.name || "";
        const ver = normalize(tag);
        const info: ReleaseInfo = {
          tag,
          version: ver,
          name: j.name || tag,
          body: j.body || "",
          html_url: j.html_url || `${REPO_URL}/releases`,
          published_at: j.published_at || "",
        };
        if (!cancelled) {
          setRelease(info);
          setHasUpdate(isNewer(ver, CURRENT_VERSION));
          sessionStorage.setItem("waves_release_cache", JSON.stringify({ ts: Date.now(), data: info }));
        }
      })
      .catch(() => {
        // rate limit / offline → anggap tidak ada update, jangan ganggu UX
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-gradient-to-b from-[#2f3b46] to-[#1f2937] px-2 py-1.5 text-[13px] text-white no-underline transition-colors hover:from-[#2b2b2b] hover:to-black"
        aria-label="GitHub — Cek Update"
        title={
          hasUpdate
            ? `Update tersedia: ${release?.tag} (saat ini ${CURRENT_VERSION})`
            : `Buka GitHub — versi ${CURRENT_VERSION}`
        }
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
        >
          <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.34.95.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12v3.14c0 .31.2.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
        </svg>
        {!loading && hasUpdate && (
          <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/30" aria-hidden />
          <div className="relative max-h-[85vh] w-full max-w-lg overflow-hidden rounded-xl border border-edge bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-edge px-4 py-3">
              <div>
                <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.34.95.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12v3.14c0 .31.2.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
                  </svg>
                  GitHub • {REPO}
                  {hasUpdate && (
                    <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
                      Update tersedia
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-ink-muted">
                  Versi Terpasang{" "}
                  <code className="mono rounded bg-canvas-subtle px-1 py-0.5">
                    v{CURRENT_VERSION}
                  </code>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-ink text-white transition-opacity hover:opacity-80"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto overscroll-none p-5" style={{ maxHeight: "55vh" }}>
              {loading ? (
                <div className="flex items-center gap-2 py-8 text-[13px] text-ink-muted">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-muted border-t-transparent" />{" "}
                  Mengecek rilis GitHub…
                </div>
              ) : hasUpdate && release ? (
                <>
                  <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
                    Versi <b>{release.tag || release.version}</b> tersedia.
                    Lihat catatan rilis di bawah.
                  </div>
                  <ReleaseBody body={release.body} />
                </>
              ) : release ? (
                <>
                  <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
                    Versi Terbaru <b>{release.tag || `v${release.version}`}</b>{" "}
                    {release.published_at && (
                      <span>
                        {" "}
                        •{" "}
                        {new Date(release.published_at).toLocaleDateString(
                          "id-ID",
                          { day: "2-digit", month: "long", year: "numeric" },
                        )}
                      </span>
                    )}
                  </div>
                  <ReleaseBody body={release.body} />
                </>
              ) : (
                <div className="rounded-md border border-edge bg-canvas-subtle px-3 py-3 text-[12px] text-ink-muted">
                  Tidak bisa mengambil rilis GitHub (rate limit / offline). Buka
                  langsung di GitHub.
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-edge bg-canvas-subtle px-4 py-3">
              <a
                href={release?.html_url || REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center rounded-md bg-ink w-40 h-9 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black"
              >
                Buka di GitHub →
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ReleaseBody({ body }: { body: string }) {
  if (!body?.trim()) return <div className="text-[13px] italic text-ink-muted">Tidak ada catatan rilis.</div>;
  // Render markdown ringan tanpa dependency: heading, list, code, link
  const lines = body.split("\n");
  return (
    <div className="space-y-1 text-[13px] leading-relaxed text-ink">
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <div key={i} className="h-2" />;
        if (/^#{1,3}\s/.test(line)) {
          const text = line.replace(/^#{1,3}\s+/, "");
          return (
            <div key={i} className="mt-3 text-[12px] font-bold uppercase tracking-wide text-ink">
              {renderInline(text)}
            </div>
          );
        }
        if (/^[-*]\s/.test(line.trim())) {
          const text = line.trim().replace(/^[-*]\s+/, "");
          return (
            <div key={i} className="ml-4 flex gap-2 text-[13px]">
              <span className="text-ink-muted">•</span>
              <span className="flex-1">{renderInline(text)}</span>
            </div>
          );
        }
        if (/^\d+\.\s/.test(line.trim())) {
          return (
            <div key={i} className="ml-4 text-[13px]">
              {renderInline(line.trim())}
            </div>
          );
        }
        return (
          <div key={i} className="whitespace-pre-wrap break-words">
            {renderInline(line)}
          </div>
        );
      })}
    </div>
  );
}

function renderInline(text: string) {
  // link [teks](url) dan `code`
  const parts: React.ReactNode[] = [];
  let last = 0;
  const re = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)|`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[3] !== undefined) {
      parts.push(
        <code key={`${m.index}-c`} className="mono rounded bg-canvas-subtle px-1 py-0.5 text-[11px]">
          {m[3]}
        </code>
      );
    } else {
      parts.push(
        <a key={`${m.index}-a`} href={m[2]} target="_blank" rel="noreferrer" className="text-blue-600 underline decoration-dotted hover:text-blue-700">
          {m[1]}
        </a>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? <>{parts}</> : text;
}
