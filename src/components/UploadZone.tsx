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
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ padding: 24 }}>
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
          style={{
            border: `2px dashed ${dragging ? "var(--accent-emphasis)" : "var(--border-default)"}`,
            borderRadius: "var(--radius)",
            padding: "48px 24px",
            textAlign: "center",
            cursor: disabled ? "default" : "pointer",
            background: dragging ? "var(--accent-subtle)" : "var(--canvas-subtle)",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <svg width="32" height="32" viewBox="0 0 16 16" fill="var(--fg-subtle)" style={{ marginBottom: 8 }}>
            <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z" />
            <path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.97a.75.75 0 1 1 1.06 1.061l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 6.78a.75.75 0 1 1 1.06-1.06Z" />
          </svg>
          <div style={{ fontSize: 15, color: "var(--fg-default)", fontWeight: 600 }}>
            Jatuhkan file audio di sini
          </div>
          <div style={{ fontSize: 13, color: "var(--fg-muted)", marginTop: 4 }}>
            atau <span style={{ color: "var(--accent-fg)" }}>klik untuk memilih file</span> — MP3, WAV, FLAC, M4A
          </div>
          <input ref={inputRef} type="file" accept="audio/*" hidden onChange={(e) => handleFiles(e.target.files)} />
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-muted)", marginBottom: 8 }}>
            Model pemisahan
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {MODEL_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setModel(opt.id);
                }}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: "var(--radius)",
                  border: `1px solid ${model === opt.id ? "var(--accent-emphasis)" : "var(--border-default)"}`,
                  background: model === opt.id ? "var(--accent-subtle)" : "var(--canvas-default)",
                  color: "var(--fg-default)",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 3, lineHeight: 1.4 }}>
                  {opt.description}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
