"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEVICE_OPTIONS,
  DEVICE_LABELS,
  formatBytes,
  fetchSystemInfo,
  type DeviceId,
  type DeviceSystemInfo,
} from "../lib/deviceApi";
import { useDevice } from "../lib/deviceContext";

export default function DeviceSelect() {
  const { device, setDevice, devices } = useDevice();
  const [open, setOpen] = useState(false);
  const [sys, setSys] = useState<DeviceSystemInfo | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSystemInfo().then((info) => {
      if (alive) setSys(info);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const gpuLine = sys?.gpu
    ? `${sys.gpu.name} · ${formatBytes(sys.gpu.vram)} VRAM`
    : "GPU Tidak Terdeteksi";
  const ramLine = sys?.ram
    ? `${formatBytes(sys.ram.available)} · ${formatBytes(sys.ram.total)} RAM`
    : null;

  return (
    <div className="relative flex items-center gap-2">
      <div className="hidden items-center h-8 gap-2 text-[12px] text-ink-muted sm:flex">
        <span
          title="Info Memori (RAM) Sistem"
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-edge bg-canvas-subtle px-2 py-1.5"
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M4 9.5A1.5 1.5 0 0 1 5.5 8H14v4.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 4 12.5v-3Zm1.5.5v2.5h7V10h-7Zm1 6.5v1h-1v-1h1Zm2.5 0v1h-1v-1h1Zm2.5 0v1h-1v-1h1Z" />
          </svg>
          {ramLine ?? "RAM —"}
        </span>
        <span
          title="Info GPU (CUDA) Sistem"
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-edge bg-canvas-subtle px-2 py-1.5"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M19 4.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 19 4.5Zm-5.75 0a2 2 0 0 1 2-2h.5a1.75 1.75 0 0 1 1.75 1.75v1.5a2 2 0 0 1-2 2h-.5a1.75 1.75 0 0 1-1.75-1.75v-1.5ZM1 5.25A1.25 1.25 0 0 1 2.25 4h9A1.25 1.25 0 0 1 12.5 5.25v9a2.25 2.25 0 0 1-2.25 2.25h-3.5a2.25 2.25 0 0 1-2.25-2.25v-2.5H2.25A1.25 1.25 0 0 1 1 10.5v-5.25Zm1.5.25v4.75h4a.75.75 0 0 1 0 1.5h-4v1.25a.75.75 0 0 0 .75.75h3.5a.75.75 0 0 0 .75-.75v-2.5a.75.75 0 0 1 .75-.75h10.25v-1a.75.75 0 0 0-.75-.75H10.5a.75.75 0 0 1-.75-.75V5.5h-7.25Zm8 2.75v-.25a.75.75 0 0 1 .75-.75H13a.25.25 0 0 1 .25.25v2.5A.75.75 0 0 1 12.5 10h-2a.75.75 0 0 1-.75-.75V8.25Z" />
          </svg>
          {gpuLine ?? "GPU —"}
        </span>
      </div>
      
      <div ref={rootRef} className="relative">
        <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-edge bg-white px-2.5 text-[13px] transition-shadow outline-none hover:bg-canvas-subtle"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="flex-shrink-0 text-ink-muted"
          aria-hidden
        >
          <path d="M9 3.25a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0ZM6.25 10a3.75 3.75 0 1 1 7.5 0 3.75 3.75 0 0 1-7.5 0ZM10 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm-4.96-3.35a.75.75 0 1 1 .94-1.17 6.3 6.3 0 0 1 8.04 0 .75.75 0 1 1-.94 1.17 4.8 4.8 0 0 0-8.04 0ZM2.5 10a7.5 7.5 0 1 1 15 0 7.5 7.5 0 0 1-15 0Zm7.5-5.75a5.75 5.75 0 1 0 0 11.5 5.75 5.75 0 0 0 0-11.5Z" />
        </svg>
        <span className="hidden sm:inline text-ink-muted">Device</span>
        <span className="font-semibold text-ink">
          {DEVICE_LABELS[(device as DeviceId) ?? "auto"] ?? device}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="flex-shrink-0 text-ink-muted"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-1 w-60 rounded-md border border-edge bg-white p-1 shadow-float"
        >
          {DEVICE_OPTIONS.map((opt) => {
            const isSel = opt.id === device;
            const unavailable = opt.id === "cuda" && !devices.includes("cuda");
            return (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={isSel}
                disabled={unavailable}
                onClick={() => {
                  setDevice(opt.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-[5px] border-none px-2 py-1.5 text-left text-[13px] ${
                  unavailable
                    ? "cursor-not-allowed opacity-55"
                    : isSel
                      ? "cursor-pointer bg-canvas-inset"
                      : "cursor-pointer hover:bg-canvas-subtle"
                }`}
              >
                <span className="flex-1">{opt.label}</span>
                {unavailable ? (
                  <span className="flex-shrink-0 text-[10px] text-ink-subtle">
                    tidak tersedia
                  </span>
                ) : (
                  isSel && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="flex-shrink-0 text-ink"
                      aria-hidden
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )
                )}
              </button>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}