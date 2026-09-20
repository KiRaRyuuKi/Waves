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

const coverCacheBust = `v=${Date.now()}`;
export function sdCoverUrlForVideoBase(modelId: string): string {
  return `/api/models/${encodeURIComponent(modelId)}/cover?${coverCacheBust}`;
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
  params: GenerateVideoParams
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
  return res.json();
}
