export interface VideoBaseModel {
  id: string;
  name: string;
  description?: string;
  has_cover?: boolean;
}

export interface VideoModelInfo {
  id: string;
  kind: "animatediff" | "wan";
  name: string;
  description: string;
  installed: boolean;
  installed_bytes: number;
  note?: string | null;
  bases: VideoBaseModel[];
}

export interface VideoOutput {
  name: string;
  url: string;
  size: number;
  size_human: string;
  created: number;
}

export function sdCoverUrlForVideoBase(modelId: string): string {
  // Hindari Date.now() di level modul (hydration mismatch SSR/client).
  // Cache-bust cukup dengan timestamp saat fungsi dipanggil, atau tanpa bust karena header no-store.
  return `/api/models/${encodeURIComponent(modelId)}/cover`;
}

export async function fetchVideoModels(): Promise<VideoModelInfo[]> {
  const res = await fetch("/api/video/models");
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.models;
}

export async function fetchVideoOutputs(): Promise<VideoOutput[]> {
  const res = await fetch("/api/video/outputs");
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.videos;
}

export interface GenerateVideoParams {
  modelId: string;
  baseId?: string;
  prompt: string;
  negativePrompt: string;
  steps: number;
  guidanceScale: number;
  width: number;
  height: number;
  numFrames: number;
  fps: number;
  seed: number | null;
  device?: string;
  initImage?: string;
  strength?: number;
}

export interface GenerateVideoResult {
  video: string;
  video_url?: string;
  seed: number | null;
  num_frames: number;
  fps: number;
  width: number;
  height: number;
  model_id: string;
  device: string;
}

export async function generateVideo(
  params: GenerateVideoParams,
  onProgress?: (stage: string, progress: number) => void
): Promise<GenerateVideoResult> {
  const res = await fetch("/api/video/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: params.modelId,
      base_id: params.baseId ?? "",
      prompt: params.prompt,
      negative_prompt: params.negativePrompt,
      steps: params.steps,
      guidance_scale: params.guidanceScale,
      width: params.width,
      height: params.height,
      num_frames: params.numFrames,
      fps: params.fps,
      seed: params.seed,
      device: params.device ?? "auto",
      init_image_b64: params.initImage ?? null,
      strength: params.strength ?? 0.5,
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `Generasi gagal (${res.status})`);
  }
  const data = await res.json();
  // New async job: { job_id } — poll until done with progress callback
  if (data.job_id) {
    const jobId = data.job_id as string;
    let transientFailures = 0;
    const maxTransient = 20; // ~30s of backend stalls (20*1.5s) sebelum dianggap gagal; inference video bisa 20 menit
    while (true) {
      await new Promise((r) => setTimeout(r, 1500));
      let st: VideoJobStatus;
      try {
        st = await fetchVideoJob(jobId);
        transientFailures = 0;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // 404 = job hilang (server restart, TTL) — fatal
        if (msg.includes("(404)") || msg.toLowerCase().includes("tidak ditemukan")) {
          throw e;
        }
        transientFailures += 1;
        if (transientFailures >= maxTransient) {
          throw e;
        }
        // Backend sedang sibuk (inference blok, ECONNRESET/ETIMEDOUT) — jangan fatal, tampilkan retry
        if (onProgress) {
          // pertahankan progress lama, cuma ganti stage agar user tahu sedang retry
          onProgress(`Menghubungkan ulang ke backend... (${transientFailures})`, -1);
        }
        continue;
      }
      if (onProgress) onProgress(st.stage || "Memproses", st.progress || 0);
      if (st.status === "error") {
        throw new Error(st.error || "Generasi video gagal");
      }
      if (st.status === "done" && st.result) {
        return st.result as GenerateVideoResult;
      }
      // still queued/processing — continue polling
    }
  }
  return data as GenerateVideoResult;
}

export interface VideoJobStatus {
  id: string;
  status: "queued" | "processing" | "done" | "error";
  progress: number;
  stage: string;
  error?: string | null;
  result?: GenerateVideoResult | null;
}

export async function fetchVideoJob(jobId: string): Promise<VideoJobStatus> {
  const res = await fetch(`/api/video/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    // Coba parse JSON, fallback ke text (proxy Next bisa kembalikan HTML saat ECONNRESET/ETIMEDOUT)
    const detail = await res.json().catch(() => null);
    const textFallback = !detail ? await res.clone().text().catch(() => "") : "";
    const msg = detail?.detail || textFallback || `Gagal memuat status job (${res.status})`;
    // Sertakan status agar caller bisa bedakan 404 vs 500 transient
    const suffix = msg.includes(`(${res.status})`) ? "" : ` (${res.status})`;
    throw new Error(msg + suffix);
  }
  return res.json();
}
