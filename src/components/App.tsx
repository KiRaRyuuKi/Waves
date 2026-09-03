"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Toolbar from "./Toolbar";
import UploadZone from "./UploadZone";
import ProgressOverlay from "./ProgressOverlay";
import Mixer from "./Mixer";
import TransportBar from "./TransportBar";
import Waveform from "./Waveform";
import { fetchJob, originalUrl, stemUrl, uploadTrack } from "../lib/api";
import { MultiStemPlayer } from "../lib/audioEngine";
import { computePeaks, type Peaks } from "../lib/peaks";
import { STEM_COLORS, STEM_LABELS, type JobState, type ModelId } from "../lib/types";

type Phase = "idle" | "uploading" | "processing" | "ready" | "error";

interface LoadedStem {
  name: string;
  label: string;
  color: string;
  peaks: Peaks;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [job, setJob] = useState<JobState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadedStems, setLoadedStems] = useState<LoadedStem[]>([]);
  const [masterPeaks, setMasterPeaks] = useState<Peaks | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const engineRef = useRef<MultiStemPlayer | null>(null);
  const rafRef = useRef<number>();

  const getEngine = useCallback(() => {
    if (!engineRef.current) engineRef.current = new MultiStemPlayer();
    return engineRef.current;
  }, []);

  useEffect(() => {
    if (phase !== "processing" || !job) return;
    const interval = setInterval(async () => {
      try {
        const updated = await fetchJob(job.id);
        setJob(updated);
        if (updated.status === "done") {
          clearInterval(interval);
          void loadStemsForJob(updated);
        } else if (updated.status === "error") {
          clearInterval(interval);
          setErrorMessage(updated.error || "Pemisahan gagal.");
          setPhase("error");
        }
      } catch (err) {
        clearInterval(interval);
        setErrorMessage(err instanceof Error ? err.message : "Gagal memeriksa status job.");
        setPhase("error");
      }
    }, 900);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, job?.id]);

  const loadStemsForJob = useCallback(
    async (finishedJob: JobState) => {
      const engine = getEngine();
      const stemInputs = finishedJob.stems.map((name) => ({ name, url: stemUrl(finishedJob.id, name) }));
      await engine.loadStems(stemInputs);

      const stems: LoadedStem[] = finishedJob.stems.map((name) => {
        const buffer = engine.getBuffer(name)!;
        return {
          name,
          label: STEM_LABELS[name] ?? name,
          color: STEM_COLORS[name] ?? "var(--accent-fg)",
          peaks: computePeaks(buffer, 400),
        };
      });

      try {
        const res = await fetch(originalUrl(finishedJob.id));
        const arrayBuffer = await res.arrayBuffer();
        const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const originalBuffer = await tempCtx.decodeAudioData(arrayBuffer);
        setMasterPeaks(computePeaks(originalBuffer, 600));
        tempCtx.close();
      } catch {
        setMasterPeaks(null);
      }

      setLoadedStems(stems);
      setDuration(engine.duration);
      setPhase("ready");
    },
    [getEngine]
  );

  const handleUpload = useCallback(async (file: File, model: ModelId) => {
    setPhase("uploading");
    setErrorMessage(null);
    setFileName(file.name);
    try {
      const { job_id } = await uploadTrack(file, model);
      setJob({ id: job_id, status: "queued", progress: 0, stage: "Mengunggah…", stems: [], error: null, model });
      setPhase("processing");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Upload gagal.");
      setPhase("error");
    }
  }, []);

  const handlePlayPause = useCallback(async () => {
    const engine = getEngine();
    if (engine.isPlaying) {
      engine.pause();
      setIsPlaying(false);
    } else {
      engine.onEnded(() => setIsPlaying(false));
      await engine.play();
      setIsPlaying(true);
    }
  }, [getEngine]);

  const handleSeek = useCallback(
    (time: number) => {
      getEngine().seek(time);
      setCurrentTime(time);
    },
    [getEngine]
  );

  const handleExport = useCallback(async () => {
    const blob = await getEngine().exportMix();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "custom-mix.wav";
    a.click();
    URL.revokeObjectURL(url);
  }, [getEngine]);

  const handleReset = useCallback(() => {
    engineRef.current?.destroy();
    engineRef.current = null;
    setPhase("idle");
    setJob(null);
    setLoadedStems([]);
    setMasterPeaks(null);
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setFileName(null);
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const tick = () => {
      const engine = engineRef.current;
      if (engine) setCurrentTime(engine.getCurrentTime());
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);

  return (
    <main style={{ maxWidth: 1012, margin: "0 auto", padding: "24px 16px 64px" }}>
      <Toolbar fileName={fileName} showReset={phase === "ready"} onReset={handleReset} />

      {phase === "idle" && <UploadZone onSubmit={handleUpload} disabled={false} />}

      {phase === "uploading" && (
        <div className="card" style={{ marginTop: 16 }}>
          <ProgressOverlay stage="Mengunggah file…" progress={5} />
        </div>
      )}

      {phase === "processing" && job && (
        <div className="card" style={{ marginTop: 16 }}>
          <ProgressOverlay stage={job.stage} progress={job.progress} />
        </div>
      )}

      {phase === "error" && (
        <div className="card" style={{ marginTop: 16, padding: "32px 24px", textAlign: "center" }}>
          <div style={{ color: "var(--danger-fg)", fontWeight: 600, marginBottom: 8 }}>Terjadi kesalahan</div>
          <div style={{ color: "var(--fg-muted)", fontSize: 13, marginBottom: 20 }}>{errorMessage}</div>
          <button className="btn" onClick={handleReset}>
            Coba lagi
          </button>
        </div>
      )}

      {phase === "ready" && (
        <>
          <div style={{ marginTop: 16 }}>
            <TransportBar
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={duration}
              onPlayPause={handlePlayPause}
              onMasterVolume={(v) => getEngine().setMasterVolume(v)}
              onExport={handleExport}
            />
          </div>

          {masterPeaks && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-header">Track asli</div>
              <div style={{ padding: "12px 16px" }}>
                <Waveform
                  peaks={masterPeaks}
                  duration={duration}
                  currentTime={currentTime}
                  color="var(--fg-muted)"
                  height={56}
                  onSeek={handleSeek}
                />
              </div>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <Mixer
              stems={loadedStems}
              duration={duration}
              currentTime={currentTime}
              engine={getEngine()}
              onSeek={handleSeek}
            />
          </div>
        </>
      )}
    </main>
  );
}
