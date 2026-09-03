"use client";

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
  last: boolean;
}

export default function ChannelStrip({ name, label, color, peaks, duration, currentTime, engine, onSeek, last }: Props) {
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
        gridTemplateColumns: "20px 1fr 150px",
        alignItems: "center",
        gap: 14,
        padding: "10px 16px",
        borderBottom: last ? "none" : "1px solid var(--border-muted)",
        background: "var(--canvas-default)",
      }}
    >
      <div
        title={label}
        style={{ width: 8, height: 8, borderRadius: "50%", background: color, justifySelf: "center" }}
      />

      <div style={{ minWidth: 0 }}>
        <div
          className="label"
          style={{
            background: `color-mix(in srgb, ${color} 14%, white)`,
            color,
            border: `1px solid color-mix(in srgb, ${color} 40%, white)`,
            marginBottom: 6,
            fontWeight: 600,
          }}
        >
          {label}
        </div>
        <Waveform peaks={peaks} duration={duration} currentTime={currentTime} color={color} height={36} onSeek={onSeek} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 6,
            height: 36,
            borderRadius: 3,
            background: "var(--canvas-inset)",
            border: "1px solid var(--border-default)",
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
            width: 18,
            height: 50,
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
              width: 24,
              height: 20,
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 4,
              border: "1px solid var(--border-default)",
              background: muted ? "var(--danger-subtle)" : "var(--canvas-default)",
              color: muted ? "var(--danger-fg)" : "var(--fg-muted)",
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
              width: 24,
              height: 20,
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 4,
              border: "1px solid var(--border-default)",
              background: solo ? "var(--accent-subtle)" : "var(--canvas-default)",
              color: solo ? "var(--accent-fg)" : "var(--fg-muted)",
            }}
          >
            S
          </button>
        </div>
      </div>
    </div>
  );
}
