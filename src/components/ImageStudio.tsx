"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchModels, generateImage, sdCoverUrl, type ModelInfo } from "../lib/imageApi";
import Dropdown, { type DropdownOption } from "./Dropdown";
import { useDevice } from "../lib/deviceContext";
import { BACKEND_DOWN_HINT, isBackendDown } from "../lib/api";

export default function ImageStudio() {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backendDown, setBackendDown] = useState(false);
  const [modelId, setModelId] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [steps, setSteps] = useState(25);
  const [guidanceScale, setGuidanceScale] = useState(7.5);
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [seedText, setSeedText] = useState("");
  const [nImages, setNImages] = useState(1);
  const [mode, setMode] = useState<"txt2img" | "img2img">("txt2img");
  const [initFile, setInitFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [strength, setStrength] = useState(0.5);
  const { device } = useDevice();
  const [generating, setGenerating] = useState(false);
  const [jobStage, setJobStage] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<number>(0);
  const [images, setImages] = useState<string[]>([]);
  const [resultSeed, setResultSeed] = useState<number | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const downloadDataUrl = (dataUrl: string, filename: string) => {
    try {
      const parts = dataUrl.split(",");
      const header = parts[0] || "";
      const base64 = parts[1] || "";
      const mime = header.match(/:(.*?);/)?.[1] || "image/png";
      const binary = atob(base64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 800);
    } catch {
      // fallback: buka di tab baru
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  };

  const loadModels = () => {
    fetchModels()
      .then((list) => {
        setModels(list);
        // Keep current selection if valid, else pick first installed or first overall
        if (!list.some((m) => m.id === modelId)) {
          const firstInstalled = list.find((m) => m.installed) || list[0];
          if (firstInstalled) {
            setModelId(firstInstalled.id);
            setPrompt(firstInstalled.description ? `Contoh untuk ${firstInstalled.name}` : "");
          }
        }
      })
      .catch((err) => {
        const down = isBackendDown(err);
        setBackendDown(down);
        setLoadError(down ? BACKEND_DOWN_HINT : err instanceof Error ? err.message : "Gagal memuat daftar model.");
      });
  };

  useEffect(() => {
    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh when download finishes in Setup (poll every 3s if not all installed) — keep user selection
  useEffect(() => {
    if (backendDown) return;
    const hasPending = models !== null && models.some((m) => !m.installed);
    if (!hasPending) return;
    const timer = setInterval(() => {
      fetchModels()
        .then((list) => {
          setModels(list);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [models, backendDown]);

  const selectedModel = models?.find((m) => m.id === modelId) ?? null;
  const noModels = models !== null && models.length === 0;
  const notInstalled = selectedModel ? !selectedModel.installed : false;
  // Dropdown tetap aktif biar bisa dipilih dan lihat keterangan — hanya backendDown yang disable dropdown
  const controlsDisabled = backendDown;
  const generateDisabled = backendDown || notInstalled || !modelId || !prompt.trim() || (mode === "img2img" && !initFile);

  // Deskripsi fallback langsung dari known_defs backend — agar selalu tampil meski sudah terpasang
  const KNOWN_DESCS: Record<string, string> = {
    "tiny-sd": "Model Stable Diffusion ringan (~1 GB) untuk Image Generation.",
    "stable-diffusion": "Model SD 1.5 standar industri (~5,1 GB).",
    "dream-shaper": "Fine-tune SD 1.5 untuk ilustrasi artistik (~5,1 GB).",
  };
  const displayDesc =
    selectedModel?.description?.trim()
      ? selectedModel.description
      : selectedModel
        ? KNOWN_DESCS[selectedModel.id] ?? "Menghasilkan gambar dari teks dengan model yang sudah terpasang. Pilih model, masukkan prompt, dan klik Generate."
        : "Menghasilkan gambar dari teks dengan model yang sudah terpasang. Pilih model, masukkan prompt, dan klik Generate.";

  const modelOptions: DropdownOption[] = useMemo(
    () =>
      (models ?? []).map((m) => ({
        id: m.id,
        label: m.name,
        icon: m.has_cover ? (
          <img
            src={sdCoverUrl(m.id)}
            alt=""
            width={28}
            height={28}
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            className="flex-shrink-0 rounded-[5px] object-cover"
          />
        ) : (
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[5px] bg-canvas-subtle text-[11px] font-medium">
            {m.name.trim().charAt(0).toUpperCase() || "•"}
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
    if (!modelId || !prompt.trim()) return;
    if (mode === "img2img" && !initFile) return;
    setGenerating(true);
    setJobStage("Menunggu");
    setJobProgress(0);
    setGenError(null);
    setImages([]);
    setResultSeed(null);
    try {
      const result = await generateImage(
        {
          modelId,
          prompt,
          negativePrompt,
          steps,
          guidanceScale,
          width,
          height,
          seed: parseSeed(),
          nImages,
          device,
          initImage: mode === "img2img" ? initFile?.dataUrl : undefined,
          strength,
        },
        (stage, progress) => {
          setJobStage(stage);
          if (progress >= 0) setJobProgress(progress);
        }
      );
      setImages(result.images);
      setResultSeed(result.seed);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generasi gagal.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <main className="w-full pb-12">
      <div className="mb-1 text-sm font-semibold">Image Generation</div>
      <div className="mb-4 text-xs text-ink-muted">
        Generate gambar dengan Stable Diffusion. Pilih model, masukkan prompt,
        dan klik Generate.
      </div>

      {loadError && (
        <div className="rounded-md border border-edge bg-red-50 mb-4 px-4 py-3 text-[12px] text-red-600">
          {loadError}
        </div>
      )}

      {models && models.length === 0 && (
        <div className="card p-5 mb-5 text-[13px] text-ink-muted">
          Belum ada model terpasang. Pasang lewat{" "}
          <code className="mono">Setup &amp; Runtime</code> → kategori{" "}
          <code className="mono">Model Gambar</code> atau taruh manual di{" "}
          <code className="mono">
            server/storage/generate/image/&lt;id&gt;/
          </code>{" "}
          — bisa folder <em>diffusers</em> lengkap (
          <code className="mono">model_index.json</code>) atau satu file{" "}
          <code className="mono">*.safetensors</code>/
          <code className="mono">*.ckpt</code>. Lihat{" "}
          <code className="mono">server/storage/generate/image/README.md</code>.
        </div>
      )}

      {(backendDown || models) && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,450px)_1fr]">
          {/* Panel konfigurasi */}
          <div className="card flex flex-col gap-4 p-5">
            <Dropdown
              label="Model"
              value={modelId}
              options={modelOptions}
              onChange={setModelId}
              placeholder="Pilih model…"
              disabled={backendDown}
            />

            {/* Selalu tampil — tidak hanya saat belum terpasang */}
            <div className="rounded-md border border-edge bg-canvas-subtle p-3 text-[11px] leading-relaxed text-ink-muted">
              {displayDesc}
              {selectedModel && notInstalled && (
                <div className="mt-2 text-amber-700">
                  Belum terpasang. Unduh lewat Setup &amp; Runtime →{" "}
                  <code className="mono">Model Gambar</code> (Tiny-SD / SD 1.5 /
                  DreamShaper).
                </div>
              )}
              {selectedModel && notInstalled && (
                <div className="mt-1 text-amber-700">
                  Model belum terpasang, generate disable. Unduh terlebih dahulu
                  lewat Setup &amp; Runtime.
                </div>
              )}
              {!selectedModel && noModels && (
                <>
                  <div className="mt-2 text-amber-700">
                    Belum ada model terpasang. Unduh lewat Setup &amp; Runtime →{" "}
                    <code className="mono">Model Gambar</code>.
                  </div>
                  <div className="mt-1 text-amber-700">
                    Model belum terpasang, generate disable. Unduh terlebih
                    dahulu lewat Setup &amp; Runtime.
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-1 rounded-md border border-edge bg-canvas-subtle p-1">
              <button
                type="button"
                onClick={() => setMode("txt2img")}
                disabled={backendDown || notInstalled}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium ${
                  mode === "txt2img"
                    ? "bg-white shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                Teks → Gambar
              </button>
              <button
                type="button"
                onClick={() => setMode("img2img")}
                disabled={backendDown || notInstalled}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium ${
                  mode === "img2img"
                    ? "bg-white shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                Gambar → Gambar
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
                placeholder="masterpiece, best quality, ..."
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
                placeholder="lowres, bad anatomy, blurry, ..."
                className="w-full resize-y rounded-md border border-edge px-2.5 py-2 text-[13px]"
                style={{ fontFamily: "inherit" }}
              />
            </div>

            {mode === "img2img" && (
              <div className="flex flex-col gap-3 rounded-md border border-edge p-3">
                <label
                  htmlFor="img2img-file"
                  className="inline-block cursor-pointer self-start rounded-md border border-edge bg-canvas-subtle px-2.5 py-1.5 text-xs text-ink hover:bg-canvas-inset"
                >
                  {initFile ? "Ganti gambar awal…" : "Pilih gambar awal…"}
                </label>
                <input
                  id="img2img-file"
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
                  Dimensi hasil mengikuti ukuran gambar awal. Nilai strength
                  kecil = tetap mirip gambar asli; besar = lebih bebas.
                </div>
              </div>
            )}

            <details>
              <summary className="cursor-pointer text-xs text-ink-muted">
                Opsi lanjutan
              </summary>
              <div className="mt-2.5 grid grid-cols-2 gap-3">
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
                {mode === "txt2img" && (
                  <>
                    <div>
                      <label className="mb-1 block text-[11px] text-ink-muted">
                        Width (px)
                      </label>
                      <select
                        value={width}
                        onChange={(e) => setWidth(parseInt(e.target.value))}
                        disabled={backendDown || notInstalled}
                        className="w-full rounded-md border border-edge px-1.5 py-1 text-xs"
                      >
                        {[512, 640, 768, 1024].map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-ink-muted">
                        Height (px)
                      </label>
                      <select
                        value={height}
                        onChange={(e) => setHeight(parseInt(e.target.value))}
                        disabled={backendDown || notInstalled}
                        className="w-full rounded-md border border-edge px-1.5 py-1 text-xs"
                      >
                        {[512, 640, 768, 1024].map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                <div>
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
                <div>
                  <label className="mb-1 block text-[11px] text-ink-muted">
                    Jumlah gambar
                  </label>
                  <select
                    value={nImages}
                    onChange={(e) => setNImages(parseInt(e.target.value))}
                    disabled={backendDown || notInstalled}
                    className="w-full rounded-md border border-edge px-1.5 py-1 text-xs"
                  >
                    {[1, 2, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </details>

            <button
              className="w-full btn btn-primary self-start"
              disabled={generateDisabled || generating}
              onClick={handleGenerate}
            >
              {generating ? "Membuat gambar…" : "Generate"}
            </button>

            {genError && (
              <div className="text-[13px] text-red-600">{genError}</div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div
              data-testid="image-result-card"
              className="card flex min-h-[530px] flex-col p-5"
            >
              {generating && (
                <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center gap-3 text-ink-muted">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-ink-muted border-t-transparent" />
                  <div className="max-w-sm text-center text-[13px]">
                    {jobStage || "Menjalankan inferensi…"}{" "}
                    {jobProgress > 0 && jobProgress < 100
                      ? `(${Math.round(jobProgress)}%)`
                      : ""}
                  </div>
                  <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-canvas-inset">
                    <div
                      className="h-full bg-ink transition-[width] duration-300"
                      style={{
                        width: `${Math.min(100, Math.max(5, jobProgress))}%`,
                      }}
                    />
                  </div>
                  <div className="max-w-sm text-center text-[11px] text-ink-subtle">
                    Tanpa GPU bisa butuh 30 detik hingga beberapa menit. Jangan
                    tutup tab.
                  </div>
                </div>
              )}

              {!generating && images.length === 0 && !genError && (
                <div className="flex min-h-[280px] flex-1 items-center justify-center rounded-md border-2 border-dashed border-edge text-[13px] text-ink-muted">
                  Hasil gambar akan muncul di sini.
                </div>
              )}

              {!generating && images.length > 0 && (
                <div className="flex flex-col items-center justify-center gap-3 w-full">
                  <div
                    className={`grid gap-3 w-full ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
                  >
                    {images.map((src, i) => (
                      <div
                        key={i}
                        className="relative overflow-hidden rounded-md border-2 border-dashed border-edge bg-canvas-subtle group"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={`Hasil ${i + 1}`}
                          className="h-auto w-full object-contain"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            downloadDataUrl(
                              src,
                              `waves-${resultSeed ?? "img"}-${i}.png`,
                            )
                          }
                          className="absolute flex bottom-1.5 right-1.5 gap-1 items-center justify-center rounded bg-black/60 px-2 py-1 text-[10px] font-medium text-white backdrop-blur hover:bg-black/70"
                          title="Unduh gambar ini"
                        >
                          Unduh{" "}
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] text-ink-muted text-center">
                    {resultSeed !== null && (
                      <span>
                        Seed: <code className="mono">{resultSeed}</code>
                      </span>
                    )}
                    {resultSeed !== null && " · "}
                    {images.length} gambar · klik Unduh untuk menyimpan atau{" "}
                    <button
                      type="button"
                      onClick={() =>
                        images.forEach((src, i) =>
                          downloadDataUrl(
                            src,
                            `waves-${resultSeed ?? "img"}-${i}.png`,
                          ),
                        )
                      }
                      className="text-[11px] font-medium hover:underline"
                    >
                      Unduh Semua
                    </button>
                    .
                  </div>
                </div>
              )}

              {!generating && genError && (
                <div className="flex min-h-[280px] flex-1 items-center justify-center text-[13px] text-red-600">
                  {genError}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}