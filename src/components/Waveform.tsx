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

      // Dim the unplayed portion instead of drawing a bright line —
      // reads as "progress" rather than a stray cursor.
      ctx.fillStyle = "rgba(16, 19, 26, 0.55)";
      ctx.fillRect(overlayWidth, 0, width - overlayWidth, height);

      ctx.fillStyle = "rgba(237, 234, 226, 0.9)";
      ctx.fillRect(overlayWidth - 1, 0, 1.5, height);
    }
  }, [peaks, duration, currentTime, color, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height, display: "block", cursor: onSeek ? "pointer" : "default" }}
      onClick={(e) => {
        if (!onSeek) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const fraction = (e.clientX - rect.left) / rect.width;
        onSeek(fraction * duration);
      }}
    />
  );
}
