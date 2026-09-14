import type { JobState, ModelId, RecentJob } from "./types";

export function isBackendDown(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  if (msg.startsWith("{")) return false;
  const lower = msg.toLowerCase();
  return (
    lower.includes("fetch failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("internal server error") ||
    lower === "request failed (500)" ||
    lower === "500"
  );
}

export const BACKEND_DOWN_HINT =
  'Backend belum dijalankan. Mulai dulu dengan `python -m uvicorn server.main:app --port 8000`, lalu muat ulang halaman ini. Panel di bawah dinonaktifkan sampai backend menyala.';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function uploadTrack(
  file: File,
  model: ModelId,
  device: string = "auto"
): Promise<{ job_id: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("model", model);
  form.append("device", device);
  const res = await fetch("/api/jobs", { method: "POST", body: form });
  return json(res);
}

export async function fetchJob(jobId: string): Promise<JobState> {
  const res = await fetch(`/api/jobs/${jobId}`);
  return json(res);
}

export async function retryJob(jobId: string): Promise<{ job_id: string }> {
  const res = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
  return json(res);
}

export async function deleteJob(jobId: string): Promise<void> {
  const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Request failed (${res.status})`);
  }
}

export async function listRecentJobs(): Promise<RecentJob[]> {
  const res = await fetch("/api/jobs?limit=20");
  return json(res);
}

export function stemUrl(jobId: string, stem: string): string {
  return `/api/jobs/${jobId}/stems/${stem}`;
}

export function originalUrl(jobId: string): string {
  return `/api/jobs/${jobId}/original`;
}
