"use client";

import { useEffect, useRef, useState } from "react";
import { DEVICE_OPTIONS, DEVICE_LABELS, type DeviceId } from "../lib/deviceApi";
import { useDevice } from "../lib/deviceContext";

export default function DeviceSelect() {
  const { device, setDevice, devices } = useDevice();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
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
  );
}