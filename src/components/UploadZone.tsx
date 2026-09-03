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
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px" }}>
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
          border: `1.5px dashed ${dragging ? "var(--signal)" : "var(--border-hairline)"}`,
          borderRadius: 12,
          padding: "56px 24px",
          textAlign: "center",
          cursor: disabled ? "default" : "pointer",
          background: dragging ? "rgba(18,224,179,0.05)" : "var(--bg-panel)",
          transition: "border-color 120ms ease, background 120ms ease",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <div style={{ fontSize: 15, color: "var(--text-primary)", fontWeight: 500 }}>
          Jatuhkan file audio di sini
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>
          atau klik untuk memilih — MP3, WAV, FLAC, M4A
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.2 }}>
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
                borderRadius: 8,
                border: `1px solid ${model === opt.id ? "var(--signal)" : "var(--border-hairline)"}`,
                background: model === opt.id ? "rgba(18,224,179,0.08)" : "var(--bg-panel-raised)",
                color: "var(--text-primary)",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>
                {opt.description}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
