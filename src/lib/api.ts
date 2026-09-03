import type { JobState, ModelId } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function uploadTrack(file: File, model: ModelId): Promise<{ job_id: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("model", model);
  const res = await fetch("/api/jobs", { method: "POST", body: form });
  return json(res);
}

export async function fetchJob(jobId: string): Promise<JobState> {
  const res = await fetch(`/api/jobs/${jobId}`);
  return json(res);
}

export function stemUrl(jobId: string, stem: string): string {
  return `/api/jobs/${jobId}/stems/${stem}`;
}

export function originalUrl(jobId: string): string {
  return `/api/jobs/${jobId}/original`;
}
