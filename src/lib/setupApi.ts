export type SetupTaskStatus = "not_installed" | "installed" | "partial";
export type SetupTaskCategory = "runtime" | "model" | "model_video" | "stem";
export type SetupJobStatus = "queued" | "running" | "done" | "error";

export interface SetupTask {
  id: string;
  name: string;
  description: string;
  info: string;
  category: SetupTaskCategory;
  total_bytes: number;
  installed: boolean;
  status: SetupTaskStatus;
  percent: number;
  done_bytes: number;
  python_path?: string;
}

export interface SetupPython {
  path: string;
  version: string;
  display: string;
}

export interface SetupJob {
  job_id: string;
  task_id: string;
  task_name: string;
  status: SetupJobStatus;
  stage: string;
  progress: number;
  done_bytes: number;
  total_bytes: number;
  eta_seconds: number | null;
  rate_bps: number | null;
  error: string | null;
  log: string[];
  created_at: number;
}

/** Satu event SSE yang diteruskan dari backend /api/setup/jobs/{id}/stream. */
export interface SetupStreamEvent {
  type: "progress" | "done" | "error";
  job: SetupJob;
}

const BACKEND_DOWN_HINT =
  "Backend belum dijalankan. Mulai dulu dengan `python -m uvicorn server.waves:app --port 9035`, lalu muat ulang halaman ini.";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Request gagal (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function tryFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { cache: "no-store", ...init });
  } catch {
    throw new Error(BACKEND_DOWN_HINT);
  }
}

export async function fetchSetupTasks(): Promise<SetupTask[]> {
  const res = await tryFetch("/api/setup/tasks");
  const data = await json<{ tasks: SetupTask[] }>(res);
  return data.tasks ?? [];
}

export async function fetchSetupJobs(): Promise<SetupJob[]> {
  const res = await tryFetch("/api/setup/jobs");
  const data = await json<{ jobs: SetupJob[] }>(res);
  return data.jobs ?? [];
}

export async function fetchSetupPythons(): Promise<SetupPython[]> {
  const res = await tryFetch("/api/setup/pythons");
  const data = await json<{ pythons: SetupPython[] }>(res);
  return data.pythons ?? [];
}

export async function startSetupJob(
  taskId: string,
  opts: { pythonPath?: string; install?: boolean } = {}
): Promise<{ job_id: string }> {
  const q = new URLSearchParams();
  if (opts.pythonPath) q.set("python_path", opts.pythonPath);
  if (opts.install) q.set("install", "1");
  const qs = q.toString();
  const res = await tryFetch(
    `/api/setup/tasks/${encodeURIComponent(taskId)}/run${qs ? `?${qs}` : ""}`,
    { method: "POST" }
  );
  return json<{ job_id: string }>(res);
}

export async function deleteTask(taskId: string): Promise<{ status: string }> {
  const res = await tryFetch(`/api/setup/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
  return json<{ status: string }>(res);
}

export async function getSetupJob(jobId: string): Promise<SetupJob> {
  const res = await tryFetch(`/api/setup/jobs/${encodeURIComponent(jobId)}`);
  return json<SetupJob>(res);
}

/** URL SSE lewat proxy Next (satu-satunya jalur, rewrite saja tidak cukup). */
export function setupJobStreamUrl(jobId: string): string {
  return `/api/setup/jobs/${encodeURIComponent(jobId)}/stream`;
}

const SSE_RE = /^data:\s*(.+)$/m;

/** Berlangganan progres job lewat SSE. Kembalikan fungsi untuk berhenti. */
export function subscribeSetupJob(
  jobId: string,
  handlers: {
    onEvent?: (ev: SetupStreamEvent) => void;
    onError?: (message: string) => void;
  }
): () => void {
  const es = new EventSource(setupJobStreamUrl(jobId));
  let stopped = false;

  const stop = () => {
    stopped = true;
    es.close();
  };

  es.onmessage = (ev) => {
    if (stopped) return;
    let job: SetupJob;
    try {
      job = JSON.parse(ev.data) as SetupJob;
    } catch {
      return;
    }
    const type: SetupStreamEvent["type"] =
      job.status === "error"
        ? "error"
        : job.status === "done"
        ? "done"
        : "progress";
    handlers.onEvent?.({ type, job });
  };

  es.onerror = () => {
    if (stopped) return;
    es.close();
    handlers.onError?.(
      "Koneksi progres terputus. Coba muat ulang modal Setup, atau pastikan backend masih hidup."
    );
  };

  return stop;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** Konversi detik jadi "1j 12m" / "3m 40s" (bahasa Indonesia). */
export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}j ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
