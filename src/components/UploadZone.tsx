"use client";

import { useCallback, useRef, useState } from "react";
import { MODEL_OPTIONS, type ModelId } from "../lib/types";

interface Props {
  onSubmit: (file: File, model: ModelId) => void;
  disabled: boolean;
}

export default function UploadZone({ onSubmit, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const [model, setModel] = useState<ModelId>("htdemucs");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onSubmit(file, model);
    },
    [onSubmit, model]
  );

  return (
    <div className="card mt-4">
      <div className="p-6">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!disabled) handleFiles(e.dataTransfer.files);
          }}
          onClick={() => !disabled && inputRef.current?.click()}
          className={`rounded-md border-2 border-dashed p-12 text-center ${
            disabled ? "cursor-default opacity-60" : "cursor-pointer"
          } ${dragging ? "border-ink bg-canvas-inset" : "border-edge bg-canvas-subtle"}`}
        >
          <svg width="32" height="32" viewBox="0 0 16 16" fill="var(--fg-subtle)" className="mb-2 mx-auto">
            <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z" />
            <path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.97a.75.75 0 1 1 1.06 1.061l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 6.78a.75.75 0 1 1 1.06-1.06Z" />
          </svg>
          <div className="text-[15px] font-semibold text-ink">Jatuhkan file audio di sini</div>
          <div className="mt-1 text-[13px] text-ink-muted">
            atau <span className="text-ink">klik untuk memilih file</span> — MP3, WAV, FLAC, M4A
          </div>
          <input ref={inputRef} type="file" accept="audio/*" hidden onChange={(e) => handleFiles(e.target.files)} />
        </div>

        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold text-ink-muted">Model pemisahan</div>
          <div className="grid grid-cols-3 gap-2">
            {MODEL_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setModel(opt.id);
                }}
                className={`rounded-md border px-3 py-2.5 text-left transition-colors ${
                  model === opt.id
                    ? "border-ink bg-canvas-inset"
                    : "border-edge bg-white hover:bg-canvas-subtle"
                }`}
                style={{ color: "var(--fg-default)" }}
              >
                <div className="text-[13px] font-semibold">{opt.label}</div>
                <div className="mt-[3px] text-[11px] leading-[1.4] text-ink-muted">{opt.description}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}