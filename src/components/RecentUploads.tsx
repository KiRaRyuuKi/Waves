"use client";

import { useEffect, useState } from "react";
import { MODEL_OPTIONS, type JobStatus, type RecentJob } from "../lib/types";

interface Props {
  jobs: RecentJob[];
  onOpen: (job: RecentJob) => void;
  onDelete: (job: RecentJob) => Promise<void>;
}

const STATUS_META: Record<JobStatus, { label: string; color: string; bg: string }> = {
  done: { label: "Siap didengar", color: "#15803d", bg: "#dcfce7" },
  processing: { label: "Diproses", color: "#b45309", bg: "#fef3c7" },
  queued: { label: "Antre", color: "#b45309", bg: "#fef3c7" },
  error: { label: "Gagal", color: "#dc2626", bg: "#fee2e2" },
};

function formatWhen(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "baru saja";
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} hr lalu`;
  return new Date(ts * 1000).toLocaleDateString("id-ID");
}

function StatusBadge({ status }: { status: JobStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className="label whitespace-nowrap" style={{ color: meta.color, background: meta.bg }}>
      {meta.label}
    </span>
  );
}

export default function RecentUploads({ jobs, onOpen, onDelete }: Props) {
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useEffect(() => {
    if (!menuFor) return;
    const onDocClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest("[data-row-menu]");
      if (!el) setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuFor(null);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  if (!jobs.length) return null;

  return (
    <div className="card mt-4">
      <div className="card-header">Unggahan terbaru</div>
      <div className="p-2">
        {jobs.map((job) => {
          const modelLabel =
            MODEL_OPTIONS.find((m) => m.id === job.model)?.label ?? job.model;
          return (
            <div
              key={job.id}
              data-row-menu
              className="group relative flex items-center rounded-md py-1 pl-1 pr-1 transition-colors hover:bg-canvas-subtle"
            >
              <button
                onClick={() => onOpen(job)}
                title={job.status === "error" ? job.error || undefined : "Buka kembali"}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md border-none bg-transparent py-2.5 pl-3 text-left"
              >
                <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="flex-shrink-0" aria-hidden>
                  <circle cx="3" cy="14" r="1.2" fill="var(--stem-vocals)" />
                  <circle cx="8" cy="14" r="1.2" fill="var(--stem-drums)" />
                  <circle cx="13" cy="14" r="1.2" fill="var(--stem-bass)" />
                  <path
                    d="M1.5 10c1.2-3.2 2.4-4.8 3.6-4.8s2.4 3.2 3.6 3.2 2.4-4.8 3.6-4.8 2.4 3.2 3.1 6.4"
                    stroke="var(--fg-subtle)"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div className="min-w-0 flex-1">
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-ink">
                    {job.filename}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-muted">
                    {modelLabel} · {formatWhen(job.created_at)}
                  </div>
                </div>
                <StatusBadge status={job.status} />
              </button>

              <button
                type="button"
                aria-label="Opsi unggahan"
                aria-expanded={menuFor === job.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuFor(menuFor === job.id ? null : job.id);
                }}
                className="mr-1 flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center bg-white text-ink-muted transition-colors hover:bg-canvas-subtle"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                  <circle cx="8" cy="3" r="1.5" />
                  <circle cx="8" cy="8" r="1.5" />
                  <circle cx="8" cy="13" r="1.5" />
                </svg>
              </button>

              {menuFor === job.id && (
                <div className="absolute right-2 top-full z-40 mt-1 w-44 rounded-md border border-edge bg-white p-1 shadow-float">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuFor(null);
                      void onDelete(job);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-[5px] border-none px-2 py-1.5 text-left text-[13px] text-red-600 transition-colors hover:bg-canvas-subtle"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M2.5 4h11M6.5 2h3a1 1 0 0 1 1 1v1H5.5V3a1 1 0 0 1 1-1ZM4 4l.6 8.8A1.3 1.3 0 0 0 5.9 14h4.2a1.3 1.3 0 0 0 1.3-1.2L12 4M6.5 6.5v4.5M9.5 6.5v4.5" />
                    </svg>
                    Hapus
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="border-t border-edge px-4 pb-3 pt-2 text-[11px] text-ink-subtle">
        Klik untuk membuka kembali dan langsung dicoba
      </div>
    </div>
  );
}