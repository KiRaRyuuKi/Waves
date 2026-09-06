export interface TrainingFileItem {
  file: string;
  text: string;
}

export interface TrainingDataset {
  id: string;
  files: TrainingFileItem[];
}

export interface TrainingStatus {
  id: string;
  status: "preparing" | "training" | "done" | "cancelled" | "error";
  step: number;
  total: number;
  model_id?: string;
  base_model?: string;
  speaker_id?: number;
  error?: string;
  done: boolean;
  n_samples?: number;
  elapsed?: number;
  eta_seconds?: number;
  last_msg?: string;
  last_checkpoint?: string;
  loss_gen?: number;
  loss_mel?: number;
  loss_kl?: number;
  loss_dur?: number;
  loss_disc?: number;
  dataset_desc?: string[];
}

async function jsonOrThrow(res: Response): Promise<any> {
  if (res.ok) return res.json();
  let detail = res.statusText;
  try {
    const body = await res.json();
    detail = body?.detail || detail;
  } catch {
    /* ignore */
  }
  throw new Error(detail);
}

export async function uploadTrainingDataset(
  files: File[],
  transcripts: { file: string; text: string }[]
): Promise<{ id: string }> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  form.append("transcripts", JSON.stringify(transcripts));
  const res = await fetch("/api/training/datasets", { method: "POST", body: form });
  return jsonOrThrow(res);
}

export async function fetchTrainingDatasets(): Promise<TrainingDataset[]> {
  const data = await jsonOrThrow(await fetch("/api/training/datasets"));
  return data.datasets;
}

export async function updateTrainingTranscript(
  datasetId: string,
  file: string,
  text: string
): Promise<void> {
  const res = await fetch(`/api/training/datasets/${encodeURIComponent(datasetId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file, text }),
  });
  await jsonOrThrow(res);
}

export async function deleteTrainingDataset(datasetId: string): Promise<void> {
  const res = await fetch(`/api/training/datasets/${encodeURIComponent(datasetId)}`, {
    method: "DELETE",
  });
  await jsonOrThrow(res);
}

export interface StartTrainingParams {
  datasetId: string;
  name: string;
  steps: number;
  learningRate: number;
  sampleText: string;
}

export async function startTraining(
  params: StartTrainingParams
): Promise<{ session_id: string; model_id: string; steps: number }> {
  const res = await fetch("/api/training/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dataset_id: params.datasetId,
      name: params.name,
      steps: params.steps,
      learning_rate: params.learningRate,
      sample_text: params.sampleText,
      base_model: "kafka",
    }),
  });
  return jsonOrThrow(res);
}

export async function fetchTrainingStatus(sessionId: string): Promise<TrainingStatus> {
  return jsonOrThrow(
    await fetch(`/api/training/status/${encodeURIComponent(sessionId)}`)
  );
}

export async function stopTraining(): Promise<{ stopped: boolean }> {
  const res = await fetch("/api/training/stop", { method: "POST" });
  return jsonOrThrow(res);
}

export interface TrainedModel {
  model_id: string;
  name: string;
  language: string;
  ready: boolean;
}

export async function fetchTrainedModels(): Promise<TrainedModel[]> {
  const data = await jsonOrThrow(await fetch("/api/training/models"));
  return data.models;
}