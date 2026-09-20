"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchVideoModels,
  generateVideo,
  sdCoverUrlForVideoBase,
  type VideoModelInfo,
} from "../lib/videoApi";
import Dropdown, { type DropdownOption } from "./Dropdown";
import { useDevice } from "../lib/deviceContext";
import { BACKEND_DOWN_HINT, isBackendDown } from "../lib/api";

interface Resolution {
  label: string;
  w: number;
  h: number;
}

const RESOLUTIONS: Record<string, Resolution[]> = {
  animatediff: [
    { label: "512 × 512", w: 512, h: 512 },
    { label: "512 × 768 (potret)", w: 512, h: 768 },
    { label: "768 × 512 (landskap)", w: 768, h: 512 },
  ],
  wan: [
    { label: "832 × 480", w: 832, h: 480 },
    { label: "480 × 832 (potret)", w: 480, h: 832 },
    { label: "480 × 480", w: 480, h: 480 },
  ],
};

const FRAMES: Record<string, number[]> = {
  animatediff: [16, 24],
  wan: [17, 33, 49, 81],
};

const FPS: Record<string, number[]> = {
  animatediff: [8, 12, 16],
  wan: [16],
};

export default function VideoStudio() {
  const [models, setModels] = useState<VideoModelInfo[] | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backendDown, setBackendDown] = useState(false);

  const [modelId, setModelId] = useState("animatediff");
  const [baseId, setBaseId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [steps, setSteps] = useState(20);
  const [guidanceScale, setGuidanceScale] = useState(6);
  const [resolutionIdx, setResolutionIdx] = useState(0);
  const [numFrames, setNumFrames] = useState(16);
  const [fps, setFps] = useState(8);
  const [seedText, setSeedText] = useState("");
  const { device } = useDevice();

  // txt2vid / img2vid — sama seperti Image Generation
  const [mode, setMode] = useState<"txt2vid" | "img2vid">("txt2vid");
  const [initFile, setInitFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [strength, setStrength] = useState(0.6);

  const [generating, setGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultMeta, setResultMeta] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const loadModels = () => {
    fetchVideoModels()
      .then((list) => {
        setModels(list);
        if (list.length && !list.some((m) => m.id === modelId)) {
          setModelId(list[0].id);
        }
      })
      .catch((err) => {
        const down = isBackendDown(err);
        setBackendDown(down);
        setLoadError(
          down
            ? BACKEND_DOWN_HINT
            : err instanceof Error
              ? err.message
              : "Gagal memuat daftar model video."
        );
      });
  };

  useEffect(() => {
    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedModel = models?.find((m) => m.id === modelId) ?? null;
  const kind = selectedModel?.kind ?? "animatediff";
  const resolutions = RESOLUTIONS[kind] ?? RESOLUTIONS.animatediff;
  const frameOptions = FRAMES[kind] ?? FRAMES.animatediff;
  const fpsOptions = FPS[kind] ?? FPS.animatediff;

  // Reset opsi spesifik-model saat tipe model berubah.
  useEffect(() => {
    setResolutionIdx(0);
    setNumFrames(FRAMES[kind]?.[0] ?? 16);
    setFps(FPS[kind]?.[0] ?? 8);
  }, [modelId, kind]);

  useEffect(() => {
    if (kind === "animatediff" && selectedModel?.bases.length) {
      // default ke model dasar pertama; tetap bisa pilih "Tanpa model dasar" manual
      setBaseId((prev) => {
        if (prev && selectedModel.bases.some((b) => b.id === prev)) return prev;
        // jangan override kalau user sudah pilih kosong ("") secara sengaja setelah init
        if (prev === "") return prev;
        return selectedModel.bases[0].id;
      });
    }
    if (kind === "wan") {
      setBaseId("");
    }
  }, [kind, selectedModel]);

  const noModels = models !== null && models.length === 0;
  const notInstalled = selectedModel !== null && !selectedModel.installed;
  const noBases = kind === "animatediff" && (selectedModel?.bases.length ?? 0) === 0;
  // Dropdown tetap aktif biar bisa dipilih dan lihat keterangan "Unduh dulu"
  // — hanya backendDown atau tidak ada model sama sekali yang disable dropdown.
  const modelDropdownDisabled = backendDown || noModels;

  const modelOptions: DropdownOption[] = useMemo(
    () =>
      (models ?? []).map((m) => ({
        id: m.id,
        label: m.name,
        icon: (
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[5px] bg-canvas-subtle text-[11px]">
            {m.kind === "wan" ? "W" : "A"}
          </span>
        ),
        right: m.installed ? (
          <span className="max-w-32 flex-shrink-0 truncate text-[11px] text-emerald-600">Terpasang</span>
        ) : (
          <span className="max-w-32 flex-shrink-0 truncate text-[11px] text-amber-600">Belum terpasang</span>
        ),
      })),
    [models]
  );

  const baseOptions: DropdownOption[] = useMemo(() => {
    const opts: DropdownOption[] = (selectedModel?.bases ?? []).map((b) => ({
      id: b.id,
      label: b.name,
      icon: b.has_cover ? (
        <img
          src={sdCoverUrlForVideoBase(b.id)}
          alt=""
          width={28}
          height={28}
          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          className="flex-shrink-0 rounded-[5px] object-cover"
        />
      ) : (
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[5px] bg-canvas-subtle text-[11px] font-medium">
          {b.name.trim().charAt(0).toUpperCase() || "•"}
        </span>
      ),
      right: b.description ? (
        <span className="max-w-40 flex-shrink-0 truncate text-[11px] text-ink-muted">
          {b.description}
        </span>
      ) : undefined,
    }));
    // Opsi "Tanpa model dasar" — muncul selalu di atas, untuk Wan atau kalau mau txt2vid tanpa SD
    opts.unshift({
      id: "",
      label: "— Tanpa Model Dasar —",
      icon: (
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[5px] bg-canvas-subtle text-[11px] font-medium">
          x
        </span>
      ),
      right: (
        <span className="max-w-40 flex-shrink-0 truncate text-[11px] text-ink-muted">
          {kind === "wan" ? "Wan mandiri" : "Coba tanpa SD 1.5"}
        </span>
      ),
    });
    return opts;
  }, [selectedModel, kind]);

  const parseSeed = (): number | null => {
    const t = seedText.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isInteger(n) && n >= 0 && n <= 2 ** 32 - 1 ? n : null;
  };

  const handlePickInit = (file: File | undefined) => {
    setInitError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setInitError("File harus berupa gambar (PNG/JPG/WebP).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setInitFile({ name: file.name, dataUrl: String(reader.result) });
    reader.onerror = () => setInitError("Gagal membaca file.");
    reader.readAsDataURL(file);
  };

  const handleGenerate = async () => {
    if (!selectedModel || !prompt.trim()) return;
    if (mode === "img2vid" && !initFile) return;
    setGenerating(true);
    setGenError(null);
    setResultUrl(null);
    setResultMeta(null);
    const res = resolutions[resolutionIdx] ?? resolutions[0];
    try {
      const out = await generateVideo({
        modelId,
        baseId: kind === "animatediff" ? baseId : undefined,
        prompt,
        negativePrompt,
        steps,
        guidanceScale,
        width: res.w,
        height: res.h,
        numFrames,
        fps,
        seed: parseSeed(),
        device,
        initImage: mode === "img2vid" ? initFile?.dataUrl : undefined,
        strength,
      });
      const url = (out as any).video || out.video_url || "";
      setResultUrl(url);
      setResultMeta(
        `${out.num_frames} frame · ${out.fps} fps · ${out.width}×${out.height} · ${
          out.device
        }${out.seed !== null ? ` · seed ${out.seed}` : ""}`
      );
      if (url) setHistory((prev) => [url, ...prev].slice(0, 12));
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generasi gagal.");
    } finally {
      setGenerating(false);
    }
  };

  const submitDisabled =
    backendDown ||
    !prompt.trim() ||
    generating ||
    !selectedModel ||
    !selectedModel.installed ||
    (mode === "img2vid" && !initFile);

  return (
    <main className="w-full pb-12">
      <div className="mb-1 text-sm font-semibold">Video Generation</div>
      <div className="mb-4 text-xs text-ink-muted">
        Buat video pendek dari teks dan gambar. Pilih model, masukkan prompt,
        dan klik Generate.
      </div>

      {loadError && (
        <div className="rounded-md border border-edge bg-red-50 mb-4 px-4 py-3 text-[12px] text-red-600">
          {loadError}
        </div>
      )}

      {models && models.length === 0 && (
        <div className="card mb-5 p-5 text-[13px] text-ink-muted">
          Belum ada model video terpasang. Pasang lewat{" "}
          <code className="mono">Setup &amp; Runtime</code> → kategori{" "}
          <em>model</em> dengan awalan <code className="mono">Video:</code>{" "}
          (Motion Adapter + CLIP Vision untuk AnimateDiff, atau Wan 2.1 T2V
          1.3B). Lihat{" "}
          <code className="mono">server/storage/generate/video/README.md</code>.
        </div>
      )}

      {(backendDown || models) && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,450px)_1fr]">
          {/* Panel konfigurasi */}
          <div className="card flex flex-col gap-4 p-5">
            <Dropdown
              label="Model video"
              value={modelId}
              options={modelOptions}
              onChange={setModelId}
              placeholder="Pilih model…"
              disabled={modelDropdownDisabled}
            />

            {kind === "animatediff" && (
              <Dropdown
                label="Model dasar (SD 1.5)"
                value={baseId}
                options={baseOptions}
                onChange={setBaseId}
                placeholder="Pilih model dasar…"
                disabled={backendDown}
              />
            )}

            {selectedModel && (
              <div className="rounded-md border border-edge bg-canvas-subtle p-3 text-[11px] leading-relaxed text-ink-muted">
                {selectedModel.description}
                {selectedModel.note && (
                  <div className="mt-2 text-amber-700">
                    {selectedModel.note}
                  </div>
                )}
                {notInstalled && (
                  <div className="mt-2 text-amber-700">
                    Model belum terpasang, generate disable. Unduh terlebih
                    dahulu lewat{" "}
                    <code className="mono">Setup &amp; Runtime</code> (kategori
                    model → Model Video).
                  </div>
                )}
                {noBases && kind === "animatediff" && (
                  <div className="mt-2 text-amber-700">
                    Belum ada model SD 1.5 di{" "}
                    <code className="mono">server/storage/generate/image/</code>
                    . Pasang lewat Setup &amp; Runtime → Image Generation dulu,
                    atau pilih <em>— Tanpa model dasar —</em> untuk coba Wan.
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-1 rounded-md border border-edge bg-canvas-subtle p-1">
              <button
                type="button"
                onClick={() => setMode("txt2vid")}
                disabled={backendDown || notInstalled}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium ${
                  mode === "txt2vid"
                    ? "bg-white shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                Teks → Video
              </button>
              <button
                type="button"
                onClick={() => setMode("img2vid")}
                disabled={backendDown || notInstalled}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium ${
                  mode === "img2vid"
                    ? "bg-white shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                Gambar → Video
              </button>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-muted">
                Prompt
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                maxLength={2000}
                disabled={backendDown || notInstalled}
                placeholder="a golden retriever running on a beach at sunset, cinematic"
                className="w-full resize-y rounded-md border border-edge px-2.5 py-2 text-[13px]"
                style={{ fontFamily: "inherit" }}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-muted">
                Negative prompt{" "}
                <span className="font-normal text-ink-subtle">(opsional)</span>
              </label>
              <textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                rows={2}
                maxLength={1000}
                disabled={backendDown || notInstalled}
                placeholder="blurry, low quality, distorted, watermark"
                className="w-full resize-y rounded-md border border-edge px-2.5 py-2 text-[13px]"
                style={{ fontFamily: "inherit" }}
              />
            </div>

            {mode === "img2vid" && (
              <div className="flex flex-col gap-3 rounded-md border border-edge p-3">
                <label
                  htmlFor="vid-img2vid-file"
                  className="inline-block cursor-pointer self-start rounded-md border border-edge bg-canvas-subtle px-2.5 py-1.5 text-xs text-ink hover:bg-canvas-inset"
                >
                  {initFile ? "Ganti gambar awal…" : "Pilih gambar awal…"}
                </label>
                <input
                  id="vid-img2vid-file"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handlePickInit(e.target.files?.[0])}
                />
                {initFile && (
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={initFile.dataUrl}
                      alt="Pratinjau"
                      className="h-14 w-14 rounded border border-edge object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">
                        {initFile.name}
                      </div>
                      <button
                        type="button"
                        onClick={() => setInitFile(null)}
                        className="mt-1 text-[11px] text-red-600"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                )}
                <div>
                  <div className="my-1 flex justify-between text-[11px] text-ink-muted">
                    <span>Strength</span>
                    <span className="mono">{strength.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={strength}
                    onChange={(e) => setStrength(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
                {initError && (
                  <div className="text-[11px] text-red-600">{initError}</div>
                )}
                <div className="text-[11px] leading-relaxed text-ink-muted">
                  Gambar awal jadi frame pertama video. Strength kecil = tetap
                  mirip gambar asli; besar = lebih mengikuti prompt.
                </div>
              </div>
            )}

            <details>
              <summary className="cursor-pointer text-xs text-ink-muted">
                Opsi lanjutan
              </summary>
              <div className="mt-2.5 grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="mb-1 block text-[11px] text-ink-muted">
                    Resolusi
                  </label>
                  <select
                    value={resolutionIdx}
                    onChange={(e) => setResolutionIdx(parseInt(e.target.value))}
                    disabled={backendDown || notInstalled}
                    className="w-full rounded-md border border-edge px-1.5 py-1 text-xs"
                  >
                    {resolutions.map((r, i) => (
                      <option key={r.label} value={i}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-ink-muted">
                    Jumlah frame
                  </label>
                  <select
                    value={numFrames}
                    onChange={(e) => setNumFrames(parseInt(e.target.value))}
                    disabled={backendDown || notInstalled}
                    className="w-full rounded-md border border-edge px-1.5 py-1 text-xs"
                  >
                    {frameOptions.map((n) => (
                      <option key={n} value={n}>
                        {n} frame
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-ink-muted">
                    FPS
                  </label>
                  <select
                    value={fps}
                    onChange={(e) => setFps(parseInt(e.target.value))}
                    disabled={backendDown || notInstalled}
                    className="w-full rounded-md border border-edge px-1.5 py-1 text-xs"
                  >
                    {fpsOptions.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-ink-muted">
                    Steps
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={150}
                    value={steps}
                    onChange={(e) => setSteps(parseInt(e.target.value) || 1)}
                    disabled={backendDown || notInstalled}
                    className="w-full rounded-md border border-edge px-1.5 py-1 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-ink-muted">
                    Guidance scale
                  </label>
                  <input
                    type="number"
                    step={0.5}
                    min={0}
                    max={30}
                    value={guidanceScale}
                    onChange={(e) =>
                      setGuidanceScale(parseFloat(e.target.value) || 0)
                    }
                    disabled={backendDown || notInstalled}
                    className="w-full rounded-md border border-edge px-1.5 py-1 text-xs"
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-[11px] text-ink-muted">
                    Seed{" "}
                    <span className="font-normal text-ink-subtle">
                      (kosong = acak)
                    </span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={seedText}
                    onChange={(e) => setSeedText(e.target.value)}
                    disabled={backendDown || notInstalled}
                    placeholder="mis. 42"
                    className="w-full rounded-md border border-edge px-1.5 py-1 text-xs"
                  />
                </div>
              </div>
            </details>

            <button
              className="btn btn-primary self-start"
              disabled={submitDisabled}
              onClick={handleGenerate}
            >
              {generating ? "Membuat video…" : "Generate video"}
            </button>

            {genError && (
              <div className="text-[13px] text-red-600">{genError}</div>
            )}
          </div>

          {/* Hasil — media player */}
          <div className="card flex min-h-[320px] flex-col p-5">
            {generating && (
              <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center gap-3 text-ink-muted">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-ink-muted border-t-transparent" />
                <div className="max-w-sm text-center text-[13px]">
                  Menjalankan inferensi video… Proses ini lebih berat dari
                  gambar. Di GPU 4 GB, AnimateDiff bisa beberapa menit, Wan bisa
                  puluhan menit.
                </div>
              </div>
            )}

            {!generating && !resultUrl && !genError && (
              <div className="flex min-h-[280px] flex-1 items-center justify-center border border-dashed border-edge text-[13px] text-ink-muted">
                Hasil video akan muncul di sini.
              </div>
            )}

            {!generating && resultUrl && (
              <div className="flex flex-col items-center justify-center gap-3">
                <video
                  key={resultUrl}
                  src={resultUrl}
                  controls
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="max-h-[520px] w-full rounded-md border border-edge bg-black"
                />
                <div className="flex flex-col items-center gap-1 text-[11px] text-ink-muted">
                  {resultMeta && <span>{resultMeta}</span>}
                  <a
                    href={resultUrl}
                    download={`waves-video-${Date.now()}.mp4`}
                    className="text-ink underline decoration-dotted"
                  >
                    Unduh .mp4
                  </a>
                </div>
              </div>
            )}

            {!generating && genError && (
              <div className="flex min-h-[280px] flex-1 items-center justify-center text-center text-[13px] text-red-600">
                {genError}
              </div>
            )}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="card mt-4 p-5">
          <div className="mb-3 text-xs font-semibold">
            Riwayat video (sesi ini, tidak disimpan di server)
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {history.map((url, i) => (
              <div
                key={`${i}-${url.slice(0, 20)}`}
                className="group overflow-hidden rounded-md border border-edge bg-canvas-subtle"
              >
                <video
                  src={url}
                  muted
                  playsInline
                  preload="metadata"
                  controls
                  className="aspect-video w-full bg-black object-cover"
                />
                <div className="flex items-center justify-between px-2 py-1 text-[11px] text-ink-muted">
                  <span className="truncate">Video {history.length - i}</span>
                  <a
                    href={url}
                    download={`waves-video-${Date.now()}-${i}.mp4`}
                    className="text-ink underline decoration-dotted"
                  >
                    Unduh
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
