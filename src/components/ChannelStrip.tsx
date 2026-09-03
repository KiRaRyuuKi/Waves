import { useEffect, useRef, useState } from "react";
import type { MultiStemPlayer } from "../lib/audioEngine";
import type { Peaks } from "../lib/peaks";
import Waveform from "./Waveform";

interface Props {
  name: string;
  label: string;
  color: string;
  peaks: Peaks;
  duration: number;
  currentTime: number;
  engine: MultiStemPlayer;
  onSeek: (time: number) => void;
}

export default function ChannelStrip({ name, label, color, peaks, duration, currentTime, engine, onSeek }: Props) {
  const initial = engine.getChannelState(name) ?? { volume: 1, muted: false, solo: false };
  const [volume, setVolume] = useState(initial.volume);
  const [muted, setMuted] = useState(initial.muted);
  const [solo, setSolo] = useState(initial.solo);
  const meterRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>();

  useEffect(() => {
    const tick = () => {
      const level = engine.getMeterLevel(name);
      if (meterRef.current) {
        meterRef.current.style.transform = `scaleY(${Math.min(1, level * 1.8)})`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [engine, name]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "28px 1fr 140px",
        alignItems: "center",
        gap: 14,
        padding: "10px 16px",
        borderBottom: "1px solid var(--border-hairline)",
      }}
    >
      <div
        title={label}
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: color,
          justifySelf: "center",
        }}
      />

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--text-primary)" }}>
          {label}
        </div>
        <Waveform peaks={peaks} duration={duration} currentTime={currentTime} color={color} height={40} onSeek={onSeek} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 6,
            height: 40,
            borderRadius: 3,
            background: "var(--bg-panel-raised)",
            border: "1px solid var(--border-hairline)",
            position: "relative",
            overflow: "hidden",
            display: "flex",
            alignItems: "flex-end",
          }}
        >
          <div
            ref={meterRef}
            style={{
              width: "100%",
              height: "100%",
              background: color,
              transform: "scaleY(0)",
              transformOrigin: "bottom",
              transition: "transform 60ms linear",
            }}
          />
        </div>

        <input
          type="range"
          min={0}
          max={1.2}
          step={0.01}
          value={volume}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setVolume(v);
            engine.setVolume(name, v);
          }}
          style={{
            writingMode: "vertical-lr" as any,
            direction: "rtl" as any,
            width: 20,
            height: 56,
            accentColor: color,
          }}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <button
            onClick={() => {
              engine.toggleMute(name);
              setMuted(!muted);
            }}
            aria-pressed={muted}
            style={{
              width: 26,
              height: 22,
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 5,
              border: "1px solid var(--border-hairline)",
              background: muted ? "var(--peak)" : "var(--bg-panel-raised)",
              color: muted ? "#1a0000" : "var(--text-muted)",
            }}
          >
            M
          </button>
          <button
            onClick={() => {
              engine.toggleSolo(name);
              setSolo(!solo);
            }}
            aria-pressed={solo}
            style={{
              width: 26,
              height: 22,
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 5,
              border: "1px solid var(--border-hairline)",
              background: solo ? "var(--signal)" : "var(--bg-panel-raised)",
              color: solo ? "#00281f" : "var(--text-muted)",
            }}
          >
            S
          </button>
        </div>
      </div>
    </div>
  );
}
