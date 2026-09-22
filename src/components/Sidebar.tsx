"use client";

import Link from "next/link";
import { CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import SetupModal from "@/components/SetupModal";
import ServerControl from "@/components/ServerControl";
import {
  fetchSetupJobs,
  subscribeSetupJob,
  SetupJob,
} from "@/lib/setupApi";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Musik",
    items: [
      {
        href: "/",
        label: "Stem Separator",
        icon: (
          <path
            d="M3 14c1.5-4 3-6 4.5-6s3 4 4.5 4 3-6 4.5-6 3 4 4.5 8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      },
      {
        href: "/voice",
        label: "Voice Synthesis",
        icon: (
          <>
            <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
            <path d="M6 11a6 6 0 0 0 12 0M12 18v3" strokeLinecap="round" />
          </>
        ),
      },
    ],
  },
  {
    title: "Generate",
    items: [
      {
        href: "/image",
        label: "Image Generation",
        icon: (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9.5" cy="9" r="1.5" />
            <path
              d="m21 15-5-5L5 21M9 9l-6 6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ),
      },
      {
        href: "/video",
        label: "Video Generation",
        icon: (
          <>
            <rect x="2" y="5" width="14" height="14" rx="2" />
            <path d="m22 7-6 5 6 4V7Z" strokeLinejoin="round" />
          </>
        ),
      },
    ],
  },
  {
    title: "Tools",
    items: [
      {
        href: "/training",
        label: "Fine-tune (ID)",
        icon: (
          <>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <path
              d="M14 2v6h6M9 15l2 2 4-4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ),
      },
      {
        href: "/coder",
        label: "Screen Coder",
        icon: (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path
              d="M9 8 5 12l4 4M15 8l4 4-4 4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M14 9 9 16" strokeLinecap="round" />
          </>
        ),
      },
    ],
  },
  {
    title: "Downloader",
    items: [
      {
        href: "/llm",
        label: "LLM Hub (GGUF)",
        icon: (
          <>
            <rect x="3" y="7" width="18" height="14" rx="2" />
            <path d="M7 7V5a5 4 0 0 1 10 0v2" />
            <circle cx="9" cy="12" r="1" />
            <circle cx="15" cy="12" r="1" />
            <path d="M9 15c1.5 1 4.5 1 6 0" strokeLinecap="round" />
          </>
        ),
      },
      {
        href: "/downloader",
        label: "Media Downloader",
        icon: (
          <>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </>
        ),
      },
    ],
  },
];

const DOT_COLORS: Array<{ color: string; delay: string }> = [
  { color: "#ffffff", delay: "0ms" },
  { color: "#d1d5db", delay: "180ms" },
  { color: "#991b1b", delay: "360ms" },
];

const dotKeyframes = `
@keyframes dotPulse {
  0%, 100% { transform: scale(0.45); opacity: 0.45; }
  50% { transform: scale(1.1); opacity: 1; }
}
`;

const fishKeyframes = `
@keyframes fishBob {
  0%, 100% { transform: translateY(0) rotate(-1.2deg); }
  50% { transform: translateY(-5px) rotate(1.4deg); }
}
@keyframes waveFloat {
  0%, 100% { transform: translate3d(0,0,0) scaleY(1) rotate(0deg); }
  20% { transform: translate3d(0,-1.5px,0) scaleY(1.015) rotate(0.15deg); }
  45% { transform: translate3d(0,-4px,0) scaleY(0.985) rotate(-0.2deg); }
  70% { transform: translate3d(0,-2px,0) scaleY(1.01) rotate(0.1deg); }
}
@keyframes waveParallax {
  0% { transform: translateX(0); }
  100% { transform: translateX(-6px); }
}
`;

export default function Sidebar() {
  const pathname = usePathname();
  const [setupOpen, setSetupOpen] = useState(false);
  const [activeDownload, setActiveDownload] = useState<SetupJob | null>(null);
  const [sidebarError, setSidebarError] = useState("");

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const jobs = await fetchSetupJobs();
        const running = jobs.find(
          (j) => j.status === "queued" || j.status === "running",
        );
        if (!alive) return;
        setActiveDownload(running || null);
      } catch (e) {
        if (!alive) return;
        setSidebarError(e instanceof Error ? e.message : String(e));
      }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // SSE live: perbarui progres aktif seketika tanpa menunggu polling.
  useEffect(() => {
    if (!activeDownload) return;
    const jobId = activeDownload.job_id;
    const stop = subscribeSetupJob(jobId, {
      onEvent: (ev) => {
        if (ev.type === "progress") setActiveDownload(ev.job);
      },
      onError: () => {},
    });
    return stop;
  }, [activeDownload?.job_id]);

  return (
    <aside className="flex h-full min-h-0 w-64 flex-shrink-0 flex-col overflow-visible rounded-md border border-edge bg-white shadow-soft">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-edge bg-canvas-subtle px-3 py-2 text-[13px] font-medium text-gray-700">
        <span>Navigasi</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#9ca3af"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 14c1.5-4 3-6 4.5-6s3 4 4.5 4 3-6 4.5-6 3 4 4.5 8" />
        </svg>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mb-2 last:mb-0">
            <div className="mb-1 flex items-center gap-2 px-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                {section.title}
              </span>
              <span className="h-px flex-1 bg-edge/60" aria-hidden />
            </div>
            {section.items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`mb-0.5 flex items-center gap-2.5 rounded-md px-1.5 py-[7px] text-[13px] font-medium transition-colors ${
                    active
                      ? "bg-canvas-inset text-ink"
                      : "text-ink-muted hover:bg-canvas-subtle"
                  }`}
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
                    {item.icon}
                  </svg>
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex-shrink-0 overflow-visible px-2 pb-2">
        <style dangerouslySetInnerHTML={{ __html: fishKeyframes }} />
        <div className="relative overflow-visible rounded-md border border-edge bg-gradient-to-br from-white to-canvas-subtle p-3 shadow-soft">
          <div
            className="pointer-events-none absolute -right-2.5 -top-5 z-10 h-12 w-16 select-none overflow-hidden"
            aria-hidden
          >
            <img
              src="/pixel-fish.gif"
              alt=""
              width={64}
              height={48}
              className="h-full w-full object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.12)]"
              style={
                {
                  imageRendering: "pixelated",
                  animation: "fishBob 2.2s ease-in-out infinite",
                } as CSSProperties
              }
            />
          </div>

          <div className="mb-1.5 flex w-full items-center gap-1.5">
            <span className="text-[11px] font-semibold tracking-tight text-ink">
              Waves
            </span>
            <span className="h-1 w-1 rounded-full bg-emerald-500" aria-hidden />
            <span className="text-[11px] font-medium text-emerald-600">
              Preview
            </span>
            <span className="ml-auto inline-flex h-5 items-center rounded-full bg-ink px-2 text-[10px] font-bold tracking-wide text-white">
              v1.1.5-preview
            </span>
          </div>

          <p className="text-[11px] leading-[1.5] text-ink-muted">
            Toolkit KiRaRyuuKi.
            <span className="font-medium text-ink">
              {" "}
              Free &amp; open-source.
            </span>
          </p>

          <div className="mt-2.5 flex flex-col gap-1.5">
            <a
              href="https://saweria.co/KiRaRyuuKi"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white no-underline transition-colors hover:bg-black"
            >
              <img
                src="/pixel-saweria.gif"
                alt=""
                width={48}
                height={48}
                className="h-4 w-4 shrink-0 object-contain"
                style={{ imageRendering: "pixelated" } as CSSProperties}
              />
              Saweria
            </a>
            <a
              href="https://github.com/sponsors/KiRaRyuuKi"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-edge bg-white px-3 py-1.5 text-xs font-medium text-ink-muted no-underline transition-colors hover:bg-canvas-subtle hover:text-ink"
            >
              <img
                src="/pixel-love.gif"
                alt=""
                width={68}
                height={68}
                className="h-4 w-4 shrink-0 object-contain"
                style={{ imageRendering: "pixelated" } as CSSProperties}
              />
              Support
            </a>
          </div>

          <p className="mt-3 text-center text-[10px] leading-none text-ink-subtle">
            © KiRaRyuuKi. All rights reserved.
          </p>

          <div
            className="pointer-events-none absolute bottom-1 left-1.5 z-10 h-12 select-none overflow-visible"
            aria-hidden
          >
            <img
              src="/pixel-monokuma.gif"
              alt=""
              width={180}
              height={56}
              className="relative h-full w-full object-contain object-bottom opacity-95"
              style={
                {
                  imageRendering: "pixelated",
                  animation:
                    "waveFloat 1.9s cubic-bezier(0.45,0,0.55,1) infinite",
                  willChange: "transform",
                } as CSSProperties
              }
            />
          </div>
        </div>
      </div>

      <div className="flex flex-shrink-0 gap-2 border-t border-edge p-2">
        <button
          onClick={() => setSetupOpen(true)}
          className="relative flex min-w-0 flex-1 flex-col items-stretch overflow-hidden rounded-md border shadow-soft transition-colors border-edge bg-ink text-white hover:bg-ink-strong"
        >
          <div className="flex items-center gap-2 px-2.5 py-[8px] text-[13px] font-medium">
            {activeDownload ? (
              <>
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
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span className="mr-4">Proggres</span>
                <style dangerouslySetInnerHTML={{ __html: dotKeyframes }} />
                {DOT_COLORS.map((d, i) => (
                  <span
                    key={i}
                    className="inline-block"
                    style={
                      {
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        backgroundColor: d.color,
                        animation: "dotPulse 1.1s ease-in-out infinite",
                        animationDelay: d.delay,
                      } as CSSProperties
                    }
                  />
                ))}
                <span className="min-w-0 flex-1 truncate text-right tabular-nums">
                  {Math.round(activeDownload.progress)}%
                </span>
              </>
            ) : (
              <>
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
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Setup &amp; Runtime
              </>
            )}
          </div>
        </button>
        <ServerControl />
      </div>
      <SetupModal open={setupOpen} onClose={() => setSetupOpen(false)} />
    </aside>
  );
}
