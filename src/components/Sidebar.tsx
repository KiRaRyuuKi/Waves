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

const NAV: NavItem[] = [
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
    href: "/image",
    label: "Image Generation",
    icon: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path
          d="m21 15-5-5L5 21M9 9l-6 6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
    <aside className="flex h-full min-h-0 w-64 flex-shrink-0 flex-col overflow-hidden rounded-md border border-edge bg-white shadow-soft">
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
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-colors ${
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
      </nav>
      <div className="flex flex-shrink-0 gap-2 border-t border-edge p-2">
        <button
          onClick={() => setSetupOpen(true)}
          className="relative flex min-w-0 flex-1 flex-col items-stretch overflow-hidden rounded-md border shadow-soft transition-colors border-edge bg-ink text-white hover:bg-ink-strong"
        >
          <div
            className="flex items-center gap-2 px-2.5 py-[8px] text-[13px] font-medium"
          >
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
