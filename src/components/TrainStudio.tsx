"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Dropdown, { type DropdownOption } from "./Dropdown";
import { useDevice } from "../lib/deviceContext";
import { BACKEND_DOWN_HINT, isBackendDown } from "../lib/api";
import {
  deleteTrainingDataset,
  fetchBaseModels,
  fetchTrainingDatasets,
  fetchTrainingStatus,
  fetchTrainedModels,
  startTraining,
  stopTraining,
  updateTrainingTranscript,
  uploadTrainingDataset,
  type BaseModel,
  type TrainingDataset,
  type TrainedModel,
  type TrainingStatus,
} from "../lib/trainingApi";

const AUDIO_ACCEPT = ".wav,.mp3,.flac,.ogg,.m4a,.aac";

const fieldCls =
  "w-full rounded-md border border-edge bg-white px-2 py-1.5 text-[13px] placeholder:text-ink-subtle";
const areaCls =
  "w-full resize-y rounded-md border border-edge bg-white px-2 py-1.5 text-[13px] placeholder:text-ink-subtle";
const labelCls = "mb-1 block text-xs font-semibold text-ink-muted";

function fmtDuration(seconds?: number): string {
  if (seconds == null || !isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m <= 0) return `${s} dtk`;
  return `${m} mnt ${s} dtk`;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TrainStudio() {
  const { device } = useDevice();
  const [datasets, setDatasets] = useState<TrainingDataset[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backendDown, setBackendDown] = useState(false);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingTexts, setPendingTexts] = useState<Record<string, string>>({});
  const [pendingDrag, setPendingDrag] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [editBuffer, setEditBuffer] = useState<
    Record<string, Record<string, string>>
  >({});
  const [savingFile, setSavingFile] = useState<string | null>(null);

  const [trainDatasetId, setTrainDatasetId] = useState("");
  const [baseModels, setBaseModels] = useState<BaseModel[]>([]);
  const [baseModelId, setBaseModelId] = useState("");
  const [modelName, setModelName] = useState("");
  const [steps, setSteps] = useState(2000);
  const [lr, setLr] = useState(0.0002);
  const [sampleText, setSampleText] = useState("");
  const [starting, setStarting] = useState(false);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<TrainingStatus | null>(null);
  const [trainedModels, setTrainedModels] = useState<TrainedModel[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshDatasets = useCallback(async () => {
    try {
      const ds = await fetchTrainingDatasets();
      setDatasets(ds);
      setLoadError(null);
      setBackendDown(false);
    } catch (err) {
      const down = isBackendDown(err);
      setBackendDown(down);
      setLoadError(
        down
          ? BACKEND_DOWN_HINT
          : err instanceof Error
            ? err.message
            : "Gagal memuat dataset.",
      );
    }
  }, []);

  const refreshTrained = useCallback(async () => {
    try {
      setTrainedModels(await fetchTrainedModels());
    } catch {
      /* abaikan — hanya info tambahan */
    }
  }, []);

  const refreshBaseModels = useCallback(async () => {
    try {
      setBaseModels(await fetchBaseModels());
    } catch {
      /* abaikan — dropdown tetap bisa dipakai setelah server menyala */
    }
  }, []);

  useEffect(() => {
    refreshDatasets();
    refreshTrained();
    refreshBaseModels();
  }, [refreshDatasets, refreshTrained, refreshBaseModels]);

  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    const poll = async () => {
      if (!sessionId || !alive) return;
      try {
        const s = await fetchTrainingStatus(sessionId);
        if (!alive) return;
        setStatus(s);
        if (s.done) {
          setSessionId(null);
          refreshTrained();
        } else {
          window.setTimeout(poll, 2000);
        }
      } catch {
        if (alive) window.setTimeout(poll, 3000);
      }
    };
    poll();
    return () => {
      alive = false;
    };
  }, [sessionId, refreshTrained]);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    setPendingFiles((prev) => [...prev, ...Array.from(files)]);
  };

  const onDropPending = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setPendingDrag(false);
    const list = e.dataTransfer.files;
    if (list && list.length) handleFiles(list);
  }, []);

  const handleUpload = async () => {
    const missingText = pendingFiles.filter(
      (f) => !(pendingTexts[f.name] || "").trim(),
    );
    if (missingText.length > 0) {
      setActionError(
        `Transkrip untuk ${missingText.length} file masih kosong.`,
      );
      return;
    }
    if (pendingFiles.length === 0) {
      setActionError("Pilih file audio dulu.");
      return;
    }
    setUploading(true);
    setActionError(null);
    try {
      await uploadTrainingDataset(
        pendingFiles,
        pendingFiles.map((f) => ({
          file: f.name,
          text: pendingTexts[f.name] || "",
        })),
      );
      setPendingFiles([]);
      setPendingTexts({});
      await refreshDatasets();
    } catch (err) {
      const down = isBackendDown(err);
      if (down) setBackendDown(true);
      setActionError(
        down
          ? BACKEND_DOWN_HINT
          : err instanceof Error
            ? err.message
            : "Upload gagal.",
      );
    } finally {
      setUploading(false);
    }
  };

  const handleSaveEdit = async (datasetId: string, file: string) => {
    setSavingFile(`${datasetId}:${file}`);
    setActionError(null);
    try {
      await updateTrainingTranscript(
        datasetId,
        file,
        editBuffer[datasetId]?.[file] ?? "",
      );
      await refreshDatasets();
    } catch (err) {
      const down = isBackendDown(err);
      if (down) setBackendDown(true);
      setActionError(
        down
          ? BACKEND_DOWN_HINT
          : err instanceof Error
            ? err.message
            : "Gagal menyimpan transkrip.",
      );
    } finally {
      setSavingFile(null);
    }
  };

  const handleDelete = async (datasetId: string) => {
    if (!window.confirm("Hapus dataset ini? Audio & transkrip akan dihapus."))
      return;
    try {
      await deleteTrainingDataset(datasetId);
      if (trainDatasetId === datasetId) setTrainDatasetId("");
      await refreshDatasets();
    } catch (err) {
      const down = isBackendDown(err);
      if (down) setBackendDown(true);
      setActionError(
        down
          ? BACKEND_DOWN_HINT
          : err instanceof Error
            ? err.message
            : "Gagal menghapus dataset.",
      );
    }
  };

  const handleStart = async () => {
    if (!trainDatasetId) {
      setActionError("Pilih dataset yang akan dilatih.");
      return;
    }
    if (!baseModelId) {
      setActionError("Pilih model dasar yang akan di-tune.");
      return;
    }
    setStarting(true);
    setActionError(null);
    try {
      const res = await startTraining({
        datasetId: trainDatasetId,
        baseModel: baseModelId,
        name: modelName,
        steps,
        learningRate: lr,
        sampleText,
        device,
      });
      setSessionId(res.session_id);
      setStatus(null);
    } catch (err) {
      const down = isBackendDown(err);
      if (down) setBackendDown(true);
      setActionError(
        down
          ? BACKEND_DOWN_HINT
          : err instanceof Error
            ? err.message
            : "Gagal memulai pelatihan.",
      );
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      await stopTraining();
    } catch {
      /* status polling akan menampilkan error bila perlu */
    }
  };

  const running = !!status && !status.done;
  const controlsDisabled = backendDown;
  const progress =
    status && status.total
      ? Math.min(100, (status.step / status.total) * 100)
      : 0;

  const datasetOptions: DropdownOption[] = useMemo(
    () =>
      (datasets ?? []).map((ds) => ({
        id: ds.id,
        label: ds.id,
        right: (
          <span className="flex-shrink-0 text-[11px] text-ink-muted">
            {ds.files.length} file
          </span>
        ),
      })),
    [datasets],
  );

  const baseModelOptions: DropdownOption[] = useMemo(
    () =>
      baseModels.map((m) => ({
        id: m.id,
        label: m.name,
        right: (
          <span className="flex-shrink-0 text-[11px] text-ink-muted">
            {m.language}
          </span>
        ),
      })),
    [baseModels],
  );

  return (
    <main className="w-full pb-12">
      <div className="mb-1 text-sm font-semibold">Fine-tune VITS (ID)</div>
      <div className="mb-4 text-xs text-ink-muted">
        Latih kembali model supaya bisa bicara bahasa Indonesia. Data berupa
        pasangan file audio + transkrip.
      </div>

      {(actionError || loadError) && (
        <div className="rounded-md border border-edge bg-red-50 mb-4 px-4 py-3 text-[12px] text-red-600">
          {actionError || loadError}
        </div>
      )}

      <div className="flex flex-col gap-5">
        <div className="grid gap-5 lg:grid-cols-2">
          
          {/* 1. Upload dataset — dropzone ala Remover */}
          <section className="card flex flex-col p-5">
            <div className="card-header -m-5 mb-4">
              1. Upload Dataset Suara (audio + transkrip)
            </div>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setPendingDrag(true);
              }}
              onDragLeave={() => setPendingDrag(false)}
              onDrop={onDropPending}
              className="flex flex-col gap-3"
            >
              <label
                htmlFor="training-audio-file"
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-canvas-subtle px-4 py-7 text-center transition-colors hover:bg-canvas-inset ${pendingDrag ? "border-ink bg-canvas-inset" : "border-edge"}`}
              >
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#9ca3af"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
                  <path d="M19 10a7 7 0 0 1-14 0" />
                  <path d="M12 18v3M8 21h8" />
                </svg>
                <span className="text-xs font-medium text-ink">
                  {pendingFiles.length > 0
                    ? "Tambah atau jatuhkan file audio"
                    : "Pilih atau jatuhkan file audio"}
                </span>
                <span className="text-[11px] leading-relaxed text-ink-muted">
                  WAV / MP3 / FLAC / OGG — beberapa file, 3–15 dtk per klip —
                  drag &amp; drop didukung
                </span>
                {pendingFiles.length > 0 && (
                  <span className="rounded-full border border-edge bg-white px-2.5 py-1 text-[11px] font-medium text-ink">
                    {pendingFiles.length} file dipilih
                  </span>
                )}
              </label>
              <input
                id="training-audio-file"
                type="file"
                accept={AUDIO_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {pendingFiles.map((f) => (
                    <span
                      key={f.name}
                      className="inline-flex w-full items-center justify-between rounded-md border border-edge bg-white px-2.5 py-2 text-[11px] text-ink"
                    >
                      <div className="flex items-center gap-1.5">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          strokeWidth="1.5"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
                          />
                        </svg>

                        <span className="truncate">{f.name}</span>
                        <span className="shrink-0 text-ink-muted">
                          · {formatBytes(f.size)}
                        </span>
                      </div>

                      <button
                        className="rounded bg-red-600 w-20 px-2 py-0.5 font-medium text-white hover:bg-red-700 shrink-0"
                        onClick={() => {
                          setPendingFiles((prev) =>
                            prev.filter((x) => x.name !== f.name),
                          );
                          setPendingTexts((prev) => {
                            const next = { ...prev };
                            delete next[f.name];
                            return next;
                          });
                        }}
                      >
                        Hapus
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {pendingFiles.length > 0 ? (
              <div className="mt-4 flex flex-col gap-2.5">
                {pendingFiles.map((f) => (
                  <div
                    key={f.name}
                    className="flex items-start gap-2.5 rounded-md border border-edge bg-canvas-subtle p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-ink">
                          {f.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-muted">
                          {formatBytes(f.size)}
                        </span>
                      </div>
                      <textarea
                        rows={2}
                        placeholder="Transkrip bahasa Indonesia…"
                        value={pendingTexts[f.name] || ""}
                        onChange={(e) =>
                          setPendingTexts((prev) => ({
                            ...prev,
                            [f.name]: e.target.value,
                          }))
                        }
                        className={areaCls}
                        style={{ fontFamily: "inherit", marginTop: 6 }}
                      />
                    </div>
                  </div>
                ))}
                <button
                  className="btn btn-primary w-full"
                  disabled={uploading || controlsDisabled}
                  onClick={handleUpload}
                >
                  {uploading ? "Mengunggah…" : "Simpan dataset"}
                </button>
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-edge bg-canvas-subtle p-3 text-[11px] leading-relaxed text-ink-muted">
                Pilih beberapa file audio (~ setiap klip 3–15 detik, satu
                kalimat). Setiap file butuh transkrip bahasa Indonesia yang
                sesuai sebelum disimpan.
              </div>
            )}
          </section>

          {/* 2. Dataset tersimpan — rapi ala Remover card */}
          <section className="card flex flex-col p-5">
            <div className="card-header -m-5 mb-4">2. Dataset Tersimpan</div>
            {datasets === null && (
              <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-ink-muted">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent" />
                Memuat dataset…
              </div>
            )}
            {datasets && datasets.length === 0 && (
              <div className="flex flex-col h-full items-center justify-center gap-2 rounded-md border border-dashed border-edge bg-canvas-subtle px-4 py-8 text-center">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#9ca3af"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
                  <path d="M12 11v6M9 14h6" />
                </svg>
                <span className="text-xs font-medium text-ink">
                  Belum ada dataset
                </span>
                <span className="max-w-[260px] text-[11px] leading-relaxed text-ink-muted">
                  Upload beberapa klip audio + transkrip di langkah 1. Dataset
                  akan muncul di sini dan siap untuk fine-tune.
                </span>
              </div>
            )}
            {datasets && datasets.length > 0 && (
              <div className="flex flex-col gap-3">
                {datasets.map((ds) => {
                  const isActive = trainDatasetId === ds.id;
                  return (
                    <div
                      key={ds.id}
                      className={`overflow-hidden rounded-md border ${isActive ? "border-ink" : "border-edge"} bg-white`}
                    >
                      <div
                        className={`flex items-center justify-between gap-2 border-b px-3 py-2.5 ${isActive ? "border-ink bg-ink text-white" : "border-edge bg-canvas-subtle"}`}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] border text-[11px] font-bold ${isActive ? "border-white/20 bg-white/15 text-white" : "border-edge bg-white text-ink"}`}
                          >
                            DS
                          </span>
                          <span
                            className={`mono truncate text-xs font-medium ${isActive ? "text-white" : "text-ink"}`}
                            title={ds.id}
                          >
                            {ds.id}
                          </span>
                          <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${isActive ? "border-white/20 bg-white/15 text-white" : "border-edge bg-white text-ink-muted"}`}
                          >
                            {ds.files.length} file
                          </span>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            className={`btn text-xs ${isActive ? "border-white/20 bg-white text-ink hover:bg-white/90" : ""}`}
                            disabled={running || controlsDisabled}
                            onClick={() => {
                              setTrainDatasetId(ds.id);
                              setActionError(null);
                            }}
                          >
                            {isActive ? "Dipilih ✓" : "Latih dataset ini"}
                          </button>
                          <button
                            className={`btn text-xs ${isActive ? "border-white/20 text-white hover:bg-white/10" : "text-red-600"}`}
                            onClick={() => handleDelete(ds.id)}
                          >
                            Hapus
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 bg-canvas-subtle p-3">
                        {ds.files.map((item) => (
                          <div
                            key={item.file}
                            className="flex items-start gap-2.5 rounded-md border border-edge bg-white p-2.5"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="mb-1 truncate text-[11px] font-medium text-ink">
                                {item.file}
                              </div>
                              <textarea
                                rows={1}
                                value={
                                  editBuffer[ds.id]?.[item.file] ?? item.text
                                }
                                onChange={(e) =>
                                  setEditBuffer((prev) => ({
                                    ...prev,
                                    [ds.id]: {
                                      ...prev[ds.id],
                                      [item.file]: e.target.value,
                                    },
                                  }))
                                }
                                disabled={running || controlsDisabled}
                                placeholder="Transkrip…"
                                className={areaCls}
                                style={{ fontFamily: "inherit" }}
                              />
                            </div>
                            <button
                              className="btn shrink-0"
                              disabled={
                                savingFile === `${ds.id}:${item.file}` ||
                                running
                              }
                              onClick={() => handleSaveEdit(ds.id, item.file)}
                            >
                              {savingFile === `${ds.id}:${item.file}`
                                ? "Simpan…"
                                : "Simpan"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* 3. Mulai pelatihan */}
        <section className="card p-5 w-full">
          <div className="card-header -m-5 mb-4">3. Mulai Pelatihan</div>
          <div className="flex flex-col gap-3">
            <div>
              <Dropdown
                label="Dataset"
                value={trainDatasetId}
                options={datasetOptions}
                onChange={(id) => {
                  setTrainDatasetId(id);
                  setActionError(null);
                }}
                placeholder="Pilih dataset…"
                disabled={running || controlsDisabled}
              />
            </div>
            <div>
              <Dropdown
                label="Model dasar (yang di-tune)"
                value={baseModelId}
                options={baseModelOptions}
                onChange={(id) => {
                  setBaseModelId(id);
                  setActionError(null);
                }}
                placeholder="Pilih model…"
                disabled={running || controlsDisabled}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Nama model</label>
                <input
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  disabled={running || controlsDisabled}
                  placeholder="Model Indonesia"
                  className={fieldCls}
                />
              </div>
              <div>
                <label className={labelCls}>Jumlah step</label>
                <input
                  type="number"
                  min={50}
                  step={50}
                  value={steps}
                  onChange={(e) =>
                    setSteps(Math.max(50, Math.floor(Number(e.target.value))))
                  }
                  disabled={running || controlsDisabled}
                  className={fieldCls}
                />
                <div className="mt-0.5 text-[11px] text-ink-muted">
                  Rekomendasi ≥ 1000.
                </div>
              </div>
              <div>
                <label className={labelCls}>Learning rate</label>
                <input
                  type="number"
                  step={0.0001}
                  min={0.000001}
                  max={0.001}
                  value={lr}
                  onChange={(e) => setLr(Number(e.target.value))}
                  disabled={running || controlsDisabled}
                  className={fieldCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Contoh kalimat model baru</label>
              <input
                value={sampleText}
                onChange={(e) => setSampleText(e.target.value)}
                disabled={running || controlsDisabled}
                placeholder="Halo, apa kabar teman-teman?"
                className={fieldCls}
              />
            </div>
            <div className="text-[11px] text-ink-muted">
              Model dasar yang dipilih menentukan suara awal yang di-tune;
              speaker-nya dipertahankan. Pelatihan berjalan di background
              server; hasil muncul di halaman Voice Synthesis sebagai model
              baru.
            </div>
            <div>
              <button
                className="btn btn-primary w-40"
                disabled={
                  starting || running || !trainDatasetId || !baseModelId
                }
                onClick={handleStart}
              >
                {starting
                  ? "Memulai…"
                  : running
                    ? "Sedang Berjalan…"
                    : "Mulai Latih"}
              </button>
              {running && (
                <button className="btn ml-2 text-red-600" onClick={handleStop}>
                  Hentikan
                </button>
              )}
            </div>
          </div>
        </section>

        {/* 4. Status */}
        {status && (
          <section className="card p-5">
            <div className="card-header -m-5 mb-4">4. Status pelatihan</div>
            <div className="flex flex-col gap-2.5 text-[13px]">
              {status.status === "preparing" && <div>Menyiapkan dataset…</div>}
              {status.status === "training" && (
                <>
                  <div>
                    <div className="mono text-xs text-ink-muted">
                      step {status.step}/{status.total} · sisa ±
                      {fmtDuration(status.eta_seconds)} · {status.n_samples}{" "}
                      sampel
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded border border-edge bg-canvas-subtle">
                      <div
                        className="h-full bg-ink transition-[width] duration-300 ease-linear"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                  <div className="mono text-xs">
                    gen {status.loss_gen} · mel {status.loss_mel} · kl{" "}
                    {status.loss_kl} · dur {status.loss_dur} · disc{" "}
                    {status.loss_disc}
                  </div>
                </>
              )}
              {status.status === "done" && (
                <div className="text-green-700">
                  Selesai dalam {fmtDuration(status.elapsed)}. Model{" "}
                  <span className="mono">{status.model_id}</span> sudah aktif —
                  buka <a href="/voice">Voice Synthesis</a> untuk mencobanya.
                </div>
              )}
              {status.status === "cancelled" && (
                <div>Pelatihan dihentikan.</div>
              )}
              {status.status === "error" && (
                <div className="text-red-600">
                  Gagal: {status.error || "kesalahan tak dikenal"}
                </div>
              )}
              {status.last_checkpoint && (
                <div className="text-xs text-ink-muted">
                  {status.last_checkpoint}
                </div>
              )}
              {status.dataset_desc && (
                <div className="text-[11px] text-ink-muted">
                  {status.dataset_desc.map((d) => (
                    <div key={d}>{d}</div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* 5. Hasil */}
        {trainedModels.length > 0 && (
          <section className="card p-5">
            <div className="card-header -m-5 mb-4">
              5. Model hasil fine-tune
            </div>
            <div className="flex flex-col gap-2">
              {trainedModels.map((m) => (
                <div
                  key={m.model_id}
                  className="flex items-center gap-2.5 rounded-md border border-edge px-3 py-2.5"
                >
                  <div className="flex-1">
                    <div className="text-[13px] font-semibold">{m.name}</div>
                    <div className="mono text-[11px] text-ink-muted">
                      {m.model_id}
                    </div>
                  </div>
                  <div className="text-[11px] text-ink-muted">{m.language}</div>
                  <a href="/voice" className="text-xs">
                    Sintesis →
                  </a>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
