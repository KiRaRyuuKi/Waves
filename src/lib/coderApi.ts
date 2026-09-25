export type CoderStack = "html_tailwind" | "html_css" | "react_tailwind" | "vue_tailwind" | "bootstrap" | "ionic_tailwind";
export type CoderProvider = "openai" | "anthropic" | "gemini" | "ollama" | "auto";

export interface CoderStackInfo {
  id: CoderStack;
  label: string;
  hint: string;
}

export interface CoderConfigStatus {
  providers: Record<string, { configured: boolean; source: string; preview: string | null }>;
  ollama: { online: boolean; models: { name: string }[] };
  openai_base_url: string | null;
}

export interface CoderGenerateParams {
  // data URL or raw base64
  imageB64: string;
  stack: CoderStack;
  prompt?: string;
  provider?: CoderProvider;
  model?: string;
  refineCode?: string;
  refineInstruction?: string;
}

export interface CoderJobStatus {
  id: string;
  status: "queued" | "processing" | "done" | "error";
  progress: number;
  stage: string;
  error?: string | null;
  result?: { code: string; raw: string; stack: string; provider: string; model: string } | null;
  stack: string;
  provider: string;
}

export async function fetchCoderStacks(): Promise<CoderStackInfo[]> {
  const res = await fetch("/api/coder/stacks");
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.stacks;
}

export async function fetchCoderConfig(): Promise<CoderConfigStatus> {
  const res = await fetch("/api/coder/config");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function saveCoderConfig(provider: string, apiKey: string, baseUrl?: string): Promise<void> {
  const res = await fetch("/api/coder/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, api_key: apiKey, base_url: baseUrl }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => null);
    throw new Error(d?.detail || `Gagal simpan config (${res.status})`);
  }
}

export interface CoderRawConfig {
  path: string;
  exists: boolean;
  raw: string;
  parsed: Record<string, unknown> | null;
}

export async function fetchCoderRawConfig(): Promise<CoderRawConfig> {
  const res = await fetch("/api/coder/config/raw");
  if (!res.ok) {
    const d = await res.json().catch(() => null);
    throw new Error(d?.detail || `Gagal memuat config mentah (${res.status})`);
  }
  return res.json();
}

export async function saveCoderRawConfig(raw: string): Promise<void> {
  const res = await fetch("/api/coder/config/raw", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => null);
    throw new Error(d?.detail || `Gagal simpan config mentah (${res.status})`);
  }
}

export async function fetchCoderJob(jobId: string): Promise<CoderJobStatus> {
  const res = await fetch(`/api/coder/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const d = await res.json().catch(() => null);
    const t = !d ? await res.clone().text().catch(() => "") : "";
    const msg = d?.detail || t || `Gagal memuat job (${res.status})`;
    throw new Error(msg + (msg.includes(`(${res.status})`) ? "" : ` (${res.status})`));
  }
  return res.json();
}

export async function generateCoderCode(
  params: CoderGenerateParams,
  onProgress?: (stage: string, progress: number) => void
): Promise<{ code: string; raw: string; stack: string; provider: string; model: string }> {
  const res = await fetch("/api/coder/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_b64: params.imageB64,
      stack: params.stack,
      prompt: params.prompt || "",
      provider: params.provider || "auto",
      model: params.model || "",
      refine_code: params.refineCode || null,
      refine_instruction: params.refineInstruction || null,
    }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => null);
    const t = !d ? await res.clone().text().catch(() => "") : "";
    throw new Error(d?.detail || t || `Generate gagal (${res.status})`);
  }
  const data = await res.json();
  if (!data.job_id) throw new Error("Backend tidak mengembalikan job_id");
  const jobId = data.job_id as string;
  let transient = 0;
  const maxTransient = 25;
  while (true) {
    await new Promise((r) => setTimeout(r, 1200));
    let st: CoderJobStatus;
    try {
      st = await fetchCoderJob(jobId);
      transient = 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("(404)") || msg.toLowerCase().includes("tidak ditemukan")) throw e;
      transient++;
      if (transient >= maxTransient) throw e;
      if (onProgress) onProgress(`Menghubungkan ulang... (${transient})`, -1);
      continue;
    }
    if (onProgress) onProgress(st.stage || "Memproses", st.progress ?? 0);
    if (st.status === "error") throw new Error(st.error || "Generasi gagal");
    if (st.status === "done" && st.result) return st.result;
  }
}
