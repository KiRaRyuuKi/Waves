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
    title: "Studio",
    items: [
      {
        href: "/",
        label: "Stem Separator",
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="2"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"
            />
          </svg>
        ),
      },
      {
        href: "/voice",
        label: "Voice Synthesis",
        icon: (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
              />
            </svg>
          </>
        ),
      },
      {
        href: "/studio",
        label: "Studio Creation",
        icon: (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25"
              />
            </svg>
          </>
        ),
      },
    ],
  },
  {
    title: "Tools",
    items: [
      {
        href: "/remover",
        label: "Remover",
        icon: (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 0 1-1.125-1.125v-3.75ZM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 0 1-1.125-1.125v-8.25ZM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 0 1-1.125-1.125v-2.25Z"
              />
            </svg>
          </>
        ),
      },
      {
        href: "/coder",
        label: "Screen Coder",
        icon: (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z"
              />
            </svg>
          </>
        ),
      },
      {
        href: "/training",
        label: "Fine-tune (ID)",
        icon: (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25M9 16.5v.75m3-3v3M15 12v5.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
              />
            </svg>
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
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
              />
            </svg>
          </>
        ),
      },
      {
        href: "/downloader",
        label: "Media Downloader",
        icon: (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
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
      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-none p-2">
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
            className="pointer-events-none absolute bottom-0 left-2.5 z-10 h-10 select-none overflow-visible"
            aria-hidden
          >
            <img
              src="/pixel-capybara.gif"
              alt=""
              width={180}
              height={56}
              className="relative h-full w-full object-contain object-bottom opacity-95"
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
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                  />
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
