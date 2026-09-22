// LLM Hub — Hugging Face + GGUF + Ollama/LM Studio
export interface HfModelCard {
  id: string;
  author: string;
  likes: number;
  downloads: number;
  lastModified: string;
  tags: string[];
  pipeline_tag?: string;
  description: string;
  gguf_files: number;
  quants: string[];
  size_hint: string;
  ctx_hint: string;
  private: boolean;
  siblings_preview: string[];
}

export interface HfModelDetail {
  id: string;
  author: string;
  tags: string[];
  pipeline_tag?: string;
  likes: number;
  downloads: number;
  lastModified: string;
  description: string;
  cardData: Record<string, unknown>;
  gguf_files: { filename: string; quant: string; rfilename: string; download_url: string }[];
  all_siblings: number;
}

export interface RuntimeStatus {
  ollama: { online: boolean; url: string; models: unknown[] };
  lmstudio: { online: boolean; url: string; models: unknown[] };
  preferred: "ollama" | "lmstudio" | null;
  llm_dir: string;
}

export interface LocalGguf {
  repo: string;
  filename: string;
  path: string;
  rel: string;
  size: number;
  size_human: string;
  quant: string;
}

export interface LlmCategory {
  id: string;
  label: string;
  hint: string;
}

export interface LlmDownloadJob {
  id: string;
  job_id: string;
  repo: string;
  filename: string;
  dest: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  done_bytes: number;
  total_bytes: number;
  done_human: string;
  total_human: string;
  rate_human: string | null;
  rate_bps: number | null;
  eta_seconds: number | null;
  error: string | null;
  log: string[];
  created_at: number;
}

export interface Preset {
  ctx: number;
  n_batch: number;
  n_threads: number;
  gpu_layers: number;
  use_mmap: boolean;
  use_mlock: boolean;
  temperature: number;
  top_k: number;
  top_p: number;
  min_p: number;
  tfs_z: number;
  typical_p: number;
  repeat_penalty: number;
  repeat_last_n: number;
  presence_penalty: number;
  frequency_penalty: number;
  penalize_nl: boolean;
  mirostat: number;
  mirostat_tau: number;
  mirostat_eta: number;
  seed: number;
  n_predict: number;
  num_keep: number;
  stop: string[];
  system_prompt: string;
  runtime: string;
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const t = await res.text().catch(() => res.statusText);
    try {
      const jo = JSON.parse(t);
      throw new Error(jo.detail || jo.error || t || `Request failed (${res.status})`);
    } catch (e) {
      if (e instanceof Error && e.message !== t) throw e;
      throw new Error(t || `Request failed (${res.status})`);
    }
  }
  return res.json() as Promise<T>;
}

export async function fetchRuntimeStatus(): Promise<RuntimeStatus> {
  const r = await fetch("/api/llm/runtime/status");
  return j(r);
}

export async function fetchCategories(): Promise<{ categories: LlmCategory[]; quants: string[]; sizes: { id: string; label: string }[] }> {
  const r = await fetch("/api/llm/categories");
  return j(r);
}

export async function searchHf(params: {
  query?: string;
  category?: string;
  quant?: string;
  size?: string;
  sort?: string;
  limit?: number;
  skip?: number;
  gguf_only?: boolean;
}): Promise<{ models: HfModelCard[]; query: unknown }> {
  const sp = new URLSearchParams();
  if (params.query) sp.set("query", params.query);
  if (params.category) sp.set("category", params.category);
  if (params.quant) sp.set("quant", params.quant);
  if (params.size) sp.set("size", params.size);
  if (params.sort) sp.set("sort", params.sort);
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.skip) sp.set("skip", String(params.skip));
  sp.set("gguf_only", String(params.gguf_only ?? true));
  const r = await fetch(`/api/llm/hf/search?${sp.toString()}`);
  return j(r);
}

export async function fetchHfDetail(repoId: string): Promise<HfModelDetail> {
  const r = await fetch(`/api/llm/hf/model/${encodeURIComponent(repoId)}`);
  return j(r);
}

export async function fetchLocal(): Promise<{ models: LocalGguf[]; count: number; dir: string }> {
  const r = await fetch("/api/llm/local");
  return j(r);
}

export async function startDownload(repoId: string, filename: string): Promise<{ job_id: string }> {
  const r = await fetch("/api/llm/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoId, filename }),
  });
  return j(r);
}

export async function listDownloadJobs(): Promise<{ jobs: LlmDownloadJob[] }> {
  const r = await fetch("/api/llm/download/jobs");
  return j(r);
}

export async function getDownloadJob(jobId: string): Promise<LlmDownloadJob> {
  const r = await fetch(`/api/llm/download/jobs/${jobId}`);
  return j(r);
}

export function subscribeDownloadJob(
  jobId: string,
  handlers: { onEvent: (j: LlmDownloadJob) => void; onError?: (e: Event) => void; onDone?: () => void },
) {
  const es = new EventSource(`/api/llm/download/jobs/${jobId}/stream`);
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.error) {
        es.close();
        handlers.onError?.(ev as unknown as Event);
        return;
      }
      handlers.onEvent(data as LlmDownloadJob);
      if (data.status === "done" || data.status === "error") {
        es.close();
        handlers.onDone?.();
      }
    } catch {
      // ignore
    }
  };
  es.onerror = (e) => {
    handlers.onError?.(e);
  };
  return () => es.close();
}

export async function fetchPreset(model: string): Promise<{ model: string; config: Preset }> {
  const r = await fetch(`/api/llm/config?model=${encodeURIComponent(model)}`);
  return j(r);
}

export async function savePreset(model: string, config: Partial<Preset>): Promise<{ model: string; config: Preset }> {
  const r = await fetch("/api/llm/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, config }),
  });
  return j(r);
}

export async function deleteLocal(repo: string, filename: string): Promise<{ deleted: string }> {
  const r = await fetch(`/api/llm/local/${encodeURIComponent(repo)}?filename=${encodeURIComponent(filename)}`, { method: "DELETE" });
  return j(r);
}

export async function deletePreset(model: string): Promise<{ deleted: string }> {
  const r = await fetch(`/api/llm/config?model=${encodeURIComponent(model)}`, { method: "DELETE" });
  return j(r);
}

export async function fetchOllamaModelfile(repo: string, filename: string, model?: string): Promise<{ modelfile: string; from: string; params: string[]; ollama_dir: string }> {
  const sp = new URLSearchParams({ repo, filename });
  if (model) sp.set("model", model);
  const r = await fetch(`/api/llm/ollama/modelfile?${sp.toString()}`);
  return j(r);
}

export async function importToOllama(repo: string, filename: string, model?: string): Promise<{ imported: string; modelfile: string; ollama_dir: string; from: string }> {
  const r = await fetch("/api/llm/ollama/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo, filename, model }),
  });
  return j(r);
}

export async function fetchConvertStatus(): Promise<{ available: boolean; script: string | null; has_llama_cpp: boolean; staging: string; ollama_dir: string; hint: string; setup?: { status: string; progress: number; log: string[]; error: string | null; done: boolean } }> {
  const r = await fetch("/api/llm/convert/status");
  return j(r);
}

export async function convertToGguf(repo: string): Promise<{ converted: string; size: number; size_human: string }> {
  const r = await fetch("/api/llm/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo }),
  });
  return j(r);
}

export async function setupLlamaCpp(): Promise<{ status: string; progress: number; hint?: string; script?: string }> {
  const r = await fetch("/api/llm/convert/setup", { method: "POST" });
  return j(r);
}

export async function fetchSetupStatus(): Promise<{ status: string; progress: number; log: string[]; error: string | null; done: boolean; available: boolean; script: string | null }> {
  const r = await fetch("/api/llm/convert/setup/status");
  return j(r);
}
