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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "14px 18px",
        background: "var(--bg-panel-raised)",
        border: "1px solid var(--border-hairline)",
        borderRadius: 12,
        marginBottom: 16,
      }}
    >
      <button
        onClick={onPlayPause}
        aria-label={isPlaying ? "Pause" : "Play"}
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "none",
          background: "var(--signal)",
          color: "#00251c",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <rect x="1" y="0" width="4" height="14" rx="1" />
            <rect x="9" y="0" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M1 0.5 L13 7 L1 13.5 Z" />
          </svg>
        )}
      </button>

      <div className="mono" style={{ fontSize: 13, color: "var(--text-primary)", minWidth: 92 }}>
        {formatTime(currentTime)} <span style={{ color: "var(--text-muted)" }}>/ {formatTime(duration)}</span>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Master</span>
        <input
          type="range"
          min={0}
          max={1.2}
          step={0.01}
          defaultValue={1}
          onChange={(e) => onMasterVolume(parseFloat(e.target.value))}
          style={{ width: 100, accentColor: "var(--signal)" }}
        />
      </div>

      <button
        disabled={exporting}
        onClick={async () => {
          setExporting(true);
          try {
            await onExport();
          } finally {
            setExporting(false);
          }
        }}
        style={{
          padding: "9px 14px",
          fontSize: 12,
          fontWeight: 600,
          borderRadius: 8,
          border: "1px solid var(--border-hairline)",
          background: "transparent",
          color: "var(--text-primary)",
          opacity: exporting ? 0.6 : 1,
        }}
      >
        {exporting ? "Merender…" : "Export mix (.wav)"}
      </button>
    </div>
  );
}
