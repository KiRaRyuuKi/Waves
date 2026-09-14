export interface SdModelInfo {
  id: string;
  name: string;
  description?: string;
  has_cover?: boolean;
}

const cacheBust = `v=${Date.now()}`;

export function sdCoverUrl(modelId: string): string {
  return `/api/sd/models/${encodeURIComponent(modelId)}/cover?${cacheBust}`;
}

export async function fetchSdModels(): Promise<SdModelInfo[]> {
  const res = await fetch("/api/sd/models");
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

export async function generateImage(params: GenerateImageParams): Promise<GenerateImageResult> {
  const res = await fetch("/api/sd/generate", {
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
  return res.json();
}