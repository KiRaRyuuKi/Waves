"use client";

import { useState } from "react";

interface Props {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onMasterVolume: (value: number) => void;
  onExport: () => Promise<void>;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function TransportBar({ isPlaying, currentTime, duration, onPlayPause, onMasterVolume, onExport }: Props) {
  const [exporting, setExporting] = useState(false);

  return (
    <div className="card" style={{ display: "flex", alignItems: "center", gap: 20, padding: "12px 16px" }}>
      <button
        onClick={onPlayPause}
        aria-label={isPlaying ? "Pause" : "Play"}
        className="btn btn-primary"
        style={{ width: 36, height: 36, borderRadius: "50%", padding: 0 }}
      >
        {isPlaying ? (
          <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor">
            <rect x="1" y="0" width="4" height="14" rx="1" />
            <rect x="9" y="0" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor">
            <path d="M1 0.5 L13 7 L1 13.5 Z" />
          </svg>
        )}
      </button>

      <div className="mono" style={{ fontSize: 13, color: "var(--fg-default)", minWidth: 92 }}>
        {formatTime(currentTime)} <span style={{ color: "var(--fg-muted)" }}>/ {formatTime(duration)}</span>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>Master</span>
        <input
          type="range"
          min={0}
          max={1.2}
          step={0.01}
          defaultValue={1}
          onChange={(e) => onMasterVolume(parseFloat(e.target.value))}
          style={{ width: 100, accentColor: "var(--accent-emphasis)" }}
        />
      </div>

      <button
        className="btn"
        disabled={exporting}
        onClick={async () => {
          setExporting(true);
          try {
            await onExport();
          } finally {
            setExporting(false);
          }
        }}
      >
        {exporting ? "Merender…" : "Export mix (.wav)"}
      </button>
    </div>
  );
}
