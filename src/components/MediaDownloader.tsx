"use client";
import { useState, type FormEvent } from "react";
import Dropdown, { type DropdownOption } from "./Dropdown";

interface VideoFormat {
  format_id: string;
  quality: string;
  fps?: number | null;
  ext: string;
  filesize?: string;
}

interface AudioFormat {
  format_id: string;
  bitrate: string;
  ext: string;
}

interface MediaInfo {
  title: string;
  thumbnail: string;
  platform: string;
  duration?: string;
  uploader?: string;
  video_formats: VideoFormat[];
  audio_formats: AudioFormat[];
}

const PLATFORM_PATTERNS: Record<
  string,
  { pattern: RegExp; name: string; icon: React.ReactNode }
> = {
  youtube: {
    pattern: /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)/,
    name: "YouTube",
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
  },
  instagram: {
    pattern: /^(https?:\/\/)?(www\.)?instagram\.com/,
    name: "Instagram",
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <circle cx="12" cy="12" r="3" fill="white" />
        <circle cx="18" cy="6" r="1" fill="white" />
        <path
          d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5z"
          fill="white"
        />
      </svg>
    ),
  },
  facebook: {
    pattern: /^(https?:\/\/)?(www\.|web\.)?(facebook\.com|fb\.watch)/,
    name: "Facebook",
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
  },
  twitter: {
    pattern: /^(https?:\/\/)?(www\.)?(twitter\.com|x\.com)/,
    name: "X",
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.657l-5.207-6.802-5.974 6.802H2.018l7.732-8.835L1.154 2.25h6.837l4.716 6.231 5.441-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
};

/** Resolve the URL to a canonical absolute URL before calling the API. */
const normalizeUrl = (input: string): string => {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return `https://www.youtube.com/watch?v=${trimmed}`;
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const hasValidUrl = (value: string): boolean => value.trim().length >= 10;

export default function MediaDownloader() {
  const [url, setUrl] = useState("");
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedVideoFormat, setSelectedVideoFormat] = useState("");
  const [selectedAudioFormat, setSelectedAudioFormat] = useState("");
  const [downloading, setDownloading] = useState<"video" | "audio" | null>(
    null,
  );

  const detectedPlatform = detectPlatform(url);

  const fetchMediaInfo = async (rawUrl: string) => {
    const target = normalizeUrl(rawUrl);
    setLoading(true);
    setError("");
    setMediaInfo(null);
    setSelectedVideoFormat("");
    setSelectedAudioFormat("");

    try {
      const res = await fetch(
        `/api/downloader/info?url=${encodeURIComponent(target)}`,
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Gagal mengambil info media");
      }
      const data = await res.json();
      const platform = detectedPlatform?.name ?? data.platform ?? "Unknown";
      setMediaInfo({
        title: data.title || "Unknown Title",
        thumbnail: data.thumbnail || "",
        platform,
        duration: data.duration,
        uploader: data.uploader,
        video_formats: data.video_formats || [],
        audio_formats: data.audio_formats || [],
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Terjadi kesalahan saat mengambil info media",
      );
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!hasValidUrl(url)) return;
    void fetchMediaInfo(url);
  };

  const download = async (type: "video" | "audio") => {
    const formatId =
      type === "video" ? selectedVideoFormat : selectedAudioFormat;
    if (!mediaInfo || !formatId) return;

    setDownloading(type);
    setError("");

    try {
      const urlParam = encodeURIComponent(normalizeUrl(url));
      const fidParam = encodeURIComponent(formatId);
      const titleParam = encodeURIComponent(mediaInfo.title);
      const res = await fetch(
        `http://localhost:9035/api/downloader/data?url=${urlParam}&type=${type}&format_id=${fidParam}&title=${titleParam}`,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Gagal mengunduh file");
      }

      const disposition = res.headers.get("Content-Disposition") || "";
      let filename = mediaInfo.title
        ? `${mediaInfo.title}.${type === "audio" ? "mp3" : "mp4"}`
        : `download.${type === "audio" ? "mp3" : "mp4"}`;
      const match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(disposition);
      if (match && match[1]) {
        filename = decodeURIComponent(match[1].trim());
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunduh file");
    } finally {
      setDownloading(null);
    }
  };

  const videoOptions: DropdownOption[] = (mediaInfo?.video_formats ?? []).map(
    (f) => ({
      id: f.format_id,
      label: f.fps
        ? `${f.quality} ${f.fps}fps (${f.ext.toUpperCase()})`
        : `${f.quality} (${f.ext.toUpperCase()})`,
      right: f.filesize ? (
        <span className="mono text-[11px] text-ink-muted">{f.filesize}</span>
      ) : undefined,
    }),
  );

  const audioOptions: DropdownOption[] = (mediaInfo?.audio_formats ?? []).map(
    (f) => ({
      id: f.format_id,
      label: `${f.bitrate.toUpperCase()} (${f.ext.toUpperCase()})`,
    }),
  );

  return (
    <main className="w-full pb-12">
      <div className="mb-1 text-sm font-semibold">Media Downloader</div>
      <div className="mb-4 text-xs text-ink-muted">
        Unduh video atau audio dari YouTube, Instagram, Facebook, dan X
        (Twitter).
      </div>

      {error && (
        <div className="rounded-md border border-edge bg-red-50 mb-4 px-4 py-3 text-[12px] text-red-600">
          {error}
        </div>
      )}

      <div className="card space-y-4 p-4">
        <form onSubmit={onSubmit} className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              placeholder="Tempel link video atau musik — YouTube, Instagram, Facebook, atau X (Twitter)"
              className="w-full rounded-md border border-edge bg-canvas-subtle px-3 py-2 pr-24 text-[13px]"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            {detectedPlatform && (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-[11px] text-ink-muted">
                <span className="flex items-center h-12 -mr-2">
                  {detectedPlatform.icon}
                </span>
                <span className="label text-ink-muted">
                  {detectedPlatform.name}
                </span>
              </span>
            )}
          </div>
          <button
            type="submit"
            className="btn btn-primary w-40 flex-shrink-0"
            disabled={!hasValidUrl(url) || loading}
          >
            {loading ? "Memuat…" : "Cari"}
          </button>
        </form>

        {loading && (
          <div className="flex items-center gap-2 text-[12px] text-ink-muted">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-ink-muted border-t-transparent" />
            Mengambil informasi media…
          </div>
        )}

        {mediaInfo && !loading && (
          <>
            <div className="flex items-start gap-3">
              {mediaInfo.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaInfo.thumbnail}
                  alt={mediaInfo.title}
                  className="h-16 w-24 flex-shrink-0 rounded-md border border-edge object-cover"
                />
              )}
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-ink">
                  {mediaInfo.title}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                  {detectedPlatform && (
                    <span className="flex items-center gap-1.5 label bg-canvas-inset text-ink-muted">
                      {detectedPlatform.icon}
                      {mediaInfo.platform}
                    </span>
                  )}
                  {mediaInfo.duration && (
                    <span className="mono">{mediaInfo.duration}</span>
                  )}
                  {mediaInfo.uploader && (
                    <span className="truncate">{mediaInfo.uploader}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Dropdown
                label="Kualitas Video"
                options={videoOptions}
                value={selectedVideoFormat}
                onChange={setSelectedVideoFormat}
                placeholder="Pilih kualitas video…"
                disabled={videoOptions.length === 0}
              />
              <Dropdown
                label="Kualitas Audio"
                options={audioOptions}
                value={selectedAudioFormat}
                onChange={setSelectedAudioFormat}
                placeholder="Pilih kualitas audio…"
                disabled={audioOptions.length === 0}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b pb-4">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => download("video")}
                disabled={!selectedVideoFormat}
              >
                Download Video
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => download("audio")}
                disabled={!selectedAudioFormat}
              >
                Download Audio
              </button>
              {downloading && (
                <span className="flex items-center gap-1.5 text-[12px] text-ink-muted">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-ink-muted border-t-transparent" />
                  Menyiapkan download{" "}
                  {downloading === "video" ? "video" : "audio"}…
                </span>
              )}
            </div>
          </>
        )}

        <div className="py-1 text-center text-[12px] text-ink-muted">
          <div className="mb-1">
            Didukung: YouTube, Instagram, Facebook, dan X (Twitter)
          </div>
          <div>Klik “Cari” untuk memilih kualitas.</div>
        </div>
      </div>
    </main>
  );
}

function detectPlatform(
  url: string,
): { name: string; icon: React.ReactNode } | null {
  const trimmed = url.trim();
  for (const platform of Object.values(PLATFORM_PATTERNS)) {
    if (platform.pattern.test(trimmed)) {
      return { name: platform.name, icon: platform.icon };
    }
  }
  return null;
}
