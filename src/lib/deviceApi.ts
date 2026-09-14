export type DeviceId = "auto" | "cpu" | "cuda";

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