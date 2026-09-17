"use client";

import { useEffect, useRef, useState } from "react";

import Dropdown from "@/components/Dropdown";
import {
  SetupJob,
  SetupPython,
  SetupTask,
  getSetupJob,
  fetchSetupPythons,
  fetchSetupTasks,
  formatBytes,
  formatEta,
  startSetupJob,
} from "@/lib/setupApi";

const STAGES: Record<string, string> = {
  "": "Menunggu mulai",
  queue: "Dalam antrean",
  download: "Mengunduh",
  install: "Memasang",
  done: "Selesai",
  error: "Gagal",
};

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
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<SetupJob | undefined>(undefined);
  const [log, setLog] = useState<string[]>([]);
  const [pollError, setPollError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setBooting(true);
    setErr("");
    setJob(undefined);
    setLog([]);
    setJobId("");
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

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const tick = async () => {
      try {
        const j = await getSetupJob(jobId);
        if (!alive) return;
        setJob(j);
        setLog(j.log);
        if (j.status === "done" || j.status === "error") {
          fetchSetupTasks().then((t) => { if (alive) setTasks(t); }).catch(() => {});
        }
      } catch (e) {
        if (alive) setPollError(e instanceof Error ? e.message : String(e));
      }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [jobId]);

  useEffect(() => {
    if (logRef.current && lastCount.current !== log.length) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
      lastCount.current = log.length;
    }
  }, [log]);

  if (!open) return null;

  async function run(task: SetupTask) {
    setErr("");
    setPollError("");
    setJob(undefined);
    setLog([]);
    try {
      const opts: { pythonPath?: string; install?: boolean } = {};
      if (task.category === "runtime" && pythonPath && installEnabled) {
        opts.pythonPath = pythonPath;
        opts.install = true;
      }
      const res = await startSetupJob(task.id, opts);
      setJobId(res.job_id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const taskBytes = (t: SetupTask) => t.total_bytes || ESTIMATED_BYTES[t.id] || 0;
  const installedCount = tasks.filter((t) => t.installed).length;
  const totalBytes = tasks.reduce((a, t) => a + taskBytes(t), 0);
  const installedBytes = tasks.reduce((a, t) => a + (t.installed ? taskBytes(t) : 0), 0);
  const installedTasks = tasks.filter((t) => t.installed);

  const allInstalled = tasks.length > 0 && tasks.every((task) => task.installed);
  const stageText = job ? STAGES[job.status] ?? job.stage : "";
  const progress = job ? job.progress : 0;

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
                      const done = task.installed;
                      const c = CATEGORY_LABEL[task.category] ?? { label: task.category, color: "", bg: "", icon: "📦" };
                      return (
                        <div
                          key={task.id}
                          className={`flex flex-col gap-2 rounded-md border bg-white p-3 ${done ? "border-green-200 bg-green-50/40" : "border-edge"}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none ${c.bg} ${c.color}`}>
                                  {c.icon} {c.label}
                                </span>
                                {done && <span className="inline-flex items-center gap-0.5 rounded border border-green-200 bg-green-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-green-700">✓ Terpasang</span>}
                              </div>
                              <div className="mt-1 text-[13px] font-medium text-ink">{task.name}</div>
                              <div className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">{task.description}</div>
                              {task.info && (
                                <div className="mt-1 rounded bg-canvas-subtle px-2 py-1 text-[11px] leading-relaxed text-ink-muted">💡 {task.info}</div>
                              )}
                              <div className="mt-1 text-[11px] text-ink-muted">
                                ± {formatBytes(taskBytes(task))}
                              </div>
                            </div>
                            <button
                              onClick={() => run(task)}
                              disabled={done}
                              className="flex-shrink-0 rounded-md border border-edge bg-white px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-canvas-subtle disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {done ? "Selesai" : "Unduh"}
                            </button>
                          </div>
                          {task.category === "runtime" && pythons.length > 0 && !done ? (
                            <div className="border-t border-edge pt-2.5">
                              <label className="flex items-center gap-2 text-[12px] font-medium text-ink">
                                <input
                                  type="checkbox"
                                  checked={installEnabled}
                                  onChange={(e) => setInstallEnabled(e.target.checked)}
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
                                        right: <span className="text-[11px] text-ink-muted">{p.path}</span>,
                                      }))}
                                    />
                                  </div>
                                  <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                                    Akan dipasang ke Python pilihan di atas <b>dan selalu</b> ke venv proyek
                                    (yang dipakai backend Waves), supaya fitur tetap jalan walau kamu memilih
                                    Python sistem.
                                  </p>
                                </>
                              ) : (
                                <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                                  Wheel hanya diunduh ke <code>server/storage/torch</code> — pasang sendiri
                                  lewat terminal kalau mau.
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

              {job && (
                <div className="rounded-md border border-edge bg-canvas-subtle p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-ink">{job.task_name}</span>
                    <span className="text-[12px] text-ink-muted">
                      {stageText} · {Math.round(progress)}%
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas-inset">
                    <div
                      className="h-full rounded-full bg-green-600 transition-[width] duration-300"
                      style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink-muted">
                    <span>{formatBytes(job.done_bytes)} / {formatBytes(job.total_bytes)}</span>
                    <span>
                      {job.rate_bps ? `${formatBytes(job.rate_bps)}/dtk` : "…"} ·{" "}
                      {job.eta_seconds !== null ? `sisa ${formatEta(job.eta_seconds)}` : "—"}
                    </span>
                  </div>
                  <div
                    ref={logRef}
                    className="mt-2 h-32 overflow-y-auto rounded-md border border-edge bg-canvas-inset p-2 font-mono text-[11px] leading-relaxed text-ink-muted"
                  >
                    {log.length === 0 ? "Menunggu log…" : log.map((line, i) => <div key={i}>{line}</div>)}
                  </div>
                </div>
              )}

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
