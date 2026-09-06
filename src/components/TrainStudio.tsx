"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Dropdown, { type DropdownOption } from "./Dropdown";
import {
  deleteTrainingDataset,
  fetchTrainingDatasets,
  fetchTrainingStatus,
  fetchTrainedModels,
  startTraining,
  stopTraining,
  updateTrainingTranscript,
  uploadTrainingDataset,
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

export default function TrainStudio() {
  const [datasets, setDatasets] = useState<TrainingDataset[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingTexts, setPendingTexts] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);

  const [editBuffer, setEditBuffer] = useState<
    Record<string, Record<string, string>>
  >({});
  const [savingFile, setSavingFile] = useState<string | null>(null);

  const [trainDatasetId, setTrainDatasetId] = useState("");
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
      setDatasets(await fetchTrainingDatasets());
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Gagal memuat dataset.",
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

  useEffect(() => {
    refreshDatasets();
    refreshTrained();
  }, [refreshDatasets, refreshTrained]);

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
      setActionError(err instanceof Error ? err.message : "Upload gagal.");
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
      setActionError(
        err instanceof Error ? err.message : "Gagal menyimpan transkrip.",
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
      setActionError(
        err instanceof Error ? err.message : "Gagal menghapus dataset.",
      );
    }
  };

  const handleStart = async () => {
    if (!trainDatasetId) {
      setActionError("Pilih dataset yang akan dilatih.");
      return;
    }
    setStarting(true);
    setActionError(null);
    try {
      const res = await startTraining({
        datasetId: trainDatasetId,
        name: modelName,
        steps,
        learningRate: lr,
        sampleText,
      });
      setSessionId(res.session_id);
      setStatus(null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Gagal memulai pelatihan.",
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
    [datasets]
  );

  return (
    <main className="w-full pb-12">
      <div className="mb-1 text-sm font-semibold">Fine-tune VITS</div>
      <div className="mb-4 text-xs text-ink-muted">
        Latih kembali model supaya bisa bicara bahasa Indonesia. Data berupa
        pasangan file audio + transkrip.
      </div>

      {(actionError || loadError) && (
        <div className="card mb-4 p-4 text-[13px] text-red-600">
          {actionError || loadError}
        </div>
      )}

      <div className="flex flex-col gap-5">
        <div className="flex gap-5">
          {/* 1. Upload dataset */}
          <section className="card p-5 w-full">
            <div className="card-header -m-5 mb-4">
              1. Upload dataset suara (audio + transkrip)
            </div>
            <div className="flex items-center gap-2.5">
              <input
                type="file"
                accept={AUDIO_ACCEPT}
                multiple
                onChange={(e) => handleFiles(e.target.files)}
                className="text-[13px]"
              />
            </div>
            <div className="mt-1.5 text-[11px] text-ink-muted">
              Pilih beberapa file audio (~ setiap klip 3–15 detik, satu kalimat)
              — transkripsi ditulis sendiri di bawah.
            </div>

            {pendingFiles.length > 0 && (
              <div className="mt-3.5 flex flex-col gap-2.5">
                {pendingFiles.map((f) => (
                  <div key={f.name} className="flex items-start gap-2.5">
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-ink-muted">
                        {f.name}
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
                        style={{ fontFamily: "inherit", marginTop: 4 }}
                      />
                    </div>
                    <button
                      className="btn"
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
                  </div>
                ))}
                <div>
                  <button
                    className="btn btn-primary"
                    disabled={uploading}
                    onClick={handleUpload}
                  >
                    {uploading ? "Mengunggah…" : "Simpan dataset"}
                  </button>
                </div>
              </div>
            )}
          </section>
          {/* 2. Dataset tersimpan */}
          <section className="card p-5 w-full">
            <div className="card-header -m-5 mb-4">2. Dataset tersimpan</div>
            {datasets === null && (
              <div className="text-[13px] text-ink-muted">Memuat…</div>
            )}
            {datasets && datasets.length === 0 && (
              <div className="text-[13px] text-ink-muted">
                Belum ada dataset. Upload dulu di bagian 1.
              </div>
            )}
            {datasets?.map((ds) => (
              <div
                key={ds.id}
                className="mb-3 rounded-md border border-edge p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="mono text-xs text-ink-muted">
                    {ds.id} · {ds.files.length} file
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="btn"
                      disabled={running}
                      onClick={() => {
                        setTrainDatasetId(ds.id);
                        setActionError(null);
                      }}
                    >
                      Latih dataset ini
                    </button>
                    <button
                      className="btn text-red-600"
                      onClick={() => handleDelete(ds.id)}
                    >
                      Hapus
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-col gap-2">
                  {ds.files.map((item) => (
                    <div key={item.file} className="flex items-start gap-2.5">
                      <textarea
                        rows={1}
                        value={editBuffer[ds.id]?.[item.file] ?? item.text}
                        onChange={(e) =>
                          setEditBuffer((prev) => ({
                            ...prev,
                            [ds.id]: {
                              ...prev[ds.id],
                              [item.file]: e.target.value,
                            },
                          }))
                        }
                        disabled={running}
                        className={areaCls}
                        style={{ fontFamily: "inherit", flex: 1 }}
                      />
                      <button
                        className="btn"
                        disabled={
                          savingFile === `${ds.id}:${item.file}` || running
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
            ))}
          </section>
        </div>

        {/* 3. Mulai pelatihan */}
        <section className="card p-5 w-full">
          <div className="card-header -m-5 mb-4">3. Mulai pelatihan</div>
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
                disabled={running}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Nama model</label>
                <input
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  disabled={running}
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
                  disabled={running}
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
                  disabled={running}
                  className={fieldCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Contoh kalimat model baru</label>
              <input
                value={sampleText}
                onChange={(e) => setSampleText(e.target.value)}
                disabled={running}
                placeholder="Halo, apa kabar teman-teman?"
                className={fieldCls}
              />
            </div>
            <div className="text-[11px] text-ink-muted">
              Berbasis checkpoint kafka (speaker suara asli dipertahankan).
              Pelatihan berjalan di background server (CPU); hasil muncul di
              halaman Voice Synthesis sebagai model baru.
            </div>
            <div>
              <button
                className="btn btn-primary"
                disabled={starting || running || !trainDatasetId}
                onClick={handleStart}
              >
                {starting
                  ? "Memulai…"
                  : running
                    ? "Sedang berjalan…"
                    : "Mulai latih"}
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
