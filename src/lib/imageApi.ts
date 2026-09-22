export interface ModelInfo {
  id: string;
  name: string;
  installed: boolean;
  description?: string;
  has_cover?: boolean;
}

export function sdCoverUrl(modelId: string): string {
  return `/api/models/${encodeURIComponent(modelId)}/cover`;
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch("/api/models");
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.models;
}

export interface GenerateImageParams {
  modelId: string;
  prompt: string;
  negativePrompt: string;
  steps: number;
  guidanceScale: number;
  width: number;
  height: number;
  seed: number | null;
  nImages: number;
  device?: string;
  initImage?: string;
  strength?: number;
}

export interface GenerateImageResult {
  images: string[];
  seed: number | null;
}

export interface ImageJobStatus {
  id: string;
  status: "queued" | "processing" | "done" | "error";
  progress: number;
  stage: string;
  error?: string | null;
  result?: GenerateImageResult | null;
}

export async function fetchImageJob(jobId: string): Promise<ImageJobStatus> {
  const res = await fetch(`/api/generate/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    const textFallback = !detail ? await res.clone().text().catch(() => "") : "";
    const msg = detail?.detail || textFallback || `Gagal memuat status job (${res.status})`;
    const suffix = msg.includes(`(${res.status})`) ? "" : ` (${res.status})`;
    throw new Error(msg + suffix);
  }
  return res.json();
}

export async function generateImage(
  params: GenerateImageParams,
  onProgress?: (stage: string, progress: number) => void
): Promise<GenerateImageResult> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: params.modelId,
      prompt: params.prompt,
      negative_prompt: params.negativePrompt,
      steps: params.steps,
      guidance_scale: params.guidanceScale,
      width: params.width,
      height: params.height,
      seed: params.seed,
      n_images: params.nImages,
      device: params.device ?? "auto",
      init_image_b64: params.initImage,
      strength: params.strength ?? 0.5,
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `Generasi gagal (${res.status})`);
  }
  const data = await res.json();
  // Mode async baru: { job_id } — polling hingga done
  if ((data as { job_id?: string }).job_id) {
    const jobId = (data as { job_id: string }).job_id;
    let transient = 0;
    const maxTransient = 20;
    while (true) {
      await new Promise((r) => setTimeout(r, 800));
      let st: ImageJobStatus;
      try {
        st = await fetchImageJob(jobId);
        transient = 0;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("(404)") || msg.toLowerCase().includes("tidak ditemukan")) throw e;
        transient += 1;
        if (transient >= maxTransient) throw e;
        if (onProgress) onProgress(`Menghubungkan ulang... (${transient})`, -1);
        continue;
      }
      if (onProgress) onProgress(st.stage || "Memproses", st.progress ?? 0);
      if (st.status === "error") throw new Error(st.error || "Generasi gagal");
      if (st.status === "done" && st.result) return st.result as GenerateImageResult;
    }
  }
  // Fallback sync lama: { images, seed }
  return data as GenerateImageResult;
}