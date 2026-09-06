export interface VoiceSpeaker {
  id: number;
  name: string;
}

export interface VoiceModelInfo {
  id: string;
  name: string;
  game?: string;
  language: string;
  sample_text?: string;
  speakers: VoiceSpeaker[];
  default_sid?: number;
  ready?: boolean;
}

const cacheBust = `v=${Date.now()}`;

export function coverUrl(modelId: string): string {
  return `/api/voice/models/${encodeURIComponent(modelId)}/cover?${cacheBust}`;
}

export async function fetchVoiceModels(): Promise<VoiceModelInfo[]> {
  const res = await fetch("/api/voice/models");
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.models;
}

export interface SynthesizeParams {
  modelId: string;
  text: string;
  speakerId: number;
  noiseScale: number;
  noiseScaleW: number;
  lengthScale: number;
}

export async function synthesizeVoice(params: SynthesizeParams): Promise<Blob> {
  const res = await fetch("/api/voice/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: params.modelId,
      text: params.text,
      speaker_id: params.speakerId,
      noise_scale: params.noiseScale,
      noise_scale_w: params.noiseScaleW,
      length_scale: params.lengthScale,
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `Sintesis gagal (${res.status})`);
  }
  return res.blob();
}
