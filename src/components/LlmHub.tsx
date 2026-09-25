"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Dropdown, { type DropdownOption } from "./Dropdown";
import {
  fetchRuntimeStatus,
  searchHf,
  fetchHfDetail,
  fetchLocal,
  startDownload,
  listDownloadJobs,
  subscribeDownloadJob,
  fetchPreset,
  savePreset,
  deleteLocal,
  deletePreset,
  importToOllama,
  fetchConvertStatus,
  convertToGguf,
  setupLlamaCpp,
  fetchSetupStatus,
  type HfModelCard,
  type HfModelDetail,
  type RuntimeStatus,
  type LocalGguf,
  type LlmDownloadJob,
  type Preset,
} from "@/lib/llmApi";
import { isBackendDown, BACKEND_DOWN_HINT } from "@/lib/api";

const CATEGORY_LABEL: Record<string, string> = {
  all: "Semua",
  chat: "Chat Umum",
  code: "Coding",
  instruct: "Instruct",
  reasoning: "Reasoning",
  roleplay: "Roleplay",
  multilingual: "Multilingual",
};

function nfmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function timeAgo(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "hari ini";
  if (days === 1) return "1 hari lalu";
  if (days < 30) return `${days} hari lalu`;
  const months = Math.floor(days / 30);
  return `${months} bln lalu`;
}

const DEFAULT_PRESET: Preset = {
  ctx: 4096, n_batch: 512, n_threads: 0, gpu_layers: -1, use_mmap: true, use_mlock: false,
  temperature: 0.7, top_k: 40, top_p: 0.95, min_p: 0.05, tfs_z: 1.0, typical_p: 1.0,
  repeat_penalty: 1.1, repeat_last_n: 64, presence_penalty: 0, frequency_penalty: 0, penalize_nl: true,
  mirostat: 0, mirostat_tau: 5.0, mirostat_eta: 0.1, seed: -1, n_predict: 512, num_keep: 0,
  stop: [], system_prompt: "", runtime: "auto",
};

export default function LLMHub() {
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [runtimeErr, setRuntimeErr] = useState<string | null>(null);
  const [activeRuntime, setActiveRuntime] = useState<string>("auto");

  const [tab, setTab] = useState<"discover" | "local">("discover");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [quant, setQuant] = useState("");
  const [size, setSize] = useState("all");
  const [sort, setSort] = useState("downloads");
  // GGUF hanya prioritas di filter/galeri — bukan filter eksklusif
  const [ggufPrioritize, setGgufPrioritize] = useState(true);

  const [models, setModels] = useState<HfModelCard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [backendDown, setBackendDown] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HfModelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetTab, setPresetTab] = useState<"sampling" | "penalty" | "performance" | "output">("sampling");

  const [locals, setLocals] = useState<LocalGguf[] | null>(null);
  const [jobs, setJobs] = useState<LlmDownloadJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [convertStatus, setConvertStatus] = useState<{ available: boolean; script: string | null; has_llama_cpp: boolean; staging: string; ollama_dir: string; hint: string; setup?: { status: string; progress: number; log: string[]; error: string | null; done: boolean } } | null>(null);
  const [converting, setConverting] = useState<string | null>(null);
  const [selectedGguf, setSelectedGguf] = useState<string>("");
  const [setupRunning, setSetupRunning] = useState(false);
  const [setupProgress, setSetupProgress] = useState(0);
  const [setupLog, setSetupLog] = useState<string[]>([]);
  const [savedPresets, setSavedPresets] = useState<Record<string, Preset> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);
  // refs untuk infinite scroll agar tidak stale closure
  const modelsRef = useRef<HfModelCard[] | null>(null);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const loadingMoreRef = useRef(false);

  const refreshRuntime = useCallback(async () => {
    setRuntimeErr(null);
    try {
      const s = await fetchRuntimeStatus();
      setRuntime(s);
    } catch (e) {
      setRuntimeErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refreshRuntime();
    const t = setInterval(refreshRuntime, 12000);
    return () => clearInterval(t);
  }, [refreshRuntime]);

  const refreshLocal = useCallback(async () => {
    try {
      const r = await fetchLocal();
      setLocals(r.models);
    } catch { /* ignore */ }
  }, []);

  const refreshConvertStatus = useCallback(async () => {
    try {
      const s = await fetchConvertStatus();
      setConvertStatus(s);
    } catch { /* ignore */ }
  }, []);

  const refreshPresets = useCallback(async () => {
    try {
      const r = await fetch("/api/llm/config").then((x) => x.json());
      // r.config berisi semua preset keyed by model, r.default = default preset
      if (r.config && typeof r.config === "object") {
        const filtered: Record<string, Preset> = {};
        for (const [k, v] of Object.entries(r.config)) {
          if (k === "default") continue;
          if (v && typeof v === "object" && "ctx" in (v as Record<string, unknown>)) filtered[k] = v as Preset;
        }
        setSavedPresets(filtered);
      }
    } catch { /* ignore */ }
  }, []);

  // sync refs
  useEffect(() => { modelsRef.current = models; }, [models]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => { loadingMoreRef.current = loadingMore; }, [loadingMore]);

  const doSearch = useCallback(async (opts?: { reset?: boolean }) => {
    if (tab !== "discover") return;
    const reset = opts?.reset ?? true;
    if (reset) {
      setLoading(true);
      loadingRef.current = true;
      setSearchErr(null);
      try {
        const res = await searchHf({ query, category, quant, size, sort, limit: 10, skip: 0, gguf_only: ggufPrioritize });
        setModels(res.models);
        modelsRef.current = res.models;
        const more = res.models.length === 10;
        setHasMore(more);
        hasMoreRef.current = more;
        setBackendDown(false);
      } catch (e) {
        const down = isBackendDown(e);
        setBackendDown(down);
        setSearchErr(down ? BACKEND_DOWN_HINT : e instanceof Error ? e.message : "Gagal mencari model");
      } finally {
        setLoading(false);
        loadingRef.current = false;
      }
    } else {
      // loadMore via refs — anti stale closure, base 10 per scroll, load terus menerus
      if (loadingMoreRef.current || !hasMoreRef.current || loadingRef.current) return;
      const cur = modelsRef.current;
      if (!cur) return;
      setLoadingMore(true);
      loadingMoreRef.current = true;
      try {
        const curLen = cur.length;
        const seen = new Set(cur.map((m) => m.id));
        let next: HfModelCard[] = [];
        let resLen = 0;
        let limitForThisLoad = 10;
        // Strategi: HF per-request max 60 (server/llm.py:187 limit le=60), tapi total maksimal = sesuai HF (ribuan).
        // Untuk atasi HF skip yang kadang diabaikan, pakai growing-limit (limit=curLen+10, skip=0) sampai 60,
        // setelah itu pakai skip=curLen, limit=10 terus-menerus sampai HF return <10 (habis). Total tidak dibatasi 60.
        if (curLen + 10 <= 60) {
          const growLimit = curLen + 10;
          limitForThisLoad = growLimit;
          const res = await searchHf({ query, category, quant, size, sort, limit: growLimit, skip: 0, gguf_only: ggufPrioritize });
          resLen = res.models.length;
          const filtered = res.models.filter((m) => !seen.has(m.id));
          // Ambil maksimal 10 untuk jaga base 10 per scroll (walau kadang filtered bisa >10 karena sorting lokal)
          next = filtered.slice(0, 10);
          // fallback: jika filtered kosong tapi HF masih return full, coba pakai skip method
          if (next.length === 0 && resLen === growLimit) {
            const res2 = await searchHf({ query, category, quant, size, sort, limit: 10, skip: curLen, gguf_only: ggufPrioritize });
            resLen = res2.models.length;
            limitForThisLoad = 10;
            next = res2.models.filter((m) => !seen.has(m.id));
          }
        } else {
          // sudah >=60, pakai skip normal — paginasi unlimited sampai HF habis (maksimal sesuai HF, bukan 60)
          const res = await searchHf({ query, category, quant, size, sort, limit: 10, skip: curLen, gguf_only: ggufPrioritize });
          resLen = res.models.length;
          limitForThisLoad = 10;
          next = res.models.filter((m) => !seen.has(m.id));
          // jika HF skip diabaikan lagi di atas 60, fallback ke chunked growing (limit 60 skip curLen-50) biar tetap jalan
          if (next.length === 0 && resLen === 10) {
            const chunkSkip = Math.max(0, curLen - 50);
            const res2 = await searchHf({ query, category, quant, size, sort, limit: 60, skip: chunkSkip, gguf_only: ggufPrioritize });
            const filtered2 = res2.models.filter((m) => !seen.has(m.id));
            if (filtered2.length > 0) {
              next = filtered2.slice(0, 10);
              resLen = res2.models.length;
              limitForThisLoad = 60;
            }
          }
        }
        if (next.length === 0) {
          // benar-benar habis
          const more = resLen === limitForThisLoad ? false : false;
          // jika HF return < limit → sudah habis
          if (resLen < limitForThisLoad) {
            setHasMore(false);
            hasMoreRef.current = false;
          } else {
            // HF return penuh tapi semua duplikat → anggap habis untuk cegah infinite loop
            setHasMore(false);
            hasMoreRef.current = false;
          }
        } else {
          setModels((prev) => {
            const merged = prev ? [...prev, ...next] : next;
            modelsRef.current = merged;
            return merged;
          });
          // masih ada lagi jika HF return penuh (limit terpenuhi)
          const more = resLen === limitForThisLoad;
          // khusus growing-limit: jika minta 20 dapat 20 → masih ada; jika <20 → habis
          setHasMore(more);
          hasMoreRef.current = more;
          // edge: jika next <10 tapi res penuh, mungkin masih ada → biarkan hasMore true untuk coba load lagi
          if (next.length > 0 && next.length < 10 && resLen === limitForThisLoad) {
            setHasMore(true);
            hasMoreRef.current = true;
          }
        }
      } catch {
        // biarkan retry via tombol / scroll lagi
      } finally {
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, [query, category, quant, size, sort, ggufPrioritize, tab]);

  useEffect(() => { if (tab === "discover") void doSearch({ reset: true }); if (tab === "local") { void refreshLocal(); void refreshConvertStatus(); void refreshPresets(); } }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === "local") void refreshLocal(); }, [jobs, refreshLocal]);
  // refresh preset saat tab local dibuka
  useEffect(() => { if (tab === "local") void refreshPresets(); }, [tab, refreshPresets]);

  // Infinite scroll: sentinel + layout scroll container (main.overflow-y-auto) — base 10, scroll terus load 10 lagi
  useEffect(() => {
    if (tab !== "discover") return;
    const el = loadMoreRef.current;
    if (!el) return;
    // WAJIB pakai layout main yang punya overflow-y-auto, bukan inner main; fallback ke viewport jika tidak ketemu
    const scrollRoot = document.querySelector("main.overflow-y-auto") as HTMLElement | null;
    let ticking = false;
    let disconnected = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (disconnected) return;
        if (ticking) return;
        if (!hasMoreRef.current || loadingRef.current || loadingMoreRef.current) return;
        if (entries[0]?.isIntersecting) {
          ticking = true;
          void doSearch({ reset: false });
          setTimeout(() => { ticking = false; }, 700);
        }
      },
      { root: scrollRoot, rootMargin: "500px", threshold: 0 }
    );
    io.observe(el);
    // juga observe ulang saat models bertambah agar sentinel baru ter-track
    return () => { disconnected = true; io.disconnect(); };
  }, [tab, doSearch]);
  // Auto-load jika konten masih pendek (mis. tinggi < viewport) — langsung load lagi tanpa tunggu scroll
  useEffect(() => {
    if (tab !== "discover" || !models || models.length === 0) return;
    if (!hasMore || loading || loadingMore) return;
    const scrollEl = document.querySelector("main.overflow-y-auto") as HTMLElement | null;
    if (!scrollEl) return;
    // jika scrollHeight masih dekat clientHeight, trigger loadMore lagi
    if (scrollEl.scrollHeight <= scrollEl.clientHeight + 300) {
      void doSearch({ reset: false });
    }
  }, [models, hasMore, loading, loadingMore, tab, doSearch]);

  // Fallback scroll listener untuk container yang tidak support IntersectionObserver root
  useEffect(() => {
    if (tab !== "discover") return;
    const scrollEl = document.querySelector("main.overflow-y-auto") as HTMLElement | null;
    if (!scrollEl) return;
    const onScroll = () => {
      if (!hasMoreRef.current || loadingRef.current || loadingMoreRef.current) return;
      if (scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 350) {
        void doSearch({ reset: false });
      }
    };
    let t: number | undefined;
    const throttled = () => {
      if (t) return;
      t = window.setTimeout(() => { t = undefined; onScroll(); }, 300);
    };
    scrollEl.addEventListener("scroll", throttled, { passive: true });
    return () => scrollEl.removeEventListener("scroll", throttled);
  }, [tab, doSearch]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await listDownloadJobs();
        if (!alive) return;
        setJobs(r.jobs);
      } catch { /* ignore */ }
    };
    poll();
    const t = setInterval(poll, 2500);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!activeJobId) return;
    const stop = subscribeDownloadJob(activeJobId, {
      onEvent: (j) => setJobs((prev) => {
        const idx = prev.findIndex((x) => x.job_id === j.job_id);
        if (idx >= 0) { const c = [...prev]; c[idx] = j; return c; }
        return [j, ...prev];
      }),
      onError: () => {},
    });
    return stop;
  }, [activeJobId]);

  const openDetail = async (id: string) => {
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    setSelectedGguf("");
    try {
      const d = await fetchHfDetail(id);
      setDetail(d);
      if (d.gguf_files.length > 0) setSelectedGguf(d.gguf_files[0].filename);
      try {
        const p = await fetchPreset(id);
        setPreset({ ...DEFAULT_PRESET, ...(p.config as Preset) });
      } catch {
        setPreset({ ...DEFAULT_PRESET, runtime: activeRuntime });
      }
    } catch (e) {
      setDetail({ id, author: id.split("/")[0], tags: [], likes: 0, downloads: 0, lastModified: "", description: e instanceof Error ? e.message : "Gagal memuat detail", cardData: {}, gguf_files: [], all_siblings: 0 });
      setPreset({ ...DEFAULT_PRESET, runtime: activeRuntime });
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDownload = async (repo: string, filename: string) => {
    try {
      const r = await startDownload(repo, filename);
      setActiveJobId(r.job_id);
      setJobs((prev) => [{ id: r.job_id, job_id: r.job_id, repo, filename, dest: "", status: "queued", progress: 0, done_bytes: 0, total_bytes: 0, done_human: "0 B", total_human: "—", rate_human: null, rate_bps: null, eta_seconds: null, error: null, log: [], created_at: Date.now() / 1000 } as LlmDownloadJob, ...prev]);
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
  };

  const handleSavePreset = async () => {
    if (!detailId || !preset) return;
    setSavingPreset(true);
    try {
      await savePreset(detailId, preset);
      await refreshPresets();
      // Konfirmasi ke user bahwa preset sudah masuk Tab Lokal
      // tidak pakai alert biar tidak mengganggu; tampilkan sementara di UI via savedPresets
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setSavingPreset(false); }
  };

  const handleDeleteLocal = (repo: string, filename: string) => {
    setConfirmDelete({
      title: "Hapus Model GGUF?",
      message: `Apakah benar mau dihapus?\n${repo}/${filename}\nFile di server/storage/llm akan dihapus permanen.`,
      confirmLabel: "Hapus",
      onConfirm: async () => {
        setConfirmDelete(null);
        try { await deleteLocal(repo, filename); void refreshLocal(); } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
      },
    });
  };

  const handleDeletePreset = (repo: string) => {
    setConfirmDelete({
      title: "Hapus Preset?",
      message: `Apakah benar mau dihapus preset untuk ${repo}? Preset tersimpan di server/storage/llm/runtime_config.json akan dihapus permanen.`,
      confirmLabel: "Hapus",
      onConfirm: async () => {
        setConfirmDelete(null);
        try { await deletePreset(repo); void refreshPresets(); } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
      },
    });
  };

  const handleExportOllama = async (repo: string, filename: string) => {
    const name = repo.split("/").pop()?.toLowerCase().replace(/[^a-z0-9._-]/g, "-") || "model";
    if (!confirm(`Export ${repo}/${filename} ke Ollama sebagai "${name}"?\n\nKonsep: file tetap di staging server/storage/llm, lalu dibuat Modelfile (FROM + ctx/temperature dari preset) dan dijalankan "ollama create ${name}".\nJika belum GGUF, konversi dulu via llama.cpp.`)) return;
    setExporting(`${repo}/${filename}`);
    try {
      const r = await importToOllama(repo, filename, name);
      alert(`Berhasil export ke Ollama: ${r.imported}\nModelfile:\n${r.modelfile}\n\nCek dengan: ollama list`);
      void refreshRuntime();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setExporting(null); }
  };

  const handleConvert = async (repo: string) => {
    if (!convertStatus?.available) {
      if (!confirm(`llama.cpp belum siap. Jalankan Setup otomatis dulu?\nAkan clone https://github.com/ggerganov/llama.cpp ke vendor/llama (atau download convert script) agar bisa konversi lokal.`)) return;
      await handleSetupLlama();
      return;
    }
    if (!confirm(`Konversi ${repo} (safetensors) ke GGUF via llama.cpp?\nIni butuh vendor/llama/convert_hf_to_gguf.py dan akan memakan waktu.`)) return;
    setConverting(repo);
    try {
      const r = await convertToGguf(repo);
      alert(`Berhasil konversi: ${r.converted} (${r.size_human})`);
      void refreshLocal();
      void refreshConvertStatus();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setConverting(null); }
  };

  const handleSetupLlama = async () => {
    if (setupRunning) return;
    setSetupRunning(true);
    setSetupProgress(5);
    setSetupLog(["Memulai setup llama.cpp…"]);
    try {
      await setupLlamaCpp();
      // polling status tiap 800ms sampai done/error
      let done = false;
      let tries = 0;
      while (!done && tries < 250) {
        tries++;
        await new Promise((r) => setTimeout(r, 800));
        try {
          const s = await fetchSetupStatus();
          setSetupProgress(s.progress ?? 0);
          if (s.log) setSetupLog(s.log.slice(-12));
          if (s.status === "done") {
            done = true;
            await refreshConvertStatus();
            // juga sync convertStatus langsung
            setSetupLog((prev) => [...prev, "Setup selesai ✓"]);
          } else if (s.status === "error") {
            done = true;
            alert(`Setup gagal: ${s.error || "unknown"}\nLog:\n${(s.log || []).slice(-8).join("\n")}`);
          }
          // update convertStatus dari setup status
          setConvertStatus((prev) => prev ? { ...prev, available: !!s.available, script: s.script, setup: { status: s.status, progress: s.progress, log: s.log, error: s.error, done: !!s.done } } : prev);
        } catch {
          // ignore polling error
        }
        if (convertStatus?.available) { /* will be updated via refresh */ }
      }
      await refreshConvertStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Deteksi endpoint belum ada di backend (backend belum di-restart setelah tambah route)
      const is404 = /not found|404/i.test(msg) || (e instanceof TypeError && /fetch|failed/i.test(msg));
      alert(
        is404
          ? `Endpoint setup belum tersedia di backend (${msg}).\nBackend masih menjalankan kode lama — harap RESTART backend dulu (mis. tombol restart server di sidebar atau \`node scripts/restart.mjs\` / \`npm restart waves\`), lalu klik Setup lagi.`
          : msg,
      );
    } finally {
      setSetupRunning(false);
    }
  };

  const quantOptions: DropdownOption[] = useMemo(() => [{ id: "", label: "Semua Quant" }, ...["Q2_K", "Q3_K_M", "Q4_0", "Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "F16"].map((q) => ({ id: q, label: q }))], []);
  const sizeOptions: DropdownOption[] = useMemo(() => [{ id: "all", label: "Semua Ukuran" }, { id: "1b-3b", label: "< 4B" }, { id: "7b", label: "7–8B" }, { id: "13b", label: "13B" }, { id: "30b+", label: "30B+" }], []);
  const sortOptions: DropdownOption[] = useMemo(() => [{ id: "downloads", label: "Paling Banyak Diunduh" }, { id: "likes", label: "Paling Disukai" }, { id: "trending", label: "Terbaru / Trending" }], []);
  const runtimeOptions: DropdownOption[] = useMemo(() => [{ id: "auto", label: "Autodetect (Ollama)" }, { id: "ollama", label: "Ollama" }, { id: "local", label: "Simpan Lokal" }], []);

  const ollamaOnline = runtime?.ollama.online;

  return (
    <main className="w-full pb-12">
      <div className="mb-1 text-sm font-semibold">
        LLM Hub (GGUF)
        {ollamaOnline && (
          <span className="label bg-canvas-inset text-ink-muted ml-1">
            Ollama
          </span>
        )}
      </div>
      <div className="mb-4 text-xs leading-relaxed text-ink-muted">
        Jelajahi model Hugging Face,{" "}
        <span className="font-medium">GGUF diprioritaskan di galeri</span>.
        Filter kategori &amp; kuantisasi, unduh GGUF ke{" "}
        <code className="mono">server/storage/llm</code> sebagai staging, lalu
        export ke Ollama (<code className="mono">~/.ollama</code>).
      </div>

      {backendDown && searchErr && (
        <div className="mb-4 rounded-md border border-edge bg-red-50 px-4 py-3 text-[12px] text-red-600">
          {searchErr}
        </div>
      )}

      <div className="w-full mb-3 flex gap-1 rounded-md border border-edge bg-canvas-subtle p-1">
        <button
          onClick={() => setTab("discover")}
          className={`w-full rounded px-3 py-1.5 text-xs font-medium ${tab === "discover" ? "bg-white shadow-sm" : "text-ink-muted hover:text-ink"}`}
        >
          Jelajahi
        </button>
        <button
          onClick={() => setTab("local")}
          className={`w-full rounded px-3 py-1.5 text-xs font-medium ${tab === "local" ? "bg-white shadow-sm" : "text-ink-muted hover:text-ink"}`}
        >
          Lokal {locals ? `· ${locals.length}` : ""}
        </button>
      </div>

      {tab === "discover" && (
        <>
          <div className="card mb-4 p-4 space-y-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void doSearch({ reset: true });
              }}
              className="flex flex-col gap-2.5 lg:flex-row lg:items-end"
            >
              <div className="flex-1">
                <label className="mb-1 block text-xs font-semibold text-ink-muted">
                  Cari model
                </label>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="cth. qwen, llama 3, mistral, coder…"
                  className="w-full rounded-md border border-edge bg-canvas-subtle px-3 py-2 text-[13px] h-10"
                />
              </div>
              <div className="flex gap-2">
                <Dropdown
                  label="Urutkan"
                  value={sort}
                  options={sortOptions}
                  onChange={setSort}
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary w-40 h-10 lg:self-end"
                disabled={loading}
              >
                {loading ? "Mencari…" : "Cari"}
              </button>
            </form>
          </div>
          <div className="card mb-4 p-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Dropdown
                label="Kuantisasi"
                value={quant}
                options={quantOptions}
                onChange={setQuant}
                placeholder="Semua Quant"
              />
              <Dropdown
                label="Ukuran"
                value={size}
                options={sizeOptions}
                onChange={setSize}
                placeholder="Semua Ukuran"
              />
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-muted">
                  Prioritas galeri
                </label>
                <label className="flex h-10 items-center gap-2 rounded-md border border-edge bg-white px-3 text-[13px] cursor-pointer hover:bg-canvas-subtle transition-colors">
                  <input
                    type="checkbox"
                    checked={ggufPrioritize}
                    onChange={(e) => setGgufPrioritize(e.target.checked)}
                    className="accent-ink"
                  />
                  <span className="font-medium whitespace-nowrap">
                    Prioritaskan GGUF
                  </span>
                  <span className="ml-auto hidden sm:inline text-[11px] text-ink-muted whitespace-nowrap">
                    GGUF di atas, non-GGUF tetap muncul
                  </span>
                  <span className="ml-auto sm:hidden text-[10px] text-ink-muted">
                    GGUF first
                  </span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1.5">
                <div className="mb-1.5 text-xs font-semibold text-ink-muted">
                  Kategori
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(CATEGORY_LABEL).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setCategory(id)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${category === id ? "border-ink bg-ink text-white" : "border-edge bg-white text-ink-muted hover:bg-canvas-subtle"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => void doSearch({ reset: true })}
                className="btn w-40 h-9 mt-4 shrink-0 text-xs"
                disabled={loading}
              >
                Terapkan Filter
              </button>
            </div>
          </div>

          {jobs.length > 0 && (
            <div className="card mb-4 p-3">
              <div className="mb-2 text-xs font-semibold text-ink-muted">
                Unduhan aktif
              </div>
              <div className="space-y-2">
                {jobs.slice(0, 4).map((j) => (
                  <div
                    key={j.job_id}
                    className="flex items-center gap-3 rounded-md border border-edge bg-canvas-subtle px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">
                        {j.repo}/{j.filename}
                      </div>
                      <div className="mono text-[11px] text-ink-muted">
                        {j.progress.toFixed(1)}% · {j.done_human} /{" "}
                        {j.total_human}{" "}
                        {j.rate_human ? `· ${j.rate_human}` : ""}{" "}
                        {j.eta_seconds
                          ? `· ETA ${Math.round(j.eta_seconds)}s`
                          : ""}
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white">
                        <div
                          className="h-full bg-ink transition-all"
                          style={{ width: `${Math.min(j.progress, 100)}%` }}
                        />
                      </div>
                    </div>
                    <span
                      className={`label flex-shrink-0 ${j.status === "done" ? "bg-emerald-600 text-white" : j.status === "error" ? "bg-red-600 text-white" : "bg-ink text-white"}`}
                    >
                      {j.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {searchErr && !backendDown && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {searchErr}
            </div>
          )}
          {loading && (
            <div className="flex items-center gap-2 py-6 text-xs text-ink-muted">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-ink-muted border-t-transparent" />{" "}
              Memuat dari Hugging Face…
            </div>
          )}
          {!loading && models && models.length === 0 && (
            <div className="card p-6 text-center text-sm text-ink-muted">
              Tidak ada model. Coba longgarkan filter.
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {(models || []).map((m) => {
              const isGguf =
                (m as unknown as { is_gguf?: boolean }).is_gguf ??
                m.gguf_files > 0;
              return (
                <div
                  key={m.id}
                  className={`card flex flex-col p-4 hover:shadow-float transition-shadow ${isGguf ? "border-ink/20" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-sm font-bold ${isGguf ? "bg-ink text-white" : "bg-canvas-inset text-ink"}`}
                    >
                      {m.author
                        ? m.author.charAt(0).toUpperCase()
                        : m.id.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold leading-tight">
                        {m.id}
                      </div>
                      <div className="truncate text-[11px] text-ink-muted">
                        oleh {m.author || "—"} · {m.size_hint || "?"} · ctx{" "}
                        {m.ctx_hint}
                      </div>
                    </div>
                  </div>
                  <div
                    className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-ink-muted"
                    title={m.description}
                  >
                    {m.description}
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {m.quants.slice(0, 4).map((q) => (
                      <span
                        key={q}
                        className="label bg-white border-edge text-[10px]"
                      >
                        {q}
                      </span>
                    ))}
                    {m.tags.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className="label bg-canvas-subtle text-[10px] text-ink-muted"
                      >
                        {t}
                      </span>
                    ))}
                    {m.pipeline_tag && (
                      <span className="label bg-white border-edge text-[10px]">
                        {m.pipeline_tag}
                      </span>
                    )}
                    {isGguf && (
                      <span className="label bg-emerald-50 border-emerald-200 text-emerald-700 text-[10px]">
                        GGUF
                      </span>
                    )}
                    {!isGguf && (
                      <span className="label bg-amber-50 border-amber-200 text-amber-700 text-[10px]">
                        non-GGUF
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-ink-muted">
                    <span>{nfmt(m.downloads)} unduhan</span>
                    <span>· ♥ {nfmt(m.likes)}</span>
                    <span>· {timeAgo(m.lastModified)}</span>
                    {m.siblings_preview[0] && (
                      <span className="mono truncate">
                        · {m.siblings_preview[0]}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t border-edge-soft pt-3">
                    <button
                      onClick={() => void openDetail(m.id)}
                      className="btn btn-primary flex-1 text-xs"
                    >
                      Lihat &amp; Unduh
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Infinite scroll sentinel — maksimal 10 per load */}
          <div ref={loadMoreRef} className="h-1" aria-hidden />
          {loadingMore && (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-ink-muted">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-ink-muted border-t-transparent" />{" "}
              Memuat Model…
            </div>
          )}
          {!loading &&
            !loadingMore &&
            models &&
            models.length > 0 &&
            !hasMore && (
              <div className="py-3 text-center text-[11px] text-ink-muted">
                Semua {models.length} Model Ditampilkan.
              </div>
            )}
          {!loading &&
            hasMore &&
            models &&
            models.length > 0 &&
            !loadingMore && (
              <div className="flex justify-center py-2">
                <button
                  onClick={() => void doSearch({ reset: false })}
                  className="btn w-40 text-xs"
                >
                  Muat Kembali
                </button>
              </div>
            )}
        </>
      )}

      {tab === "local" && (
        <div className="space-y-4">
          {/* Preset tersimpan — konfirmasi Simpan Preset masuk ke sini */}
          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold">
                Preset Tersimpan{" "}
                <span className="font-normal text-ink-muted">
                  — dari Simpan Preset di detail (runtime_config.json)
                </span>
              </div>
              <button
                onClick={() => void refreshPresets()}
                className="btn w-40 text-xs"
              >
                Muat ulang
              </button>
            </div>
            <div className="mb-3 rounded-md border border-edge bg-canvas-subtle p-3 text-[11px] leading-relaxed text-ink-muted">
              <span className="font-semibold">
                <code className="mono">Simpan Preset</code>
              </span>{" "}
              di detail akan menyimpan ke{" "}
              <span className="font-medium">Tab Lokal → Preset tersimpan</span>{" "}
              (file{" "}
              <code className="mono">
                server/storage/llm/runtime_config.json
              </code>{" "}
              per model). Preset dipakai saat{" "}
              <span className="font-medium">Export ke Ollama</span> (ctx,
              temperature, top_p, dll → Modelfile PARAMETER).
            </div>
            {!savedPresets && (
              <div className="py-3 text-center text-xs text-ink-muted">
                Memuat Preset…
              </div>
            )}
            {savedPresets && Object.keys(savedPresets).length === 0 && (
              <div className="rounded-md border border-dashed border-edge px-4 py-6 text-center text-xs leading-relaxed text-ink-muted">
                Belum ada preset. Buka model di{" "}
                <span className="font-medium">
                  Jelajahi → Lihat &amp; Unduh → Simpan Preset
                </span>
                , maka akan muncul di sini per model.
              </div>
            )}
            {savedPresets && Object.keys(savedPresets).length > 0 && (
              <div className="space-y-2">
                {Object.entries(savedPresets).map(([repo, cfg]) => {
                  const isGgufLocal = locals?.some((l) => l.repo === repo);
                  const isConverting = converting === repo;
                  return (
                    <div
                      key={repo}
                      className="flex flex-col gap-2 rounded-md border border-edge bg-canvas-subtle px-3 py-2.5 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">
                          {repo}
                        </div>
                        <div className="mono text-[11px] text-ink-muted">
                          ctx {cfg.ctx} · temp {cfg.temperature} · top_p{" "}
                          {cfg.top_p} · top_k {cfg.top_k} · repeat{" "}
                          {cfg.repeat_penalty} · n_predict {cfg.n_predict}{" "}
                          {isGgufLocal ? "· GGUF ✓" : "· belum GGUF"}
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0 items-center">
                        {!isGgufLocal ? (
                          <>
                            {!convertStatus?.available ? (
                              <button
                                onClick={() => void handleSetupLlama()}
                                disabled={setupRunning}
                                className="btn w-40 text-xs border-amber-300 bg-white hover:bg-amber-50 disabled:opacity-50"
                              >
                                {setupRunning
                                  ? `Setup ${setupProgress}%…`
                                  : "Setup llama.cpp"}
                              </button>
                            ) : (
                              <button
                                onClick={() => void handleConvert(repo)}
                                disabled={isConverting}
                                className="btn text-xs border-amber-300 bg-white hover:bg-amber-50 disabled:opacity-50"
                              >
                                {isConverting
                                  ? "Mengkonversi…"
                                  : "Unduh & Konversi ke GGUF"}
                              </button>
                            )}
                            <button
                              onClick={() => void openDetail(repo)}
                              className="btn btn-primary w-40 text-xs"
                            >
                              Lihat
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="label bg-emerald-50 border-emerald-200 text-emerald-700 text-[11px]">
                              Siap Export
                            </span>
                            <button
                              onClick={() => void openDetail(repo)}
                              className="btn w-40 text-xs"
                            >
                              Lihat
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => void handleDeletePreset(repo)}
                          className="rounded-md border border-red-200 bg-white px-2 py-1.5 text-[12px] font-medium text-red-600 transition-colors hover:bg-red-50"
                          title="Hapus Preset"
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                          >
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {!convertStatus?.available &&
              savedPresets &&
              Object.keys(savedPresets).length > 0 &&
              !setupRunning && (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                  Convert butuh{" "}
                  <code className="mono">
                    vendor/llama/convert_hf_to_gguf.py
                  </code>
                  . Klik <span className="font-medium">Setup llama.cpp</span> di
                  atas untuk clone otomatis (git clone --depth 1, fallback
                  download raw) agar bisa jalan lokal — atau unduh varian GGUF
                  upstream (<code className="mono">TheBloke/*-GGUF</code>).
                </div>
              )}
            {setupRunning &&
              savedPresets &&
              Object.keys(savedPresets).length > 0 && (
                <div className="mt-2 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white">
                    <div
                      className="h-full bg-amber-600 transition-all"
                      style={{ width: `${setupProgress}%` }}
                    />
                  </div>
                  <div className="mono text-[10px] leading-relaxed">
                    {setupLog.slice(-6).join(" · ")}
                  </div>
                </div>
              )}
          </div>

          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-semibold text-ink-muted">
                Model GGUF Terunduh ({locals?.length ?? 0}) — staging di{" "}
                <code className="mono">server/storage/llm</code>
              </div>
              <button
                onClick={() => void refreshLocal()}
                className="btn w-40 text-xs"
              >
                Muat ulang
              </button>
            </div>
            <div className="mb-3 rounded-md border border-edge bg-canvas-subtle p-3 text-[11px] leading-relaxed text-ink-muted">
              Unduhan disimpan dulu di staging{" "}
              <code className="mono">storage/llm</code>. Jika sudah <b>.gguf</b>{" "}
              langsung <b>Export ke Ollama</b> (dibuatkan Modelfile +{" "}
              <code className="mono">ollama create</code> ke{" "}
              <code className="mono">~/.ollama</code>). Untuk model non-GGUF
              (safetensors), <b>Install &amp; Konversi ke GGUF</b> via{" "}
              <code className="mono">llama/convert_hf_to_gguf.py</code> (atau
              cukup unduh GGUF upstream).
            </div>
            {!locals && (
              <div className="py-6 text-center text-xs text-ink-muted">
                Memuat…
              </div>
            )}
            {locals && locals.length === 0 && (
              <div className="rounded-md border border-dashed border-edge px-4 py-8 text-center text-xs leading-relaxed text-ink-muted">
                Belum ada GGUF. Unduh dari tab{" "}
                <span className="font-medium">Jelajahi</span> — file akan
                tersimpan di staging.
              </div>
            )}
            <div className="space-y-2">
              {(locals || []).map((l) => (
                <div
                  key={l.rel}
                  className="flex items-center gap-3 rounded-md border border-edge bg-canvas-subtle px-3 py-2.5"
                >
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-white text-xs font-bold">
                    {l.quant.slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">
                      {l.repo}/{l.filename}
                    </div>
                    <div className="mono text-[11px] text-ink-muted">
                      {l.size_human} · {l.quant} · {l.rel}
                    </div>
                  </div>
                  <button
                    onClick={() => void handleExportOllama(l.repo, l.filename)}
                    disabled={
                      exporting === `${l.repo}/${l.filename}` || !ollamaOnline
                    }
                    className="btn btn-primary text-xs disabled:opacity-50"
                    title={
                      !ollamaOnline
                        ? "Ollama offline — jalankan `ollama serve`"
                        : "Export ke ~/.ollama via ollama create"
                    }
                  >
                    {exporting === `${l.repo}/${l.filename}`
                      ? "Mengekspor…"
                      : "Export ke Ollama"}
                  </button>
                  <button
                    onClick={() => void handleDeleteLocal(l.repo, l.filename)}
                    className="rounded-md border border-red-200 bg-white px-2 py-1.5 text-[12px] font-medium text-red-600 transition-colors hover:bg-red-50"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            {!ollamaOnline && locals && locals.length > 0 && (
              <div className="mt-2 text-[11px] text-amber-700">
                Ollama offline — jalankan{" "}
                <code className="mono">ollama serve</code> agar tombol Export
                aktif. File tetap aman di staging.
              </div>
            )}
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={() => setConfirmDelete(null)} aria-hidden />
          <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-edge bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-edge p-5">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-red-50 text-red-600">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </span>
                {confirmDelete.title}
              </div>
              <button
                onClick={() => setConfirmDelete(null)}
                aria-label="Close"
                className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-ink text-white transition-opacity hover:opacity-80"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5">
              <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">
                {confirmDelete.message}
              </div>
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
                Tindakan ini tidak dapat dibatalkan.
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-edge bg-canvas-subtle p-5">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex items-center justify-center rounded-md border border-edge bg-white w-40 h-9 px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-canvas-subtle"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  const fn = confirmDelete.onConfirm;
                  fn();
                }}
                className="flex items-center justify-center rounded-md bg-red-600 w-40 h-9 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-red-700"
              >
                {confirmDelete.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailId && (
        <div className="fixed inset-0 z-50 flex bg-black/30 p-2 backdrop-blur-[1px]">
          <div
            className="flex-1"
            onClick={() => setDetailId(null)}
            aria-hidden
          />
          <div className="flex w-full max-w-[720px] max-h-[calc(100vh-16px)] m-0.5 flex-col overflow-hidden rounded-xl border border-edge bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-edge px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{detailId}</div>
                <div className="truncate text-xs text-ink-muted">
                  {detail?.author ? `oleh ${detail.author}` : ""}{" "}
                  {detail
                    ? `· ${detail.downloads ?? 0} dl · ♥ ${detail.likes ?? 0}`
                    : ""}
                </div>
              </div>
              <button
                onClick={() => setDetailId(null)}
                className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-ink text-white transition-opacity hover:opacity-80"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-none p-4 space-y-4">
              {detailLoading && (
                <div className="flex items-center gap-2 text-xs text-ink-muted">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-ink-muted border-t-transparent" />{" "}
                  Memuat detail…
                </div>
              )}
              {!detailLoading && detail && (
                <>
                  <div className="rounded-md border border-edge bg-canvas-subtle p-3 text-xs leading-relaxed text-ink-muted">
                    {detail.description || "Tidak ada deskripsi."}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.tags.slice(0, 14).map((t) => (
                      <span
                        key={t}
                        className="label bg-white border-edge text-[11px]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>

                  <div>
                    <div className="mb-1.5 text-xs font-semibold text-ink-muted">
                      File GGUF tersedia ({detail.gguf_files.length}) — pilih
                      quant untuk diunduh
                    </div>
                    {detail.gguf_files.length === 0 ? (
                      <div className="space-y-2">
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                          Tidak ada .gguf terdeteksi (repo non-GGUF /
                          safetensors). Tetap bisa lihat di{" "}
                          <a
                            className="underline"
                            href={`https://huggingface.co/${detail.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            huggingface.co/{detail.id}
                          </a>
                          .
                          <div className="mt-1.5 text-[11px]">
                            Opsi: klik{" "}
                            <span className="font-semibold">Simpan Preset</span>{" "}
                            di bawah — akan masuk ke{" "}
                            <span className="font-semibold">Tab Lokal</span>{" "}
                            sebagai preset (disimpan di{" "}
                            <code className="mono">runtime_config.json</code>).
                            Untuk pakai, unduh varian GGUF-nya (mis.{" "}
                            <code className="mono">TheBloke/*-GGUF</code>) atau
                            konversi via llama.cpp.
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap gap-2 pt-1.5 items-center">
                            {!convertStatus?.available ? (
                              <button
                                onClick={() => void handleSetupLlama()}
                                disabled={setupRunning}
                                className="btn btn-primary text-xs disabled:opacity-50"
                              >
                                {setupRunning
                                  ? `Setup ${setupProgress}%…`
                                  : "Setup llama.cpp (Clone otomatis)"}
                              </button>
                            ) : (
                              <button
                                onClick={() => void handleConvert(detail.id)}
                                disabled={!!converting}
                                className="btn text-xs border-amber-300 bg-amber-50 hover:bg-amber-100 disabled:opacity-50"
                              >
                                {converting === detail.id
                                  ? "Mengkonversi…"
                                  : "Install & Konversi ke GGUF"}
                              </button>
                            )}
                            {!convertStatus?.available && !setupRunning && (
                              <span className="text-[11px] leading-relaxed text-ink-muted">
                                Belum siap — klik Setup untuk clone{" "}
                                <code className="mono">vendor/llama</code>{" "}
                                otomatis (git clone --depth 1, fallback download
                                raw). Setelah siap, tombol konversi akan aktif
                                untuk jalan lokal.
                              </span>
                            )}
                            {convertStatus?.available && (
                              <span className="text-[11px] text-emerald-700">
                                llama.cpp siap — bisa konversi lokal.
                              </span>
                            )}
                          </div>
                          {setupRunning && (
                            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white">
                                <div
                                  className="h-full bg-amber-600 transition-all"
                                  style={{ width: `${setupProgress}%` }}
                                />
                              </div>
                              <div className="mono text-[10px] leading-relaxed text-ink-muted">
                                {setupLog.slice(-6).join(" · ")}
                              </div>
                            </div>
                          )}
                          {convertStatus &&
                            !convertStatus.available &&
                            !setupRunning && (
                              <div className="rounded-md border border-edge bg-canvas-subtle px-3 py-2 text-[11px] leading-relaxed text-ink-muted mono break-all">
                                staging: {convertStatus.staging} • hint:{" "}
                                {convertStatus.hint}
                              </div>
                            )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex gap-2 items-stretch">
                          <div className="flex-1 min-w-0">
                            <Dropdown
                              label=""
                              value={selectedGguf}
                              options={detail.gguf_files.map((f) => ({
                                id: f.filename,
                                label: `${f.quant} — ${f.filename}`,
                              }))}
                              onChange={setSelectedGguf}
                              placeholder="Pilih file GGUF…"
                            />
                          </div>
                          <button
                            onClick={() =>
                              selectedGguf &&
                              void handleDownload(detail.id, selectedGguf)
                            }
                            disabled={!selectedGguf}
                            className="btn btn-primary w-40 h-10 shrink-0 self-end px-5 text-xs disabled:opacity-50"
                          >
                            Unduh
                          </button>
                        </div>
                        <div className="text-[11px] text-ink-muted">
                          Dipilih:{" "}
                          <span className="mono">{selectedGguf || "—"}</span>{" "}
                          {selectedGguf && (
                            <span className="label bg-canvas-inset text-[10px] ml-1">
                              {
                                detail.gguf_files.find(
                                  (f) => f.filename === selectedGguf,
                                )?.quant
                              }
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="mt-1.5 text-[11px] text-ink-muted">
                      Disimpan ke{" "}
                      <code className="mono">
                        server/storage/llm/{detail.id}/&lt;file&gt;.gguf
                      </code>{" "}
                      (staging) → Export ke Ollama.
                    </div>
                  </div>

                  <div className="rounded-md border border-edge p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold">
                        Semua parameter runtime (per-model)
                      </div>
                    </div>
                    <div className="text-[11px] leading-relaxed text-ink-muted">
                      Semua parameter llama.cpp/Ollama — disimpan ke{" "}
                      <code className="mono">
                        server/storage/llm/runtime_config.json
                      </code>{" "}
                      per model dan ada keterangan singkat di tiap field.
                    </div>

                    {preset && (
                      <div className="space-y-4">
                        <div className="rounded-md border border-ink/20 bg-canvas-subtle p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-semibold text-ink">
                              Context length (ctx){" "}
                              <span className="font-normal text-ink-muted">
                                — paling sering dicari
                              </span>
                            </div>
                            <span className="mono rounded bg-white border border-edge px-2 py-0.5 text-xs font-bold">
                              {preset.ctx.toLocaleString("id-ID")} token
                            </span>
                          </div>
                          <input
                            type="range"
                            min={512}
                            max={32768}
                            step={512}
                            value={preset.ctx}
                            onChange={(e) =>
                              setPreset({
                                ...preset,
                                ctx: parseInt(e.target.value),
                              })
                            }
                            className="w-full accent-ink"
                          />
                          <div className="flex justify-between text-[10px] text-ink-subtle">
                            <span>512</span>
                            <span>8K</span>
                            <span>16K</span>
                            <span>32K</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {[2048, 4096, 8192, 16384, 32768].map((v) => (
                              <button
                                key={v}
                                onClick={() => setPreset({ ...preset, ctx: v })}
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${preset.ctx === v ? "border-ink bg-ink text-white" : "border-edge bg-white text-ink-muted hover:bg-canvas-inset"}`}
                              >
                                {v >= 1024 ? `${v / 1024}K` : v}
                              </button>
                            ))}
                          </div>
                          <div className="text-[11px] leading-relaxed text-ink-subtle">
                            Jumlah token konteks (prompt + output) yang dimuat
                            ke memori. Simpan via{" "}
                            <span className="font-medium">Simpan preset</span>{" "}
                            di bawah — tersimpan per-model di{" "}
                            <code className="mono">runtime_config.json</code>.
                          </div>
                        </div>

                        <div className="flex gap-1 rounded-md border border-edge bg-canvas-subtle p-1">
                          {[
                            { id: "sampling", label: "Sampling" },
                            { id: "penalty", label: "Penalty" },
                            { id: "performance", label: "Performa" },
                            { id: "output", label: "Output & Prompt" },
                          ].map((t) => (
                            <button
                              key={t.id}
                              onClick={() =>
                                setPresetTab(t.id as typeof presetTab)
                              }
                              className={`flex-1 rounded px-2 py-1 text-xs font-medium ${presetTab === t.id ? "bg-white shadow-sm" : "text-ink-muted hover:text-ink"}`}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>

                        {presetTab === "sampling" && (
                          <div className="space-y-3">
                            <div>
                              <div className="mb-1 flex justify-between text-[11px] text-ink-muted">
                                <span>Temperature</span>
                                <span className="mono">
                                  {preset.temperature}
                                </span>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={2}
                                step={0.05}
                                value={preset.temperature}
                                onChange={(e) =>
                                  setPreset({
                                    ...preset,
                                    temperature: parseFloat(e.target.value),
                                  })
                                }
                                className="w-full"
                              />
                              <div className="text-[11px] text-ink-subtle">
                                Keacakan output. 0 = deterministik, 2 = sangat
                                kreatif.
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="mb-1 block text-[11px] text-ink-muted">
                                  Top K{" "}
                                  <span className="mono">({preset.top_k})</span>
                                </label>
                                <input
                                  type="number"
                                  value={preset.top_k}
                                  onChange={(e) =>
                                    setPreset({
                                      ...preset,
                                      top_k: parseInt(e.target.value) || 0,
                                    })
                                  }
                                  className="w-full rounded-md border border-edge px-2 py-1 text-xs"
                                />
                                <div className="text-[10px] text-ink-subtle">
                                  Batasi ke K token teratas.
                                </div>
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] text-ink-muted">
                                  Top P{" "}
                                  <span className="mono">({preset.top_p})</span>
                                </label>
                                <input
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={preset.top_p}
                                  onChange={(e) =>
                                    setPreset({
                                      ...preset,
                                      top_p: parseFloat(e.target.value),
                                    })
                                  }
                                  className="w-full"
                                />
                                <div className="text-[10px] text-ink-subtle">
                                  Nucleus sampling.
                                </div>
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] text-ink-muted">
                                  Min P{" "}
                                  <span className="mono">({preset.min_p})</span>
                                </label>
                                <input
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={preset.min_p}
                                  onChange={(e) =>
                                    setPreset({
                                      ...preset,
                                      min_p: parseFloat(e.target.value),
                                    })
                                  }
                                  className="w-full"
                                />
                                <div className="text-[10px] text-ink-subtle">
                                  Ambang probabilitas minimum.
                                </div>
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] text-ink-muted">
                                  Seed{" "}
                                  <span className="mono">({preset.seed})</span>
                                </label>
                                <input
                                  type="number"
                                  value={preset.seed}
                                  onChange={(e) =>
                                    setPreset({
                                      ...preset,
                                      seed: parseInt(e.target.value) || -1,
                                    })
                                  }
                                  className="w-full rounded-md border border-edge px-2 py-1 text-xs"
                                />
                                <div className="text-[10px] text-ink-subtle">
                                  -1 = acak.
                                </div>
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] text-ink-muted">
                                  TFS Z{" "}
                                  <span className="mono">({preset.tfs_z})</span>
                                </label>
                                <input
                                  type="range"
                                  min={0}
                                  max={3.5}
                                  step={0.05}
                                  value={preset.tfs_z}
                                  onChange={(e) =>
                                    setPreset({
                                      ...preset,
                                      tfs_z: parseFloat(e.target.value),
                                    })
                                  }
                                  className="w-full"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] text-ink-muted">
                                  Typical P{" "}
                                  <span className="mono">
                                    ({preset.typical_p})
                                  </span>
                                </label>
                                <input
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={preset.typical_p}
                                  onChange={(e) =>
                                    setPreset({
                                      ...preset,
                                      typical_p: parseFloat(e.target.value),
                                    })
                                  }
                                  className="w-full"
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              <div>
                                <label className="mb-1 block text-[11px] text-ink-muted">
                                  Mirostat
                                </label>
                                <select
                                  value={preset.mirostat}
                                  onChange={(e) =>
                                    setPreset({
                                      ...preset,
                                      mirostat: parseInt(e.target.value),
                                    })
                                  }
                                  className="w-full rounded-md border border-edge px-2 py-1 text-xs"
                                >
                                  <option value={0}>0 (off)</option>
                                  <option value={1}>1</option>
                                  <option value={2}>2</option>
                                </select>
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] text-ink-muted">
                                  Mirostat Tau
                                </label>
                                <input
                                  type="number"
                                  step={0.1}
                                  value={preset.mirostat_tau}
                                  onChange={(e) =>
                                    setPreset({
                                      ...preset,
                                      mirostat_tau:
                                        parseFloat(e.target.value) || 0,
                                    })
                                  }
                                  className="w-full rounded-md border border-edge px-2 py-1 text-xs"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] text-ink-muted">
                                  Mirostat Eta
                                </label>
                                <input
                                  type="number"
                                  step={0.01}
                                  value={preset.mirostat_eta}
                                  onChange={(e) =>
                                    setPreset({
                                      ...preset,
                                      mirostat_eta:
                                        parseFloat(e.target.value) || 0,
                                    })
                                  }
                                  className="w-full rounded-md border border-edge px-2 py-1 text-xs"
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        {presetTab === "penalty" && (
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="mb-1 block text-[11px] text-ink-muted">
                                Repeat penalty{" "}
                                <span className="mono">
                                  ({preset.repeat_penalty})
                                </span>
                              </label>
                              <input
                                type="range"
                                min={0.5}
                                max={2}
                                step={0.05}
                                value={preset.repeat_penalty}
                                onChange={(e) =>
                                  setPreset({
                                    ...preset,
                                    repeat_penalty: parseFloat(e.target.value),
                                  })
                                }
                                className="w-full"
                              />
                              <div className="text-[10px] text-ink-subtle">
                                Cegah pengulangan.
                              </div>
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] text-ink-muted">
                                Repeat last N
                              </label>
                              <input
                                type="number"
                                value={preset.repeat_last_n}
                                onChange={(e) =>
                                  setPreset({
                                    ...preset,
                                    repeat_last_n:
                                      parseInt(e.target.value) || 0,
                                  })
                                }
                                className="w-full rounded-md border border-edge px-2 py-1 text-xs"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] text-ink-muted">
                                Presence penalty
                              </label>
                              <input
                                type="range"
                                min={-2}
                                max={2}
                                step={0.1}
                                value={preset.presence_penalty}
                                onChange={(e) =>
                                  setPreset({
                                    ...preset,
                                    presence_penalty: parseFloat(
                                      e.target.value,
                                    ),
                                  })
                                }
                                className="w-full"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] text-ink-muted">
                                Frequency penalty
                              </label>
                              <input
                                type="range"
                                min={-2}
                                max={2}
                                step={0.1}
                                value={preset.frequency_penalty}
                                onChange={(e) =>
                                  setPreset({
                                    ...preset,
                                    frequency_penalty: parseFloat(
                                      e.target.value,
                                    ),
                                  })
                                }
                                className="w-full"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="flex items-center gap-2 text-xs">
                                <input
                                  type="checkbox"
                                  checked={preset.penalize_nl}
                                  onChange={(e) =>
                                    setPreset({
                                      ...preset,
                                      penalize_nl: e.target.checked,
                                    })
                                  }
                                />{" "}
                                Penalize newline
                              </label>
                              <div className="text-[10px] text-ink-subtle">
                                Terapkan penalty ke token newline.
                              </div>
                            </div>
                          </div>
                        )}

                        {presetTab === "performance" && (
                          <div className="space-y-3">
                            <div>
                              <div className="mb-1 flex justify-between text-[11px] text-ink-muted">
                                <span>Context length (ctx)</span>
                                <span className="mono">{preset.ctx}</span>
                              </div>
                              <input
                                type="range"
                                min={512}
                                max={32768}
                                step={512}
                                value={preset.ctx}
                                onChange={(e) =>
                                  setPreset({
                                    ...preset,
                                    ctx: parseInt(e.target.value),
                                  })
                                }
                                className="w-full"
                              />
                              <div className="flex justify-between text-[10px] text-ink-subtle">
                                <span>512</span>
                                <span>8K</span>
                                <span>16K</span>
                                <span>32K</span>
                              </div>
                              <div className="text-[11px] text-ink-subtle">
                                Jumlah token konteks yang dimuat ke memori.
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="mb-1 block text-[11px] text-ink-muted">
                                  N batch
                                </label>
                                <input
                                  type="number"
                                  value={preset.n_batch}
                                  onChange={(e) =>
                                    setPreset({
                                      ...preset,
                                      n_batch: parseInt(e.target.value) || 0,
                                    })
                                  }
                                  className="w-full rounded-md border border-edge px-2 py-1 text-xs"
                                />
                                <div className="text-[10px] text-ink-subtle">
                                  Batch prompt (512 default).
                                </div>
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] text-ink-muted">
                                  Threads (0=auto)
                                </label>
                                <input
                                  type="number"
                                  value={preset.n_threads}
                                  onChange={(e) =>
                                    setPreset({
                                      ...preset,
                                      n_threads: parseInt(e.target.value) || 0,
                                    })
                                  }
                                  className="w-full rounded-md border border-edge px-2 py-1 text-xs"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] text-ink-muted">
                                  GPU layers (-1=auto)
                                </label>
                                <input
                                  type="number"
                                  value={preset.gpu_layers}
                                  onChange={(e) =>
                                    setPreset({
                                      ...preset,
                                      gpu_layers: parseInt(e.target.value) || 0,
                                    })
                                  }
                                  className="w-full rounded-md border border-edge px-2 py-1 text-xs"
                                />
                                <div className="text-[10px] text-ink-subtle">
                                  Offload ke GPU; -1 = semua.
                                </div>
                              </div>
                              <div className="space-y-1">
                                <label className="flex items-center gap-1.5 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={preset.use_mmap}
                                    onChange={(e) =>
                                      setPreset({
                                        ...preset,
                                        use_mmap: e.target.checked,
                                      })
                                    }
                                  />{" "}
                                  use_mmap
                                </label>
                                <label className="flex items-center gap-1.5 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={preset.use_mlock}
                                    onChange={(e) =>
                                      setPreset({
                                        ...preset,
                                        use_mlock: e.target.checked,
                                      })
                                    }
                                  />{" "}
                                  use_mlock
                                </label>
                              </div>
                            </div>
                          </div>
                        )}

                        {presetTab === "output" && (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="mb-1 block text-[11px] text-ink-muted">
                                  N predict (max tokens)
                                </label>
                                <input
                                  type="number"
                                  value={preset.n_predict}
                                  onChange={(e) =>
                                    setPreset({
                                      ...preset,
                                      n_predict: parseInt(e.target.value) || 0,
                                    })
                                  }
                                  className="w-full rounded-md border border-edge px-2 py-1 text-xs"
                                />
                                <div className="text-[10px] text-ink-subtle">
                                  -1 = tak terbatas.
                                </div>
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] text-ink-muted">
                                  Num keep
                                </label>
                                <input
                                  type="number"
                                  value={preset.num_keep}
                                  onChange={(e) =>
                                    setPreset({
                                      ...preset,
                                      num_keep: parseInt(e.target.value) || 0,
                                    })
                                  }
                                  className="w-full rounded-md border border-edge px-2 py-1 text-xs"
                                />
                                <div className="text-[10px] text-ink-subtle">
                                  Token awal yang dipertahankan.
                                </div>
                              </div>
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] text-ink-muted">
                                Stop sequences (pisahkan koma)
                              </label>
                              <input
                                value={preset.stop.join(", ")}
                                onChange={(e) =>
                                  setPreset({
                                    ...preset,
                                    stop: e.target.value
                                      .split(",")
                                      .map((s) => s.trim())
                                      .filter(Boolean),
                                  })
                                }
                                placeholder="mis. <|im_end|>, <|end|>"
                                className="w-full rounded-md border border-edge px-2 py-1.5 text-xs"
                              />
                              <div className="text-[10px] text-ink-subtle">
                                Sequensi yang menghentikan generasi.
                              </div>
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] text-ink-muted">
                                System prompt
                              </label>
                              <textarea
                                value={preset.system_prompt}
                                onChange={(e) =>
                                  setPreset({
                                    ...preset,
                                    system_prompt: e.target.value,
                                  })
                                }
                                rows={3}
                                placeholder="Kamu adalah asisten yang membantu…"
                                className="w-full rounded-md border border-edge px-2 py-1.5 text-xs"
                              />
                              <div className="text-[10px] text-ink-subtle">
                                Prompt sistem untuk agent (disimpan per model).
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="flex flex-col gap-2 border-t border-edge-soft pt-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => void handleSavePreset()}
                              disabled={savingPreset}
                              className="btn btn-primary w-40 text-xs"
                            >
                              {savingPreset ? "Menyimpan…" : "Simpan Preset"}
                            </button>
                            <span className="text-[11px] text-ink-muted">
                              ctx {preset.ctx} · temp {preset.temperature} ·
                              top_p {preset.top_p}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
