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
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.59 14.37a6 6 0 0 1-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 0 0 6.16-12.12A14.98 14.98 0 0 0 9.631 8.41m5.96 5.96a14.926 14.926 0 0 1-5.841 2.58m-.119-8.54a6 6 0 0 0-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 0 0-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 0 1-2.448-2.448 14.9 14.9 0 0 1 .06-.312m-2.24 2.39a4.493 4.493 0 0 0-1.757 4.306 4.493 4.493 0 0 0 4.306-1.758M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"
            />
          </svg>
          {ramLine ?? "RAM —"}
        </span>
        <span
          title="Info GPU (CUDA) Sistem"
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-edge bg-canvas-subtle px-2 py-1.5"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m7.875 14.25 1.214 1.942a2.25 2.25 0 0 0 1.908 1.058h2.006c.776 0 1.497-.4 1.908-1.058l1.214-1.942M2.41 9h4.636a2.25 2.25 0 0 1 1.872 1.002l.164.246a2.25 2.25 0 0 0 1.872 1.002h2.092a2.25 2.25 0 0 0 1.872-1.002l.164-.246A2.25 2.25 0 0 1 16.954 9h4.636M2.41 9a2.25 2.25 0 0 0-.16.832V12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 12V9.832c0-.287-.055-.57-.16-.832M2.41 9a2.25 2.25 0 0 1 .382-.632l3.285-3.832a2.25 2.25 0 0 1 1.708-.786h8.43c.657 0 1.281.287 1.709.786l3.284 3.832c.163.19.291.404.382.632M4.5 20.25h15A2.25 2.25 0 0 0 21.75 18v-2.625c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125V18a2.25 2.25 0 0 0 2.25 2.25Z"
            />
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
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Zm-3 6h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z"
            />
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
              const unavailable =
                opt.id === "cuda" && !devices.includes("cuda");
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