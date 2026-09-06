"use client";

import { useEffect, useRef } from "react";
import type { Peaks } from "../lib/peaks";

interface Props {
  peaks: Peaks;
  duration: number;
  currentTime: number;
  color: string;
  height?: number;
  onSeek?: (time: number) => void;
}

export default function Waveform({ peaks, duration, currentTime, color, height = 64, onSeek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const mid = height / 2;
    const buckets = peaks.min.length;
    const barWidth = width / buckets;

    ctx.fillStyle = color;
    for (let i = 0; i < buckets; i++) {
      const x = i * barWidth;
      const yMax = mid - peaks.max[i] * mid;
      const yMin = mid - peaks.min[i] * mid;
      const barHeight = Math.max(1, yMin - yMax);
      ctx.fillRect(x, yMax, Math.max(1, barWidth - 0.5), barHeight);
    }

    if (duration > 0) {
      const playedFraction = Math.min(1, currentTime / duration);
      const overlayWidth = playedFraction * width;

      // Fade the *unplayed* portion toward white — reads as "progress"
      // against the light canvas instead of a stray cursor line.
      ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
      ctx.fillRect(overlayWidth, 0, width - overlayWidth, height);

      ctx.fillStyle = "rgba(9, 105, 218, 0.9)";
      ctx.fillRect(overlayWidth - 1, 0, 1.5, height);
    }
  }, [peaks, duration, currentTime, color, height]);

  return (
    <canvas
      ref={canvasRef}
      className={`block w-full ${onSeek ? "cursor-pointer" : "cursor-default"}`}
      style={{ height }}
      onClick={(e) => {
        if (!onSeek) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const fraction = (e.clientX - rect.left) / rect.width;
        onSeek(fraction * duration);
      }}
    />
  );
}
