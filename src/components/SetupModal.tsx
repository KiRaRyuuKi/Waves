"use client";

import { useEffect, useRef, useState } from "react";

import Dropdown from "@/components/Dropdown";
import {
  SetupJob,
  SetupPython,
  SetupTask,
  deleteTask,
  fetchSetupJobs,
  fetchSetupPythons,
  fetchSetupTasks,
  formatBytes,
  formatEta,
  startSetupJob,
  subscribeSetupJob,
} from "@/lib/setupApi";

const isActive = (j: SetupJob) => j.status === "queued" || j.status === "running";

function activeMap(jobs: SetupJob[]): Record<string, SetupJob> {
  const m: Record<string, SetupJob> = {};
  for (const j of jobs) {
    if (isActive(j)) m[j.task_id] = j;
  }
  return m;
}

const CATEGORY_LABEL: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  runtime: { label: "Runtime GPU", color: "text-orange-700", bg: "bg-orange-50 border-orange-200", icon: "⚡" },
  model: { label: "Model Gambar", color: "text-purple-700", bg: "bg-purple-50 border-purple-200", icon: "🎨" },
  stem: { label: "Stem Separator", color: "text-blue-700", bg: "bg-blue-50 border-blue-200", icon: "🎛️" },
};

// Estimasi ukuran model auto-detect yang total_bytes-nya 0 dari backend lama.
const ESTIMATED_BYTES: Record<string, number> = {
  sd15: 4265380512,
  dreamshaper: 4265203904,
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SetupModal({ open, onClose }: Props) {
  const [booting, setBooting] = useState(true);
  const [err, setErr] = useState("");
  const [tasks, setTasks] = useState<SetupTask[]>([]);
  const [pythons, setPythons] = useState<SetupPython[]>([]);
  const [pythonPath, setPythonPath] = useState("");
  const [installEnabled, setInstallEnabled] = useState(true);
  const [activeByTask, setActiveByTask] = useState<Record<string, SetupJob>>({});
  const [pollError, setPollError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setBooting(true);
    setErr("");
    setPollError("");
    fetchSetupTasks()
      .then((t) => {
        if (!alive) return;
        setTasks(t);
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setBooting(false);
      });
    fetchSetupPythons()
      .then((p) => {
        if (!alive) return;
        setPythons(p);
        if (p.length > 0 && pythonPath === "") {
          setPythonPath(p[0].path);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open]);

  // Pantau daftar tugas + job aktif via polling (fallback).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const tick = async () => {
      try {
        const [t, jobs] = await Promise.all([fetchSetupTasks(), fetchSetupJobs()]);
        if (!alive) return;
        setTasks(t);
        setActiveByTask(activeMap(jobs));
      } catch {
        /* err utama ditangani poll job */
      }
    };
    tick();
    const timer = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open]);

  // SSE live progress untuk job yang sedang aktif.
  const sseActiveIds = Object.values(activeByTask)
    .filter(isActive)
    .map((j) => j.job_id)
    .join(",");
  useEffect(() => {
    if (!open || !sseActiveIds) return;
    const jobs = Object.values(activeByTask).filter(isActive);
    const stops = jobs.map((j) =>
      subscribeSetupJob(j.job_id, {
        onEvent: (ev) => {
          if (ev.type === "progress" || ev.type === "done") {
            setActiveByTask((prev) => ({ ...prev, [j.task_id]: ev.job }));
          }
        },
        onError: () => {},
      })
    );
    return () => stops.forEach((s) => s());
  }, [open, sseActiveIds]);

  if (!open) return null;

  async function run(task: SetupTask) {
    setErr("");
    setPollError("");
    try {
      const opts: { pythonPath?: string; install?: boolean } = {};
      if (task.category === "runtime" && pythonPath && installEnabled) {
        opts.pythonPath = pythonPath;
        opts.install = true;
      }
      await startSetupJob(task.id, opts);
      const jobs = await fetchSetupJobs().catch(() => []);
      setActiveByTask(activeMap(jobs));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function stopJob(jobId: string) {
    try {
      await fetch(`/api/setup/jobs/${encodeURIComponent(jobId)}/stop`, { method: "POST" });
    } catch (e) {
      setPollError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(task: SetupTask) {
    try {
      setPollError("");
      await deleteTask(task.id);
      const t = await fetchSetupTasks();
      setTasks(t);
      setConfirmDeleteId(null);
    } catch (e) {
      setPollError(e instanceof Error ? e.message : String(e));
    }
  }

  const taskBytes = (t: SetupTask) => t.total_bytes || ESTIMATED_BYTES[t.id] || 0;
  const installedCount = tasks.filter((t) => t.installed).length;
  const totalBytes = tasks.reduce((a, t) => a + taskBytes(t), 0);
  const installedBytes = tasks.reduce((a, t) => a + (t.installed ? taskBytes(t) : 0), 0);
  const installedTasks = tasks.filter((t) => t.installed);

  const allInstalled = tasks.length > 0 && tasks.every((task) => task.installed);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/30" aria-hidden />
      <div className="relative flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-edge bg-white shadow-soft">
        <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-edge px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Setup &amp; Runtime</h2>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              Unduh model &amp; wheel yang belum tersedia.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup Setup"
            title="Close Setup"
            className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-ink text-white transition-opacity hover:opacity-80"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {booting ? (
            <div className="py-8 text-center text-[13px] text-ink-muted">
              Memuat daftar tugas setup…
            </div>
          ) : err ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
              {err}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border border-edge bg-canvas-subtle p-3">
                <div className="flex items-center justify-between text-[12px] text-ink-muted">
                  <span>{installedCount}/{tasks.length} komponen terpasang</span>
                  <span>{formatBytes(installedBytes)} dari {formatBytes(totalBytes)}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas-inset">
                  <div
                    className="h-full rounded-full bg-green-600 transition-[width] duration-300"
                    style={{ width: totalBytes > 0 ? `${(installedBytes / totalBytes) * 100}%` : "0%" }}
                  />
                </div>
              </div>

              {allInstalled ? (
                <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-green-700">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    Setup Lengkap — Semua Komponen Siap
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-green-700/80">
                    Semua komponen telah terpasang dan siap digunakan. Waves akan otomatis mendeteksi GPU dan model yang tersedia.
                  </p>
                  <div className="mt-3 space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-green-700/70">Yang sudah terpasang:</p>
                    {installedTasks.map((t) => {
                      const cat = CATEGORY_LABEL[t.category] ?? { label: t.category, icon: "📦", color: "", bg: "" };
                      return (
                        <div key={t.id} className="flex items-center gap-2 text-[12px] text-green-800">
                          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-green-200 text-[10px]">✓</span>
                          <span className="font-medium">{t.name}</span>
                          <span className="rounded border border-green-200 bg-green-100 px-1.5 py-0.5 text-[10px] leading-none">{cat.icon} {cat.label}</span>
                          <span className="ml-auto text-[11px] text-green-600">{formatBytes(taskBytes(t))}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {(["runtime", "model", "stem"] as const).map((cat) => {
                const groupTasks = tasks
                  .filter((t) => t.category === cat)
                  .sort((a, b) => a.name.localeCompare(b.name));
                if (groupTasks.length === 0) return null;
                const head =
                  cat === "runtime"
                    ? { title: "Runtime GPU", desc: "Framework komputasi GPU (NVIDIA CUDA) untuk menjalankan semua model AI." }
                    : cat === "model"
                      ? { title: "Model Gambar", desc: "Bobot model teks-ke-gambar. Unduh satu atau lebih sesuai kebutuhan." }
                      : { title: "Stem Separator", desc: "Bobot Demucs untuk memisahkan lagu menjadi vocals, drums, bass & other. Unduh sesuai model yang akan dipakai." };
                return (
                  <div key={cat} className="space-y-2">
                    <div>
                      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">{head.title}</h3>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{head.desc}</p>
                    </div>
                    {groupTasks.map((task) => {
                      const active = activeByTask[task.id];
                      const running = active ? isActive(active) : false;
                      const done = task.installed && !running;
                      const pct = running && active ? active.progress : task.percent || 0;
                      const showBar = !done && (running || (pct > 0 && pct < 100));
                      const partial = !done && !running && pct > 0 && pct < 100;
                      const c = CATEGORY_LABEL[task.category] ?? { label: task.category, color: "", bg: "", icon: "📦" };
                      const isModel = task.category === "model";
                      const deletable = isModel && !running && (done || partial);
                      const isDeleting = confirmDeleteId === task.id;
                      return (
                        <div
                          key={task.id}
                          className={`flex flex-col gap-2 rounded-md border bg-white p-3 ${done ? "border-green-200 bg-green-50/40" : "border-edge"}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none ${c.bg} ${c.color}`}
                                >
                                  {c.icon} {c.label}
                                </span>
                                {done && (
                                  <span className="inline-flex items-center gap-0.5 rounded border border-green-200 bg-green-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-green-700">
                                    ✓ Terpasang
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 text-[13px] font-medium text-ink">
                                {task.name}
                              </div>
                              <div className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
                                {task.description}
                              </div>
                              {task.info && (
                                <div className="mt-1 rounded bg-canvas-subtle px-2 py-1 text-[11px] leading-relaxed text-ink-muted">
                                  💡 {task.info}
                                </div>
                              )}
                              <div className="mt-1 text-[11px] text-ink-muted">
                                {done
                                  ? `✓ ${formatBytes(task.done_bytes || taskBytes(task))}`
                                  : running && active
                                    ? `${formatBytes(active.done_bytes)} / ${formatBytes(active.total_bytes)} (${Math.round(pct)}%)`
                                    : pct > 0
                                      ? `${formatBytes(task.done_bytes)} / ${formatBytes(taskBytes(task))} (${Math.round(pct)}%)`
                                      : `± ${formatBytes(taskBytes(task))}`}
                              </div>
                            </div>
                            <div className="flex flex-shrink-0 items-center gap-1.5">
                              <button
                                onClick={() => run(task)}
                                disabled={done || running}
                                title={
                                  running
                                    ? "Sedang berjalan — tidak perlu klik lagi"
                                    : undefined
                                }
                                className="rounded-md border border-edge bg-white w-20 px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-canvas-subtle disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {done
                                  ? "Selesai"
                                  : running
                                    ? `${Math.round(pct)}%`
                                    : partial
                                      ? "Lanjut"
                                      : "Unduh"}
                              </button>
                              {running && active && (
                                <button
                                  onClick={() => stopJob(active.job_id)}
                                  className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[12px] font-medium text-red-700 transition-colors hover:bg-red-100"
                                  title="Jeda unduhan — bisa dilanjut nanti"
                                >
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden
                                  >
                                    <path d="M9 5v14" strokeLinecap="round" />
                                    <path d="M15 5v14" strokeLinecap="round" />
                                  </svg>
                                </button>
                              )}
                              {deletable && !isDeleting && (
                                <button
                                  onClick={() => setConfirmDeleteId(task.id)}
                                  className="rounded-md border border-red-200 bg-white px-2 py-1.5 text-[12px] font-medium text-red-600 transition-colors hover:bg-red-50"
                                  title="Hapus model dari disk"
                                >
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden
                                  >
                                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>
                          {isDeleting && (
                            <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px]">
                              <span className="text-red-700">
                                Hapus model dari disk? Tindakan ini tidak bisa
                                dibatalkan.
                              </span>
                              <div className="ml-auto flex gap-1.5">
                                <button
                                  onClick={() => handleDelete(task)}
                                  className="rounded bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700"
                                >
                                  Hapus
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="rounded border border-edge bg-white px-2 py-1 text-[11px] font-medium text-ink hover:bg-canvas-subtle"
                                >
                                  Batal
                                </button>
                              </div>
                            </div>
                          )}
                          {showBar && (
                            <div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-canvas-inset">
                                <div
                                  className="h-full rounded-full bg-green-600 transition-[width] duration-300"
                                  style={{
                                    width: `${Math.min(100, Math.max(0, pct))}%`,
                                  }}
                                />
                              </div>
                              <div className="mt-1 flex items-center justify-between text-[11px] text-ink-muted">
                                <span>
                                  {running
                                    ? active?.eta_seconds != null
                                      ? `sisa ${formatEta(active.eta_seconds)}`
                                      : "menghitung…"
                                    : "sebagian terunduh"}
                                </span>
                                <span>
                                  {running && active?.rate_bps
                                    ? `${formatBytes(active.rate_bps)}/dtk`
                                    : ""}
                                </span>
                              </div>
                            </div>
                          )}
                          {running && active && (
                            <div className="mt-1 h-36 overflow-y-auto rounded-md border border-edge bg-canvas-inset p-2 font-mono text-[11px] leading-relaxed text-ink-muted">
                              {active.log.length === 0
                                ? "Menunggu log…"
                                : [...active.log]
                                    .slice(-80)
                                    .reverse()
                                    .map((line, i) => (
                                      <div key={i}>{line}</div>
                                    ))}
                            </div>
                          )}
                          {task.category === "runtime" &&
                          pythons.length > 0 &&
                          !done ? (
                            <div className="border-t border-edge pt-2.5">
                              <label className="flex items-center gap-2 text-[12px] font-medium text-ink">
                                <input
                                  type="checkbox"
                                  checked={installEnabled}
                                  onChange={(e) =>
                                    setInstallEnabled(e.target.checked)
                                  }
                                  className="h-3.5 w-3.5 accent-green-600"
                                />
                                Install ke Python setelah unduh selesai
                              </label>
                              {installEnabled ? (
                                <>
                                  <div className="mt-2">
                                    <Dropdown
                                      label="Install wheel ke (Python)"
                                      placeholder="Pilih lokasi Python…"
                                      value={pythonPath}
                                      onChange={setPythonPath}
                                      options={pythons.map((p) => ({
                                        id: p.path,
                                        label: p.display,
                                        right: (
                                          <span className="text-[11px] text-ink-muted">
                                            {p.path}
                                          </span>
                                        ),
                                      }))}
                                    />
                                  </div>
                                  <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                                    Akan dipasang ke Python pilihan di atas{" "}
                                    <b>dan selalu</b> ke venv proyek (yang
                                    dipakai backend Waves), supaya fitur tetap
                                    jalan walau kamu memilih Python sistem.
                                  </p>
                                </>
                              ) : (
                                <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                                  Wheel hanya diunduh ke{" "}
                                  <code>server/storage/torch</code> — pasang
                                  sendiri lewat terminal kalau mau.
                                </p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {pollError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">
                  {pollError}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center justify-between border-t border-edge px-4 py-2.5">
          <span className="text-[11px] text-ink-muted">
            {allInstalled ? "✓ Lengkap — semua siap" : `${installedCount}/${tasks.length} komponen terpasang`}
          </span>
        </div>
      </div>
    </div>
  );
}
