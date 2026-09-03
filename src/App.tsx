import { useCallback, useEffect, useRef, useState } from "react";
import Header from "./components/Header";
import UploadZone from "./components/UploadZone";
import ProgressOverlay from "./components/ProgressOverlay";
import Mixer from "./components/Mixer";
import TransportBar from "./components/TransportBar";
import Waveform from "./components/Waveform";
import { fetchJob, originalUrl, stemUrl, uploadTrack } from "./lib/api";
import { MultiStemPlayer } from "./lib/audioEngine";
import { computePeaks, type Peaks } from "./lib/peaks";
import { STEM_COLORS, STEM_LABELS, type JobState, type ModelId } from "./lib/types";

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

  const engineRef = useRef<MultiStemPlayer | null>(null);
  const rafRef = useRef<number>();

  const getEngine = useCallback(() => {
    if (!engineRef.current) engineRef.current = new MultiStemPlayer();
    return engineRef.current;
  }, []);

  // Poll job status while a separation is running.
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
          color: STEM_COLORS[name] ?? "var(--signal)",
          peaks: computePeaks(buffer, 400),
        };
      });

      // Master waveform: decode the original upload separately so it
      // reads as the "full picture" above the per-stem strips.
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
  }, []);

  // Drive the playhead while playing.
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
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <Header showReset={phase === "ready"} onReset={handleReset} />

      <div style={{ flex: 1, padding: "24px", maxWidth: 960, width: "100%", margin: "0 auto" }}>
        {phase === "idle" && <UploadZone onSubmit={handleUpload} disabled={false} />}

        {phase === "uploading" && <ProgressOverlay stage="Mengunggah file…" progress={5} />}

        {phase === "processing" && job && <ProgressOverlay stage={job.stage} progress={job.progress} />}

        {phase === "error" && (
          <div style={{ maxWidth: 480, margin: "64px auto", textAlign: "center" }}>
            <div style={{ color: "var(--peak)", fontWeight: 600, marginBottom: 8 }}>Terjadi kesalahan</div>
            <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>{errorMessage}</div>
            <button
              onClick={handleReset}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: "1px solid var(--border-hairline)",
                background: "var(--bg-panel)",
                color: "var(--text-primary)",
              }}
            >
              Coba lagi
            </button>
          </div>
        )}

        {phase === "ready" && (
          <>
            <TransportBar
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={duration}
              onPlayPause={handlePlayPause}
              onMasterVolume={(v) => getEngine().setMasterVolume(v)}
              onExport={handleExport}
            />

            {masterPeaks && (
              <div
                style={{
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border-hairline)",
                  borderRadius: 12,
                  padding: "14px 16px",
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Track asli</div>
                <Waveform
                  peaks={masterPeaks}
                  duration={duration}
                  currentTime={currentTime}
                  color="var(--text-muted)"
                  height={56}
                  onSeek={handleSeek}
                />
              </div>
            )}

            <Mixer
              stems={loadedStems}
              duration={duration}
              currentTime={currentTime}
              engine={getEngine()}
              onSeek={handleSeek}
            />
          </>
        )}
      </div>
    </div>
  );
}
