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
  const rafRef = useRef<number | undefined>(undefined);

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
      className={`grid grid-cols-[10px_1fr_90px] items-center gap-3.5 bg-white px-4 py-2.5 ${
        last ? "" : "border-b border-edge-soft"
      }`}
    >
      <div
        title={label}
        className="h-2 w-2 justify-self-center rounded-full"
        style={{ background: color }}
      />

      <div className="min-w-0">
        <div
          className="label mb-1.5 font-semibold"
          style={{
            background: `color-mix(in srgb, ${color} 14%, white)`,
            color,
            border: `1px solid color-mix(in srgb, ${color} 40%, white)`,
          }}
        >
          {label}
        </div>
        <Waveform peaks={peaks} duration={duration} currentTime={currentTime} color={color} height={36} onSeek={onSeek} />
      </div>

      <div className="flex items-center gap-2.5">
        <div className="relative flex h-9 w-1.5 items-end overflow-hidden rounded-[3px] border border-edge bg-canvas-inset">
          <div
            ref={meterRef}
            className="h-full w-full"
            style={{
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

        <div className="flex flex-col gap-1">
          <button
            onClick={() => {
              engine.toggleMute(name);
              setMuted(!muted);
            }}
            aria-pressed={muted}
            className={`h-5 w-6 rounded border text-[10px] font-bold ${
              muted
                ? "border-edge bg-red-100 text-red-600"
                : "border-edge bg-white text-ink-muted"
            }`}
          >
            M
          </button>
          <button
            onClick={() => {
              engine.toggleSolo(name);
              setSolo(!solo);
            }}
            aria-pressed={solo}
            className={`h-5 w-6 rounded border text-[10px] font-bold ${
              solo
                ? "border-edge bg-canvas-inset text-ink-muted"
                : "border-edge bg-white text-ink-muted"
            }`}
          >
            S
          </button>
        </div>
      </div>
    </div>
  );
}
