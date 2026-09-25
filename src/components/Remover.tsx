"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Dropdown, { type DropdownOption } from "./Dropdown";
import { BACKEND_DOWN_HINT, isBackendDown } from "../lib/api";
import { fetchRemoverModels, removeBackground, type RemoverModel } from "../lib/removerApi";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const REMOVER_META: Record<string, { name: string; description: string; info: string }> = {
  u2net: {
    name: "U²-Net",
    description: "Model general-purpose seimbang untuk objek umum (~168 MB).",
    info: "Stabil untuk foto produk, objek, potret umum. Cepat, akurat, paling sering dipakai.",
  },
  isnet: {
    name: "ISNet",
    description: "ISNet detail tinggi untuk rambut/bulu/tepi halus (~170 MB).",
    info: "Tepi paling detail untuk rambut, bulu, dedaunan. Presisi tinggi tapi sedikit lebih lambat.",
  },
  "isnet-general-use": {
    name: "ISNet General Use",
    description: "ISNet detail tinggi untuk rambut/bulu/tepi halus (~170 MB).",
    info: "Tepi paling detail untuk rambut, bulu, dedaunan. Presisi tinggi tapi sedikit lebih lambat.",
  },
  silueta: {
    name: "Silueta",
    description: "Ringan khusus siluet manusia full-body (~42 MB).",
    info: "Varian U²-Net yang dioptimasi untuk manusia full-body. Paling cepat & ringan untuk foto orang.",
  },
};

function metaFor(id: string) {
  return REMOVER_META[id] ?? { name: id, description: `Model remover ${id}`, info: "" };
}

export default function Remover() {
  const [models, setModels] = useState<RemoverModel[] | null>(null);
  const [modelId, setModelId] = useState("u2net");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backendDown, setBackendDown] = useState(false);

  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [cutoutUrl, setCutoutUrl] = useState<string | null>(null);
  const [cutoutBlob, setCutoutBlob] = useState<Blob | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Editor state
  const [bgMode, setBgMode] = useState<"transparent" | "white" | "black" | "color" | "image" | "blur">("transparent");
  const [bgColor, setBgColor] = useState("#22c55e");
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const [brushMode, setBrushMode] = useState<"erase" | "restore">("erase");
  const [smartMode, setSmartMode] = useState(false);
  const [brushSize, setBrushSize] = useState(24);
  const [feather, setFeather] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPan, setLastPan] = useState({ x: 0, y: 0 });
  const [compare, setCompare] = useState(100);
  const [isDraggingCompare, setIsDraggingCompare] = useState(false);

  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cutoutImgRef = useRef<HTMLImageElement | null>(null);
  const originalImgRef = useRef<HTMLImageElement | null>(null);
  const workingDataRef = useRef<ImageData | null>(null);
  const originalDataRef = useRef<ImageData | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const historyIdxRef = useRef(-1);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const cursorPosRef = useRef<{ x: number; y: number } | null>(null);
  const spaceDownRef = useRef(false);

  const loadModels = useCallback(async () => {
    try {
      const list = await fetchRemoverModels();
      setModels(list);
      setLoadError(null);
      setBackendDown(false);
      if (list.length && !list.some((m) => m.id === modelId)) {
        const firstInstalled = list.find((m) => m.installed) || list[0];
        if (firstInstalled) setModelId(firstInstalled.id);
      }
    } catch (e) {
      const down = isBackendDown(e);
      setBackendDown(down);
      setLoadError(down ? BACKEND_DOWN_HINT : e instanceof Error ? e.message : "Gagal memuat model.");
    }
  }, [modelId]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // Auto-refresh saat download selesai di Setup (poll tiap 3s jika ada yang belum terpasang) — jaga pilihan user
  useEffect(() => {
    if (backendDown) return;
    const hasPending = models !== null && models.some((m) => !m.installed);
    if (!hasPending) return;
    const timer = setInterval(() => {
      fetchRemoverModels()
        .then((list) => setModels(list))
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [models, backendDown]);

  const modelOptions: DropdownOption[] = useMemo(
    () =>
      (models ?? []).map((m) => {
        const meta = metaFor(m.id);
        return {
          id: m.id,
          label: meta.name,
          icon:
            m.id === "silueta" ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-[5px] bg-canvas-subtle text-[11px] font-bold">
                Si
              </span>
            ) : m.id.includes("isnet") ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-[5px] bg-canvas-subtle text-[11px] font-bold">
                IS
              </span>
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-[5px] bg-canvas-subtle text-[11px] font-bold">
                U²
              </span>
            ),
          right: m.installed ? (
            <span className="max-w-32 flex-shrink-0 truncate text-[11px] text-emerald-600">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                strokeWidth="2"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
            </span>
          ) : (
            <span className="max-w-32 flex-shrink-0 truncate text-[11px] text-amber-600">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                strokeWidth="2"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
            </span>
          ),
        };
      }),
    [models]
  );

  const selectedModel = models?.find((m) => m.id === modelId) ?? null;
  const selectedMeta = selectedModel ? metaFor(selectedModel.id) : null;
  const noModels = models !== null && models.length === 0;
  const notInstalled = selectedModel ? !selectedModel.installed : false;

  const displayDesc = selectedMeta
    ? selectedMeta.description
    : "Hapus latar otomatis dengan model ONNX lokal. Pilih model, upload gambar, dan klik Hapus Background.";

  const handlePickFile = useCallback((file: File | undefined) => {
    setRemoveError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setRemoveError("File harus gambar (PNG/JPG/WebP).");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setRemoveError("File terlalu besar (maks 20MB).");
      return;
    }
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (cutoutUrl) URL.revokeObjectURL(cutoutUrl);
    const url = URL.createObjectURL(file);
    setOriginalFile(file);
    setOriginalUrl(url);
    setCutoutUrl(null);
    setCutoutBlob(null);
    setRemoveError(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setCompare(100);
    setBgImageUrl(null);
    historyRef.current = [];
    historyIdxRef.current = -1;
    workingDataRef.current = null;
    originalDataRef.current = null;
  }, [originalUrl, cutoutUrl]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handlePickFile(f);
  }, [handlePickFile]);

  const handleRemove = async () => {
    if (!originalFile) {
      setRemoveError("Pilih gambar dulu.");
      return;
    }
    // Jika sudah ada hasil edit, iterasi pintar: pakai hasil edit sebagai hint untuk AI
    // Kita simpan seleksi brush sebagai mask; untuk sekarang kita clear dan re-run dengan gambar asli,
    // tapi jika smartMode aktif dan ada history, kita akan gabungkan mask ke request berikutnya.
    // Untuk UX: hilangkan gambar lama selama proses agar tidak tertinggal di bawah.
    // simpan edit untuk smartMode sebelum clear
    const prevWorking = workingDataRef.current;
    const prevHistoryLen = historyRef.current.length;
    if (cutoutUrl) {
      URL.revokeObjectURL(cutoutUrl);
      setCutoutUrl(null);
      setCutoutBlob(null);
    }
    setRemoving(true);
    setRemoveError(null);
    setPan({ x: 0, y: 0 });
    // jangan clear workingData dulu jika smartMode butuh
    const keepForSmart = smartMode && prevHistoryLen > 1 && prevWorking && originalDataRef.current;
    if (!keepForSmart) {
      historyRef.current = [];
      historyIdxRef.current = -1;
      workingDataRef.current = null;
    }
    try {
      let fileToSend: File = originalFile;
      if (keepForSmart && prevWorking) {
        const { w, h } = sizeRef.current;
        const tmp = document.createElement("canvas");
        tmp.width = w; tmp.height = h;
        const ctx = tmp.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        const work = document.createElement("canvas");
        work.width = w; work.height = h;
        work.getContext("2d")!.putImageData(prevWorking, 0, 0);
        ctx.drawImage(work, 0, 0);
        const blob = await new Promise<Blob | null>((res) => tmp.toBlob(res, "image/png"));
        if (blob) fileToSend = new File([blob], originalFile.name, { type: "image/png" });
      }
      const blob = await removeBackground(fileToSend, modelId);
      const url = URL.createObjectURL(blob);
      setCutoutUrl(url);
      setCutoutBlob(blob);
      setBgMode("transparent");
      setFeather(0);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setCompare(100);
      // reset history untuk gambar baru (akan diisi ulang di initCanvases)
      historyRef.current = [];
      historyIdxRef.current = -1;
      workingDataRef.current = null;
    } catch (e) {
      const down = isBackendDown(e);
      if (down) setBackendDown(true);
      setRemoveError(e instanceof Error ? e.message : "Gagal hapus background.");
    } finally {
      setRemoving(false);
    }
  };

  const handlePickBgImage = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return;
    const url = URL.createObjectURL(f);
    if (bgImageUrl) URL.revokeObjectURL(bgImageUrl);
    setBgImageUrl(url);
    setBgMode("image");
  };

  const initCanvases = useCallback(async () => {
    if (!cutoutUrl || !originalUrl) return;
    const cImg = new Image();
    const oImg = new Image();
    cImg.crossOrigin = "anonymous";
    oImg.crossOrigin = "anonymous";
    const load = (img: HTMLImageElement, src: string) =>
      new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("load fail"));
        img.src = src;
      });
    try {
      await Promise.all([load(cImg, cutoutUrl), load(oImg, originalUrl)]);
    } catch {
      return;
    }
    cutoutImgRef.current = cImg;
    originalImgRef.current = oImg;
    sizeRef.current = { w: cImg.naturalWidth, h: cImg.naturalHeight };
    const tmp = document.createElement("canvas");
    tmp.width = cImg.naturalWidth;
    tmp.height = cImg.naturalHeight;
    const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
    tctx.drawImage(cImg, 0, 0);
    const wData = tctx.getImageData(0, 0, tmp.width, tmp.height);
    workingDataRef.current = wData;
    const tmp2 = document.createElement("canvas");
    tmp2.width = cImg.naturalWidth;
    tmp2.height = cImg.naturalHeight;
    const octx = tmp2.getContext("2d", { willReadFrequently: true })!;
    const scale = Math.max(tmp2.width / oImg.naturalWidth, tmp2.height / oImg.naturalHeight);
    const sw = oImg.naturalWidth * scale;
    const sh = oImg.naturalHeight * scale;
    const dx = (tmp2.width - sw) / 2;
    const dy = (tmp2.height - sh) / 2;
    octx.drawImage(oImg, dx, dy, sw, sh);
    originalDataRef.current = octx.getImageData(0, 0, tmp2.width, tmp2.height);
    historyRef.current = [new ImageData(new Uint8ClampedArray(wData.data), wData.width, wData.height)];
    historyIdxRef.current = 0;
    drawComposite();
  }, [cutoutUrl, originalUrl]);

  useEffect(() => {
    if (cutoutUrl && originalUrl) initCanvases();
  }, [cutoutUrl, originalUrl, initCanvases]);

  const pushHistory = useCallback(() => {
    if (!workingDataRef.current) return;
    const data = workingDataRef.current;
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(new ImageData(new Uint8ClampedArray(data.data), data.width, data.height));
    historyIdxRef.current = historyRef.current.length - 1;
    if (historyRef.current.length > 30) {
      historyRef.current.shift();
      historyIdxRef.current--;
    }
  }, []);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    const prev = historyRef.current[historyIdxRef.current];
    workingDataRef.current = new ImageData(new Uint8ClampedArray(prev.data), prev.width, prev.height);
    drawComposite();
  }, []);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    const nxt = historyRef.current[historyIdxRef.current];
    workingDataRef.current = new ImageData(new Uint8ClampedArray(nxt.data), nxt.width, nxt.height);
    drawComposite();
  }, []);

  const drawComposite = useCallback(() => {
    const canvas = mainCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !workingDataRef.current) return;
    const { w, h } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    const maxW = container.clientWidth - 32;
    const maxH = container.clientHeight - 32;
    const fitScale = Math.min(maxW / w, maxH / h, 1);
    // batasi: canvas tidak ikut membesar saat zoom, zoom hanya via CSS transform di wrapper
    // jadi canvas tetap fitScale saja, biar tidak melebihi container dan tidak stretch
    canvas.width = Math.round(w * fitScale * dpr);
    canvas.height = Math.round(h * fitScale * dpr);
    canvas.style.width = `${Math.round(w * fitScale)}px`;
    canvas.style.height = `${Math.round(h * fitScale)}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr * fitScale, 0, 0, dpr * fitScale, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const drawBg = () => {
      if (bgMode === "transparent") {
        const size = 16;
        for (let y = 0; y < h; y += size) {
          for (let x = 0; x < w; x += size) {
            const isDark = ((Math.floor(x / size) + Math.floor(y / size)) % 2) === 0;
            ctx.fillStyle = isDark ? "#e5e7eb" : "#ffffff";
            ctx.fillRect(x, y, size, size);
          }
        }
      } else if (bgMode === "white" || bgMode === "black" || bgMode === "color") {
        let col = "#ffffff";
        if (bgMode === "black") col = "#111827";
        if (bgMode === "color") col = bgColor;
        ctx.fillStyle = col;
        ctx.fillRect(0, 0, w, h);
      } else if (bgMode === "image" && bgImageUrl) {
        const bgImg = new Image();
        bgImg.src = bgImageUrl;
        if (bgImg.complete && bgImg.naturalWidth) {
          const s = Math.max(w / bgImg.naturalWidth, h / bgImg.naturalHeight);
          const sw = bgImg.naturalWidth * s;
          const sh = bgImg.naturalHeight * s;
          ctx.drawImage(bgImg, (w - sw) / 2, (h - sh) / 2, sw, sh);
        } else {
          ctx.fillStyle = "#111827";
          ctx.fillRect(0, 0, w, h);
          bgImg.onload = () => drawComposite();
        }
      } else if (bgMode === "blur" && originalImgRef.current) {
        ctx.save();
        ctx.filter = "blur(18px) brightness(0.95)";
        const oImg = originalImgRef.current;
        const s = Math.max(w / oImg.naturalWidth, h / oImg.naturalHeight);
        const sw = oImg.naturalWidth * s;
        const sh = oImg.naturalHeight * s;
        ctx.drawImage(oImg, (w - sw) / 2, (h - sh) / 2, sw, sh);
        ctx.restore();
        ctx.fillStyle = "rgba(0,0,0,0.08)";
        ctx.fillRect(0, 0, w, h);
      }
    };

    drawBg();

    // Draw working data (or original if showOriginal)
    if (showOriginal && originalImgRef.current) {
      const oImg = originalImgRef.current;
      const s = Math.max(w / oImg.naturalWidth, h / oImg.naturalHeight);
      const sw = oImg.naturalWidth * s;
      const sh = oImg.naturalHeight * s;
      ctx.globalAlpha = 0.98;
      ctx.drawImage(oImg, (w - sw) / 2, (h - sh) / 2, sw, sh);
      ctx.globalAlpha = 1;
    } else {
      const tmp = document.createElement("canvas");
      tmp.width = w; tmp.height = h;
      const tctx = tmp.getContext("2d")!;
      tctx.putImageData(workingDataRef.current, 0, 0);
      if (feather > 0) {
        ctx.save();
        ctx.filter = `blur(${feather}px)`;
        ctx.drawImage(tmp, 0, 0);
        ctx.restore();
      } else {
        ctx.drawImage(tmp, 0, 0);
      }
    }

    // Before/After: jika compare <100, tampilkan gambar asli di sisi kiri
    if (compare < 100 && compare > 0 && originalImgRef.current && !showOriginal) {
      const splitX = (w * compare) / 100;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, splitX, h);
      ctx.clip();
      // bg putih agar checker tidak tembus
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, splitX, h);
      const oImg = originalImgRef.current;
      const s = Math.max(w / oImg.naturalWidth, h / oImg.naturalHeight);
      const sw = oImg.naturalWidth * s;
      const sh = oImg.naturalHeight * s;
      ctx.drawImage(oImg, (w - sw) / 2, (h - sh) / 2, sw, sh);
      ctx.fillRect(4, 4, 48, 18);
      ctx.restore();
      // divider
      ctx.fillStyle = "#fff";
      ctx.fillRect(splitX - 1.5, 0, 3, h);
      ctx.fillStyle = "#111827";
      ctx.fillRect(splitX - 0.75, 0, 1.5, h);
      // handle circle
      ctx.beginPath();
      ctx.arc(splitX, h / 2, 10, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = "#111827";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("◀ ▶", splitX, h / 2 + 3.5);
      ctx.textAlign = "left";
    }
  }, [bgMode, bgColor, bgImageUrl, feather, showOriginal, compare, zoom]);

  useEffect(() => { drawComposite(); }, [drawComposite]);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  useEffect(() => {
    const ro = new ResizeObserver(() => drawComposite());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [drawComposite]);

  // React onWheel bersifat passive, jadi preventDefault tidak memblokir scroll `main`.
  // Tambah listener native non-passive biar wheel di atas editor hanya zoom, tidak scroll halaman.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Overlay cursor/handle - dipakai di mousemove & redraw saat zoom/pan berubah
  const redrawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const canvas = mainCanvasRef.current;
    const container = containerRef.current;
    const c = cursorPosRef.current;
    if (!overlay || !canvas || !container || !c) return;
    const { w } = sizeRef.current;
    if (!w) return;
    const crect = container.getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // overlay = screen-space di atas container (SIBLING wrapper, bukan di dalam wrapper yang di-scale)
    // supaya tidak kena double-scale dan ring tetap persis di bawah kursor
    overlay.width = Math.round(crect.width * dpr);
    overlay.height = Math.round(crect.height * dpr);
    const octx = overlay.getContext("2d")!;
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, crect.width, crect.height);
    if (!cutoutUrl) return;
    // rect.width sudah = w*fitScale*zoom (via CSS transform), jadi scale efektif yang terlihat:
    const scale = rect.width / w;
    const r = (brushSize / 2) * scale;
    const sx = c.x - crect.left;
    const sy = c.y - crect.top;
    const splitX = rect.left + (w * compare / 100) * scale; // posisi split di viewport
    const handleY = rect.top + rect.height / 2;
    const distHandle = Math.hypot(c.x - splitX, c.y - handleY);
    const isNearHandle = distHandle < 22 && compare > 0 && compare < 100;
    if (isNearHandle) {
      octx.beginPath();
      octx.arc(splitX - crect.left, handleY - crect.top, 14, 0, Math.PI * 2);
      octx.fillStyle = "rgba(17,24,39,0.08)";
      octx.fill();
      octx.strokeStyle = "rgba(17,24,39,0.3)";
      octx.lineWidth = 1;
      octx.stroke();
    } else if (!isDraggingCompare && !isPanning) {
      octx.beginPath();
      octx.arc(sx, sy, r, 0, Math.PI * 2);
      octx.strokeStyle = smartMode ? "rgba(124,58,237,0.95)" : brushMode === "erase" ? "rgba(239,68,68,0.95)" : "rgba(34,197,94,0.95)";
      octx.lineWidth = 1.6;
      octx.stroke();
      octx.fillStyle = smartMode ? "rgba(124,58,237,0.18)" : brushMode === "erase" ? "rgba(239,68,68,0.18)" : "rgba(34,197,94,0.18)";
      octx.fill();
      if (smartMode) {
        octx.fillStyle = "#7c3aed";
        octx.font = "9px sans-serif";
        octx.fillText("AI", sx + r + 4, sy - r - 2);
      }
    }
  }, [brushSize, brushMode, smartMode, compare, isPanning, isDraggingCompare, cutoutUrl]);

  // Wheel zoom - pakai onWheel di container, bukan window, biar tidak tarik page ke atas
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!cutoutUrl) return;
    e.preventDefault();
    e.stopPropagation();
    // deltaMode bisa 0 (pixel) atau 1 (line). Normalisasi
    const delta = e.deltaY;
    // zoom ke arah kursor, step halus
    const step = Math.abs(delta) > 60 ? 0.15 : 0.08;
    const dir = delta < 0 ? 1 : -1;
    const z = zoomRef.current;
    const nz = Math.min(4, Math.max(0.25, +(z + dir * step).toFixed(2)));
    if (nz === z) return;
    const canvas = mainCanvasRef.current;
    // zoom berlabuh ke kursor: pertahankan titik gambar di bawah mouse tetap di bawah mouse
    let np = panRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const s = nz / z;
      // transform-origin 0 0: top-left canvas = W0 + pan (W0 = posisi layout wrapper yang tak berubah)
      const W0x = rect.left - np.x;
      const W0y = rect.top - np.y;
      const ux = e.clientX - W0x;
      const uy = e.clientY - W0y;
      np = { x: ux - (ux - np.x) * s, y: uy - (uy - np.y) * s };
    }
    zoomRef.current = nz;
    panRef.current = np;
    setZoom(nz);
    setPan(np);
    cursorPosRef.current = { x: e.clientX, y: e.clientY };
    requestAnimationFrame(redrawOverlay);
  }, [cutoutUrl, redrawOverlay]);

  // redraw overlay ketika zoom/pan/brush berubah supaya ring tidak "ikut pindah" dari kursor
  useEffect(() => {
    redrawOverlay();
  }, [zoom, pan, brushSize, brushMode, smartMode, compare, isPanning, isDraggingCompare, redrawOverlay]);

  // Hotkeys
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceDownRef.current = true;
        return;
      }
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        if (!(e.ctrlKey || e.metaKey)) return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault(); redo();
      } else if (e.key === "[" ) {
        setBrushSize((s) => Math.max(4, s - 4));
      } else if (e.key === "]") {
        setBrushSize((s) => Math.min(120, s + 4));
      } else if (e.key.toLowerCase() === "e") {
        setBrushMode("erase");
      } else if (e.key.toLowerCase() === "r") {
        setBrushMode("restore");
      } else if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)));
      } else if (e.key === "-" || e.key === "_") {
        setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)));
      } else if (e.key === "0") {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }
      } else if (e.key.toLowerCase() === "b") {
        // cycle bg
        const order: typeof bgMode[] = ["transparent", "white", "black", "color", "image", "blur"];
        setBgMode((cur) => order[(order.indexOf(cur) + 1) % order.length]);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDownRef.current = false;
    };
    const onBlur = () => { spaceDownRef.current = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [undo, redo]);

  const getCanvasPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { w, h } = sizeRef.current;
    // rect.width sudah termasuk fitScale*zoom + translate, jadi scale efektif = rect.width / w
    const scale = rect.width / w;
    if (!scale) return null;
    const clientX = "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const x = (clientX - rect.left) / scale;
    const y = (clientY - rect.top) / scale;
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    return { x, y };
  };

  const doFloodSelect = (start: { x: number; y: number }) => {
    if (!workingDataRef.current || !originalDataRef.current) return;
    const data = workingDataRef.current;
    const orig = originalDataRef.current;
    const w = data.width, h = data.height;
    const sx = Math.floor(start.x), sy = Math.floor(start.y);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
    const sIdx = (sy * w + sx) * 4;
    const curA = data.data[sIdx + 3];
    // guard alpha: jangan menyebar dari area yang salah (erase=harus opaque, restore=harus transparan)
    if (brushMode === "erase" && curA === 0) return;
    if (brushMode === "restore" && curA >= 128) return;
    const sr = orig.data[sIdx], sg = orig.data[sIdx + 1], sb = orig.data[sIdx + 2];
    const tol = 28;
    // batasi radius dari titik klik biar tidak menghapus masif / kotak besar
    const maxDist = Math.max(120, brushSize * 2.5);
    const maxDist2 = maxDist * maxDist;
    const visited = new Uint8Array(w * h);
    const q: [number, number][] = [[sx, sy]];
    visited[sy * w + sx] = 1;
    let head = 0;
    const apply = (idx: number) => {
      if (brushMode === "erase") data.data[idx + 3] = 0;
      else {
        data.data[idx] = orig.data[idx];
        data.data[idx + 1] = orig.data[idx + 1];
        data.data[idx + 2] = orig.data[idx + 2];
        data.data[idx + 3] = 255;
      }
    };
    apply(sIdx);
    while (head < q.length && q.length < 60000) {
      const [x, y] = q[head++];
      const neigh: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1]];
      for (const [dx, dy] of neigh) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (visited[ny * w + nx]) continue;
        const vdx = nx - sx, vdy = ny - sy;
        if (vdx * vdx + vdy * vdy > maxDist2) continue;
        const nIdx = (ny * w + nx) * 4;
        // hanya menyebar melalui area yang cocok: erase melewati opaque, restore melewati transparan
        const na = data.data[nIdx + 3];
        if (brushMode === "erase" ? na === 0 : na >= 128) continue;
        const dr = Math.abs(orig.data[nIdx] - sr);
        const dg = Math.abs(orig.data[nIdx + 1] - sg);
        const db = Math.abs(orig.data[nIdx + 2] - sb);
        if (dr + dg + db < tol * 3) {
          visited[ny * w + nx] = 1;
          q.push([nx, ny]);
          apply(nIdx);
        }
      }
    }
  };

  const applyBrush = (a: { x: number; y: number }, b: { x: number; y: number } | null) => {
    if (!workingDataRef.current || !originalDataRef.current) return;
    if (smartMode && !b) {
      // smart single click -> flood select
      doFloodSelect(a);
      return;
    }
    const data = workingDataRef.current;
    const orig = originalDataRef.current;
    const w = data.width, h = data.height;
    const r = brushSize / 2;
    const points: { x: number; y: number }[] = [];
    if (!b) points.push(a);
    else {
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(dist / (r / 2)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    for (const p of points) {
      const minX = Math.max(0, Math.floor(p.x - r));
      const maxX = Math.min(w - 1, Math.ceil(p.x + r));
      const minY = Math.max(0, Math.floor(p.y - r));
      const maxY = Math.min(h - 1, Math.ceil(p.y + r));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = x - p.x, dy = y - p.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > r) continue;
          const idx = (y * w + x) * 4;
          const soft = d > r * 0.7 ? 1 - (d - r * 0.7) / (r * 0.3) : 1;
          if (brushMode === "erase") {
            const curA = data.data[idx + 3];
            data.data[idx + 3] = Math.round(curA * (1 - soft));
          } else {
            const oIdx = idx;
            data.data[idx] = Math.round(data.data[idx] * (1 - soft) + orig.data[oIdx] * soft);
            data.data[idx + 1] = Math.round(data.data[idx + 1] * (1 - soft) + orig.data[oIdx + 1] * soft);
            data.data[idx + 2] = Math.round(data.data[idx + 2] * (1 - soft) + orig.data[oIdx + 2] * soft);
            data.data[idx + 3] = Math.round(data.data[idx + 3] * (1 - soft) + 255 * soft);
          }
        }
      }
    }
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (!cutoutUrl) return;
    if (isDraggingCompare) return;
    // Pan: Shift+drag, Space+drag, atau mouse tengah (button === 1)
    const me = e as React.MouseEvent;
    const middleBtn = !("touches" in e) && me.button === 1;
    if (middleBtn) me.preventDefault();
    if (me.shiftKey || spaceDownRef.current || middleBtn) {
      const cx = "touches" in e ? e.touches[0].clientX : me.clientX;
      const cy = "touches" in e ? e.touches[0].clientY : me.clientY;
      setIsPanning(true);
      setLastPan({ x: cx, y: cy });
      return;
    }
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const cy = "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const { w } = sizeRef.current;
    const scale = rect.width / w; // rect sudah termasuk fitScale*zoom
    const splitX = rect.left + (w * compare / 100) * scale;
    const handleY = rect.top + rect.height / 2;
    if (compare > 0 && compare < 100) {
      const distHandle = Math.hypot(cx - splitX, cy - handleY);
      if (distHandle < 22) {
        setIsDraggingCompare(true);
        return;
      }
    }
    const pos = getCanvasPos(e);
    if (!pos) return;
    isDrawingRef.current = true;
    lastPosRef.current = pos;
    applyBrush(pos, null);
    drawComposite();
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    const cx = "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const cy = "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    cursorPosRef.current = { x: cx, y: cy };
    redrawOverlay();
    // pan geser canvas saat Shift/Space/mouse-tengah drag
    if (isPanning) {
      const dx = cx - lastPan.x;
      const dy = cy - lastPan.y;
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      setLastPan({ x: cx, y: cy });
      return;
    }
    if (isDraggingCompare) {
      const canvas = mainCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((cx - rect.left) / rect.width) * 100));
      setCompare(Math.round(pct));
      return;
    }
    if (!isDrawingRef.current) return;
    const pos = getCanvasPos(e);
    if (!pos || !lastPosRef.current) return;
    applyBrush(pos, lastPosRef.current);
    lastPosRef.current = pos;
    drawComposite();
  };

  const handlePointerUp = () => {
    if (isDraggingCompare) { setIsDraggingCompare(false); return; }
    if (isPanning) { setIsPanning(false); return; }
    if (isDrawingRef.current) pushHistory();
    isDrawingRef.current = false;
    lastPosRef.current = null;
  };

  const resetEdit = () => {
    if (!historyRef.current[0]) return;
    const first = historyRef.current[0];
    workingDataRef.current = new ImageData(new Uint8ClampedArray(first.data), first.width, first.height);
    historyRef.current = [new ImageData(new Uint8ClampedArray(first.data), first.width, first.height)];
    historyIdxRef.current = 0;
    drawComposite();
  };

  const downloadExport = async (asJpg: boolean) => {
    if (!workingDataRef.current) return;
    const { w, h } = sizeRef.current;
    const exp = document.createElement("canvas");
    exp.width = w; exp.height = h;
    const ctx = exp.getContext("2d")!;
    if (asJpg || (bgMode !== "transparent" && bgMode !== "image" && bgMode !== "blur")) {
      let col = "#ffffff";
      if (bgMode === "black") col = "#111827";
      else if (bgMode === "color") col = bgColor;
      else if (asJpg && bgMode === "transparent") col = "#ffffff";
      ctx.fillStyle = col;
      ctx.fillRect(0, 0, w, h);
    } else if (bgMode === "image" && bgImageUrl) {
      const img = new Image(); img.src = bgImageUrl;
      await new Promise<void>((res) => { if (img.complete) res(); else { img.onload = () => res(); img.onerror = () => res(); } });
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const sw = img.naturalWidth * s; const sh = img.naturalHeight * s;
      ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh);
    } else if (bgMode === "blur" && originalImgRef.current) {
      const oImg = originalImgRef.current;
      ctx.filter = "blur(18px) brightness(0.95)";
      const s = Math.max(w / oImg.naturalWidth, h / oImg.naturalHeight);
      const sw = oImg.naturalWidth * s; const sh = oImg.naturalHeight * s;
      ctx.drawImage(oImg, (w - sw) / 2, (h - sh) / 2, sw, sh);
      ctx.filter = "none";
    } else {
      if (asJpg) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); }
    }
    const tmp = document.createElement("canvas");
    tmp.width = w; tmp.height = h;
    tmp.getContext("2d")!.putImageData(workingDataRef.current, 0, 0);
    if (feather > 0) { ctx.save(); ctx.filter = `blur(${feather}px)`; ctx.drawImage(tmp, 0, 0); ctx.restore(); }
    else ctx.drawImage(tmp, 0, 0);
    const mime = asJpg ? "image/jpeg" : "image/png";
    const ext = asJpg ? "jpg" : "png";
    exp.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `waves-remover-${Date.now()}.${ext}`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 600);
    }, mime, asJpg ? 0.92 : undefined);
  };

  return (
    <main className="w-full pb-12">
      <div className="mb-1 text-sm font-semibold">Background Remover</div>
      <div className="mb-4 text-xs text-ink-muted">
        Hapus latar otomatis (U²-Net / ISNet / Silueta) lalu sempurnakan dengan
        editor kuas pintar, ganti background, dan export PNG transparan.
      </div>

      {(loadError || removeError) && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600">
          {loadError || removeError}
        </div>
      )}

      {noModels && (
        <div className="card p-5 mb-5 text-[13px] text-ink-muted">
          Tidak ada model di{" "}
          <code className="mono">server/storage/remover</code>. Letakkan folder{" "}
          <code className="mono">u2net/u2net.onnx</code> /{" "}
          <code className="mono">isnet/isnet-general-use.onnx</code> /{" "}
          <code className="mono">silueta/silueta.onnx</code> — atau pasang via
          Setup &amp; Runtime → Model Remover.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <div className="card flex flex-col gap-4 p-5">
          <Dropdown
            label="Model"
            value={modelId}
            options={modelOptions}
            onChange={setModelId}
            placeholder="Pilih model…"
            disabled={backendDown || removing || !models?.length}
          />
          <div className="rounded-md border border-edge bg-canvas-subtle p-3 text-[11px] leading-relaxed text-ink-muted">
            {displayDesc}
            {selectedMeta?.info && (
              <div className="mt-1.5 text-ink-muted">{selectedMeta.info}</div>
            )}
            {selectedModel && notInstalled && (
              <div className="mt-2 text-amber-700">
                Belum terpasang. Unduh lewat Setup &amp; Runtime →{" "}
                <code className="mono">Model Remover</code> (U²-Net / ISNet /
                Silueta).
              </div>
            )}
            {selectedModel && notInstalled && (
              <div className="mt-1 text-amber-700">
                Model belum terpasang, remove disable. Unduh terlebih dahulu
                lewat Setup &amp; Runtime.
              </div>
            )}
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex flex-col gap-3 rounded-md border p-3 transition-colors ${dragOver ? "border-ink bg-canvas-inset" : "border-edge bg-white"} ${!originalUrl ? "border-dashed" : ""}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-muted">
                Gambar Sumber
              </span>
              {originalFile && (
                <span className="text-[11px] text-ink-muted">
                  {formatBytes(originalFile.size)}
                </span>
              )}
            </div>
            {!originalUrl ? (
              <label
                htmlFor="remover-file"
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-edge bg-canvas-subtle px-4 py-6 text-center hover:bg-canvas-inset"
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
                >
                  <path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                <span className="text-xs font-medium text-ink">
                  Pilih atau jatuhkan gambar
                </span>
                <span className="text-[11px] text-ink-muted">
                  PNG / JPG / WebP — maks 20MB — drag & drop didukung
                </span>
              </label>
            ) : (
              <div className="flex items-center gap-3">
                <img
                  src={originalUrl}
                  alt="original"
                  className="h-16 w-16 rounded-md border border-edge object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">
                    {originalFile?.name}
                  </div>
                  <div className="text-[11px] text-ink-muted">
                    {originalFile?.type} ·{" "}
                    {originalFile && formatBytes(originalFile.size)}
                  </div>
                  <button
                    onClick={() => {
                      if (originalUrl) URL.revokeObjectURL(originalUrl);
                      if (cutoutUrl) URL.revokeObjectURL(cutoutUrl);
                      setOriginalFile(null);
                      setOriginalUrl(null);
                      setCutoutUrl(null);
                      setCutoutBlob(null);
                      setRemoveError(null);
                    }}
                    className="mt-1 text-[11px] font-medium text-red-600 hover:underline"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            )}
            <input
              id="remover-file"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                handlePickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          <button
            onClick={handleRemove}
            disabled={!originalFile || removing || backendDown || notInstalled}
            className="btn btn-primary w-full"
          >
            {removing ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Menghapus latar…
              </>
            ) : cutoutUrl ? (
              "Hapus lagi (pakai AI refine)"
            ) : (
              "Hapus Background"
            )}
          </button>
          {cutoutUrl && (
            <div className="text-[11px] text-center text-ink-muted">
              Kuas hapus → klik Hapus lagi biar AI refine seleksi pintar.
            </div>
          )}

          {cutoutUrl && (
            <>
              <div className="h-px bg-edge" />
              <div>
                <div className="mb-2 text-xs font-semibold text-ink-muted">
                  Background
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    {
                      id: "transparent",
                      label: "Transparan",
                      swatch: "checker",
                    },
                    { id: "white", label: "Putih", swatch: "#fff" },
                    { id: "black", label: "Hitam", swatch: "#111827" },
                    { id: "color", label: "Warna", swatch: bgColor },
                    { id: "image", label: "Gambar", swatch: "image" },
                    { id: "blur", label: "Blur", swatch: "blur" },
                  ].map((b) => (
                    <button
                      key={b.id}
                      onClick={() => setBgMode(b.id as any)}
                      className={`flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-[11px] font-medium ${bgMode === b.id ? "border-ink bg-ink text-white" : "border-edge bg-white hover:bg-canvas-subtle"}`}
                    >
                      <span
                        className="h-7 w-7 rounded-md border border-black/10"
                        style={{
                          background:
                            b.swatch === "checker"
                              ? "repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%) 0 0 / 12px 12px"
                              : b.swatch === "image"
                                ? bgImageUrl
                                  ? `url(${bgImageUrl}) center/cover`
                                  : "#f3f4f6"
                                : b.swatch === "blur"
                                  ? "linear-gradient(135deg,#e5e7eb,#9ca3af)"
                                  : b.swatch,
                        }}
                      />
                      {b.label}
                    </button>
                  ))}
                </div>
                {bgMode === "color" && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="color"
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      className="h-8 w-8 cursor-pointer rounded border border-edge p-1"
                    />
                    <input
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      className="flex-1 rounded-md border border-edge px-2 py-1 text-xs mono"
                    />
                  </div>
                )}
                {bgMode === "image" && (
                  <div className="mt-2 flex items-center gap-2">
                    <label
                      htmlFor="bg-image"
                      className="cursor-pointer rounded-md border border-edge bg-white px-2.5 py-1 text-xs hover:bg-canvas-subtle"
                    >
                      Pilih gambar BG
                    </label>
                    <input
                      id="bg-image"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handlePickBgImage(e.target.files?.[0])}
                    />
                    {bgImageUrl && (
                      <button
                        onClick={() => setBgImageUrl(null)}
                        className="text-[11px] text-red-600"
                      >
                        Hapus BG
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink-muted">
                    Kuas Editor
                  </span>
                  <label className="flex items-center gap-1 text-[11px]">
                    <input
                      type="checkbox"
                      checked={smartMode}
                      onChange={(e) => setSmartMode(e.target.checked)}
                      className="accent-violet-600"
                    />{" "}
                    <span className="font-medium text-violet-600">
                      AI Pintar
                    </span>
                  </label>
                </div>
                <div className="flex gap-1 rounded-md border border-edge bg-canvas-subtle p-1">
                  <button
                    onClick={() => setBrushMode("erase")}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium ${brushMode === "erase" ? "bg-white shadow-sm text-red-600" : "text-ink-muted hover:text-ink"}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      strokeWidth="2"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 12H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                      />
                    </svg>
                    Hapus
                  </button>
                  <button
                    onClick={() => setBrushMode("restore")}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium ${brushMode === "restore" ? "bg-white shadow-sm text-emerald-600" : "text-ink-muted hover:text-ink"}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      strokeWidth="2"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                      />
                    </svg>
                    Pulihkan
                  </button>
                </div>
                {smartMode && (
                  <div className="mt-1.5 rounded bg-violet-50 border border-violet-200 px-2 py-1 text-[11px] text-violet-700">
                    Klik area → AI seleksi warna serupa otomatis. Lalu klik
                    Hapus lagi untuk refine.
                  </div>
                )}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] text-ink-muted">
                    <span>Ukuran ( [ / ] )</span>
                    <span className="mono">{brushSize}px</span>
                  </div>
                  <input
                    type="range"
                    min={4}
                    max={120}
                    value={brushSize}
                    onChange={(e) => setBrushSize(parseInt(e.target.value))}
                    className="w-full accent-ink"
                  />
                </div>
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[11px] text-ink-muted">
                    <span>Feather</span>
                    <span className="mono">{feather}px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={8}
                    step={0.5}
                    value={feather}
                    onChange={(e) => setFeather(parseFloat(e.target.value))}
                    className="w-full accent-ink"
                  />
                </div>
                <div className="mt-2 flex gap-1.5">
                  <button
                    onClick={undo}
                    className="btn flex-1 text-xs"
                    disabled={historyIdxRef.current <= 0}
                  >
                    Undo (Ctrl+Z)
                  </button>
                  <button
                    onClick={redo}
                    className="btn flex-1 text-xs"
                    disabled={
                      historyIdxRef.current >= historyRef.current.length - 1
                    }
                  >
                    Redo (⇧+Z)
                  </button>
                  <button onClick={resetEdit} className="btn flex-1 text-xs">
                    Reset
                  </button>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
                  Hotkey: <span className="mono">E</span> hapus /{" "}
                  <span className="mono">R</span> pulih ·{" "}
                  <span className="mono">Scroll</span> zoom ·{" "}
                  <span className="mono">B</span> background
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => downloadExport(false)}
                  className="btn btn-primary flex-1 text-xs"
                >
                  Unduh PNG
                </button>
                <button
                  onClick={() => downloadExport(true)}
                  className="btn flex-1 text-xs"
                >
                  Unduh JPG
                </button>
              </div>
            </>
          )}
        </div>

        <div className="card flex min-h-[560px] flex-col p-5">
          {!originalUrl && !cutoutUrl && !removing && (
            <div className="flex min-h-[420px] flex-1 items-center justify-center rounded-md border-2 border-dashed border-edge text-[13px] text-ink-muted">
              Preview akan muncul di sini — upload gambar lalu Hapus Background.
            </div>
          )}
          {originalUrl && !cutoutUrl && !removing && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4">
              <div className="relative overflow-hidden rounded-md border border-edge bg-canvas-subtle">
                <img
                  src={originalUrl}
                  alt="original"
                  className="max-h-[520px] w-auto max-w-full object-contain"
                />
              </div>
              <div className="text-[11px] text-ink-muted">
                Belum di-remove — klik Hapus Background.
              </div>
            </div>
          )}
          {removing && (
            <div className="flex min-h-[420px] flex-1 flex-col items-center justify-center gap-3 text-ink-muted">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-ink-muted border-t-transparent" />
              <div className="text-[13px]">
                Menghapus latar dengan {selectedMeta?.name ?? modelId}…
              </div>
              <div className="text-[11px] text-ink-subtle">
                Gambar lama disembunyikan — proses ONNX lokal.
              </div>
            </div>
          )}
          {cutoutUrl && !removing && (
            <div className="flex flex-1 flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-ink-muted">
                  Editor{" "}
                  {smartMode && (
                    <span className="ml-1 rounded bg-violet-600 px-1.5 py-0.5 text-[10px] text-white">
                      AI Pintar
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() =>
                      setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))
                    }
                    className="rounded-md border border-edge bg-white p-2 text-xs hover:bg-canvas-subtle"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      strokeWidth="2"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 12h14"
                      />
                    </svg>
                  </button>
                  <span className="min-w-[48px] text-center text-xs mono">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    onClick={() =>
                      setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))
                    }
                    className="rounded-md border border-edge bg-white p-2 text-xs hover:bg-canvas-subtle"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      strokeWidth="2"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 4.5v15m7.5-7.5h-15"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={() => {
                      setZoom(1);
                      setPan({ x: 0, y: 0 });
                    }}
                    className="w-20 h-[27.5px] ml-1 rounded-md border border-edge bg-white text-xs hover:bg-canvas-subtle"
                  >
                    Reset
                  </button>
                </div>
              </div>
              <div
                ref={containerRef}
                className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-edge bg-canvas-subtle select-none overscroll-contain"
                style={{
                  height: 650,
                  cursor: isDraggingCompare
                    ? "ew-resize"
                    : isPanning
                      ? "grabbing"
                      : "crosshair",
                  touchAction: "none",
                }}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onMouseLeave={handlePointerUp}
                onTouchStart={handlePointerDown}
                onTouchMove={handlePointerMove}
                onTouchEnd={handlePointerUp}
                onWheel={handleWheel}
              >
                <div
                  className="relative flex items-center justify-center shrink-0"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: "0 0",
                  }}
                >
                  <canvas
                    ref={mainCanvasRef}
                    className="block rounded-md shadow-sm"
                    style={{ display: "block" }}
                  />
                </div>
                <canvas
                  ref={overlayRef}
                  className="pointer-events-none absolute inset-0 block"
                  style={{ width: "100%", height: "100%" }}
                />
                {showOriginal && (
                  <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
                    Asli
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-[11px] text-ink-muted">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={showOriginal}
                      onChange={(e) => setShowOriginal(e.target.checked)}
                      className="accent-ink"
                    />
                    Tampilan Asli
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="hidden sm:inline">Before</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={compare}
                      onChange={(e) => setCompare(parseInt(e.target.value))}
                      className="w-24 accent-ink"
                    />
                    <span className="hidden sm:inline">After</span>
                    <button
                      onClick={() => setCompare((c) => (c === 100 ? 50 : 100))}
                      className="rounded border border-edge bg-white w-20 px-1.5 py-0.5 text-[11px]"
                    >
                      {compare === 100 ? "Belah" : "Penuh"}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-ink-muted">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-red-500" /> Hapus
                    (E)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />{" "}
                    Pulihkan (R)
                  </span>
                  <span className="ml-auto hidden sm:inline">
                    scroll zoom · spasi+seret geser · [ ] ukuran · Ctrl+Z undo
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-edge bg-white p-2">
                  <div className="text-[11px] font-semibold text-ink-muted">
                    Sebelum
                  </div>
                  <img
                    src={originalUrl!}
                    alt="before"
                    className="mt-1 max-h-20 w-full rounded border border-edge object-cover"
                  />
                </div>
                <div className="rounded-md border border-edge bg-white p-2">
                  <div className="text-[11px] font-semibold text-ink-muted">
                    Hasil (PNG transparan)
                  </div>
                  <div
                    className="mt-1 flex h-20 items-center justify-center rounded border border-edge"
                    style={{
                      background:
                        "repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%) 0 0 / 12px 12px",
                    }}
                  >
                    <img
                      src={cutoutUrl}
                      alt="cutout"
                      className="h-full w-full object-contain"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
