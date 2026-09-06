"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Toolbar from "./Toolbar";
import UploadZone from "./UploadZone";
import ProgressOverlay from "./ProgressOverlay";
import Mixer from "./Mixer";
import TransportBar from "./TransportBar";
import Waveform from "./Waveform";
import RecentUploads from "./RecentUploads";
import { deleteJob, fetchJob, listRecentJobs, originalUrl, retryJob, stemUrl, uploadTrack } from "../lib/api";
import { MultiStemPlayer } from "../lib/audioEngine";
import { computePeaks, type Peaks } from "../lib/peaks";
import { STEM_COLORS, STEM_LABELS, type JobState, type ModelId, type RecentJob } from "../lib/types";

type Phase = "idle" | "uploading" | "processing" | "ready" | "error";

const STORAGE_KEY = "waves-job";

interface SavedJob {
  job: JobState;
  fileName: string | null;
}

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
  const [isRestoring, setIsRestoring] = useState(false);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);

  const engineRef = useRef<MultiStemPlayer | null>(null);
  const rafRef = useRef<number | undefined>(undefined);

  const refreshRecent = useCallback(async () => {
    try {
      setRecentJobs(await listRecentJobs());
    } catch {
      setRecentJobs([]);
    }
  }, []);

  useEffect(() => {
    void refreshRecent();
  }, [refreshRecent]);

  useEffect(() => {
    if (phase === "idle" || phase === "uploading") {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      return;
    }
    if (!job?.id) return;
    const saved: SavedJob = { job, fileName };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, job, fileName]);

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
      setIsPlaying(false);
      setCurrentTime(0);
      engineRef.current?.destroy();
      engineRef.current = null;
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

  const applyJob = useCallback(
    async (fresh: JobState) => {
      setJob(fresh);
      if (fresh.status === "done") {
        await loadStemsForJob(fresh);
      } else if (fresh.status === "error") {
        setErrorMessage(fresh.error || "Pemisahan gagal.");
        setPhase("error");
      } else {
        setPhase("processing");
      }
    },
    [loadStemsForJob]
  );

  const openRecentJob = useCallback(
    async (recent: RecentJob) => {
      setErrorMessage(null);
      setFileName(recent.filename);
      try {
        const fresh = await fetchJob(recent.id);
        await applyJob(fresh);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Job tidak dapat diakses.");
        setPhase("error");
      }
    },
    [applyJob]
  );

  useEffect(() => {
    let cancelled = false;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {}
    if (!raw) return;

    let saved: SavedJob;
    try {
      saved = JSON.parse(raw);
    } catch {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      return;
    }
    if (!saved?.job?.id) return;

    setIsRestoring(true);
    setFileName(saved.fileName ?? null);
    let resolved = false;

    (async () => {
      try {
        const fresh = await fetchJob(saved.job.id);
        if (cancelled) return;
        resolved = true;
        await applyJob(fresh);
      } catch {
        if (!cancelled) {
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch {}
          setJob(null);
          setPhase("idle");
        }
      } finally {
        if (!cancelled) setIsRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
      // If the job request resolved but effects tore down before stems
      // finished loading, still clear the restoring flag so the UI
      // doesn't get stuck.
      if (resolved) setIsRestoring(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyJob]);

  const handleUpload = useCallback(
    async (file: File, model: ModelId) => {
      setPhase("uploading");
      setErrorMessage(null);
      setFileName(file.name);
      try {
        const { job_id } = await uploadTrack(file, model);
        setJob({
          id: job_id,
          status: "queued",
          progress: 0,
          stage: "Mengunggah…",
          stems: [],
          error: null,
          model,
          filename: file.name,
        });
        setPhase("processing");
        void refreshRecent();
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Upload gagal.");
        setPhase("error");
      }
    },
    [refreshRecent]
  );

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

  const handleRetry = useCallback(async () => {
    if (!job?.id) return;
    setErrorMessage(null);
    try {
      const res = await retryJob(job.id);
      setJob({
        ...job,
        id: res.job_id,
        status: "queued",
        progress: 0,
        stage: "Waiting to start",
        stems: [],
        error: null,
      });
      setPhase("processing");
      void refreshRecent();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Gagal mengulang pemisahan.");
    }
  }, [job, refreshRecent]);

  const handleDeleteJob = useCallback(
    async (recent: RecentJob) => {
      if (
        !window.confirm(
          "Hapus unggahan ini? File asli, hasil pemisahan, dan riwayatnya akan dihapus dari disk.",
        )
      ) {
        return;
      }
      try {
        await deleteJob(recent.id);
        setRecentJobs((prev) => prev.filter((j) => j.id !== recent.id));
        if (job?.id === recent.id) {
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
        }
        void refreshRecent();
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Gagal menghapus.");
        setPhase("error");
      }
    },
    [job?.id, refreshRecent],
  );

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
    void refreshRecent();
  }, [refreshRecent]);

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
    <main className="w-full pb-12">
      <Toolbar fileName={fileName} showReset={phase === "ready"} onReset={handleReset} />

      {phase === "idle" && !isRestoring && <UploadZone onSubmit={handleUpload} disabled={false} />}

      {phase === "idle" && !isRestoring && (
        <RecentUploads jobs={recentJobs} onOpen={openRecentJob} onDelete={handleDeleteJob} />
      )}

      {phase === "idle" && isRestoring && (
        <div className="card mt-4">
          <ProgressOverlay stage="Memulihkan sesi terakhir…" progress={10} />
        </div>
      )}

      {phase === "uploading" && (
        <div className="card mt-4">
          <ProgressOverlay stage="Mengunggah file…" progress={5} />
        </div>
      )}

      {phase === "processing" && job && (
        <div className="card mt-4">
          <ProgressOverlay stage={job.stage} progress={job.progress} />
        </div>
      )}

      {phase === "error" && (
        <div className="card mt-4 p-8 text-center">
          <div className="mb-2 font-semibold text-red-600">Terjadi kesalahan</div>
          <div className="mx-auto mb-5 max-w-md break-words text-[13px] text-ink-muted">{errorMessage}</div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button className="btn btn-primary" onClick={handleRetry} disabled={!job?.id}>
              Coba ulang pemisahan
            </button>
            <button className="btn" onClick={handleReset}>
              Track baru
            </button>
          </div>
        </div>
      )}

      {phase === "ready" && (
        <>
          <div className="mt-4">
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
            <div className="card mt-4">
              <div className="card-header">Track asli</div>
              <div className="px-4 py-3">
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

          <div className="mt-4">
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
