export type DeviceId = "auto" | "cpu" | "cuda";

export interface DeviceSystemInfo {
  ram: { total: number; available: number } | null;
  gpu: { name: string; vram: number; cuda_version: string; torch_version: string } | null;
}

export const DEVICE_OPTIONS: { id: DeviceId; label: string }[] = [
  { id: "auto", label: "Auto (terbaik tersedia)" },
  { id: "cpu", label: "CPU (Prosesor)" },
  { id: "cuda", label: "CUDA (GPU)" },
];

export const DEVICE_LABELS: Record<DeviceId, string> = {
  auto: "Auto",
  cpu: "CPU",
  cuda: "CUDA (GPU)",
};

export async function fetchDevices(): Promise<DeviceId[]> {
  try {
    const res = await fetch("/api/devices");
    if (!res.ok) return ["cpu"];
    const data = await res.json();
    return (data?.devices ?? ["cpu"]).filter(
      (d: string) => d === "cpu" || d === "cuda"
    );
  } catch {
    return ["cpu"];
  }
}

export async function fetchSystemInfo(): Promise<DeviceSystemInfo> {
  try {
    const res = await fetch("/api/devices", { cache: "no-store" });
    if (!res.ok) return { ram: null, gpu: null };
    const data = await res.json();
    return (data?.system ?? { ram: null, gpu: null }) as DeviceSystemInfo;
  } catch {
    return { ram: null, gpu: null };
  }
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(n: number | null | undefined): string {
  if (!n || !Number.isFinite(n) || n <= 0) return "—";
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${UNITS[i]}`;
}