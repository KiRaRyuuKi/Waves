import { isBackendDown } from "./api";

export interface RemoverModel {
  id: string;
  name: string;
  path: string;
  size: number;
  installed: boolean;
}

export async function fetchRemoverModels(): Promise<RemoverModel[]> {
  const res = await fetch("/api/remover/models", { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Gagal memuat model remover (${res.status})`);
  }
  const data = await res.json();
  return (data.models ?? []) as RemoverModel[];
}

export async function fetchRemoverHealth(): Promise<{
  status: string;
  python: string;
  remover_root: string;
  models: RemoverModel[];
}> {
  const res = await fetch("/api/remover/health", { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function removeBackground(
  file: File,
  modelId: string = "u2net"
): Promise<Blob> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("model", modelId);
  const res = await fetch("/api/remover/remove", {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    // Try json detail
    try {
      const j = JSON.parse(text);
      throw new Error(j.detail || text);
    } catch {
      if (text.startsWith("{")) {
        try {
          const j2 = JSON.parse(text);
          if (j2.detail) throw new Error(j2.detail);
        } catch {}
      }
    }
    throw new Error(text || `Remove gagal (${res.status})`);
  }
  return res.blob();
}

export function isRemoverBackendDown(err: unknown): boolean {
  return isBackendDown(err);
}
