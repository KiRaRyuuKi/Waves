"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchCoderStacks,
  fetchCoderConfig,
  fetchCoderRawConfig,
  saveCoderConfig,
  saveCoderRawConfig,
  generateCoderCode,
  type CoderStack,
  type CoderProvider,
  type CoderStackInfo,
  type CoderConfigStatus,
} from "@/lib/coderApi";
import Dropdown, { type DropdownOption } from "./Dropdown";

const STACK_ICON: Record<string, string> = {
  html_tailwind: "◈",
  html_css: "⬡",
  react_tailwind: "⚛",
  vue_tailwind: "⬢",
  bootstrap: "⬣",
  ionic_tailwind: "◆",
};

const PROVIDER_META: Record<
  string,
  { label: string; placeholder: string; models: string[] }
> = {
  openai: {
    label: "OpenAI",
    placeholder: "sk-... / gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
  },
  anthropic: {
    label: "Anthropic",
    placeholder: "sk-ant-... / claude-sonnet-4-20240620",
    models: ["claude-sonnet-4-20240620", "claude-3-5-sonnet-20241022"],
  },
  gemini: {
    label: "Gemini",
    placeholder: "AIza... / gemini-3.6-flash",
    models: ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.1-pro-preview"],
  },
  ollama: {
    label: "Ollama (Lokal)",
    placeholder: "qwen2.5vl:7b / llava:13b",
    models: ["qwen2.5vl:7b", "llava:13b", "gemma3:12b"],
  },
};

export default function ScreenCoder() {
  const [stacks, setStacks] = useState<CoderStackInfo[] | null>(null);
  const [stack, setStack] = useState<CoderStack>("html_tailwind");
  const [provider, setProvider] = useState<CoderProvider>("auto");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [image, setImage] = useState<{ name: string; dataUrl: string } | null>(
    null,
  );
  const [imageError, setImageError] = useState<string | null>(null);

  const [config, setConfig] = useState<CoderConfigStatus | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [configSaving, setConfigSaving] = useState<string | null>(null);
  const [configInputs, setConfigInputs] = useState<Record<string, string>>({});
  const [configBaseUrl, setConfigBaseUrl] = useState("");
  const [rawEditorOpen, setRawEditorOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [rawPath, setRawPath] = useState("server/storage/coder/config.json");
  const [rawSaving, setRawSaving] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);
  const [rawLoading, setRawLoading] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [code, setCode] = useState<string>("");
  const [raw, setRaw] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [copied, setCopied] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [showRefine, setShowRefine] = useState(false);

  useEffect(() => {
    fetchCoderStacks()
      .then(setStacks)
      .catch(() => {});
    fetchCoderConfig()
      .then((c) => {
        setConfig(c);
        if (c.openai_base_url) setConfigBaseUrl(c.openai_base_url);
      })
      .catch(() => {});
  }, []);

  const providerOptions: DropdownOption[] = useMemo(
    () => [
      {
        id: "auto",
        label: "Auto (deteksi)",
        icon: <span className="text-[11px]">✦</span>,
      },
      {
        id: "gemini",
        label: "Gemini",
        icon: <span className="text-[11px]">◐</span>,
      },
      {
        id: "openai",
        label: "OpenAI",
        icon: <span className="text-[11px]">○</span>,
      },
      {
        id: "anthropic",
        label: "Anthropic",
        icon: <span className="text-[11px]">⬢</span>,
      },
      {
        id: "ollama",
        label: "Ollama (Lokal)",
        icon: <span className="text-[11px]">⬣</span>,
      },
    ],
    [],
  );

  const stackOptions: DropdownOption[] = useMemo(
    () =>
      (stacks ?? []).map((s) => ({
        id: s.id,
        label: s.label,
        icon: (
          <span className="text-[11px] font-mono">
            {STACK_ICON[s.id] ?? "•"}
          </span>
        ),
        right: (
          <span className="max-w-32 truncate text-[11px] text-ink-subtle">
            {s.hint.split(" ").slice(0, 3).join(" ")}
          </span>
        ),
      })),
    [stacks],
  );

  const handlePickImage = (file: File | undefined) => {
    setImageError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("File harus berupa gambar (PNG/JPG/WebP).");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setImageError("Gambar terlalu besar (>12MB). Kompres dulu.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setImage({ name: file.name, dataUrl: String(reader.result) });
    reader.onerror = () => setImageError("Gagal membaca file.");
    reader.readAsDataURL(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type.startsWith("image/")) {
        const file = it.getAsFile();
        if (file) handlePickImage(file);
      }
    }
  };

  const handleGenerate = async (isRefine = false) => {
    if (!image && !isRefine) {
      setError("Upload screenshot dulu.");
      return;
    }
    const srcImage = image?.dataUrl;
    if (!srcImage && !isRefine) return;
    setGenerating(true);
    setError(null);
    setStage(isRefine ? "Memperbarui kode..." : "Menunggu");
    setProgress(5);
    const combinedPrompt = websiteUrl.trim()
      ? `Website referensi: ${websiteUrl.trim()}\n${prompt}`.trim()
      : prompt;
    try {
      const result = await generateCoderCode(
        {
          imageB64: srcImage || image?.dataUrl || "",
          stack,
          prompt: combinedPrompt,
          provider,
          model: model.trim() || undefined,
          refineCode: isRefine && code ? code : undefined,
          refineInstruction: isRefine ? refineInstruction : undefined,
        },
        (s, p) => {
          setStage(s);
          if (p >= 0) setProgress(p);
        },
      );
      setCode(result.code);
      setRaw(result.raw);
      setTab("preview");
      setShowRefine(false);
      setRefineInstruction("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveProvider = async (prov: string) => {
    const key = (configInputs[prov] || "").trim();
    if (
      prov === "openai" &&
      configBaseUrl.trim() &&
      !key &&
      !config?.providers.openai.configured
    ) {
      // allow saving base_url even without key change? send empty key is skip
    }
    setConfigSaving(prov);
    try {
      await saveCoderConfig(
        prov,
        key,
        prov === "openai" ? configBaseUrl.trim() : undefined,
      );
      const fresh = await fetchCoderConfig();
      setConfig(fresh);
      setConfigInputs((prev) => ({ ...prev, [prov]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfigSaving(null);
    }
  };

  const openRawEditor = async () => {
    setRawError(null);
    setRawLoading(true);
    setRawEditorOpen(true);
    try {
      const data = await fetchCoderRawConfig();
      setRawText(
        data.raw || JSON.stringify(data.parsed ?? { providers: {} }, null, 2),
      );
      setRawPath(data.path || "server/storage/coder/config.json");
    } catch (e) {
      setRawError(e instanceof Error ? e.message : String(e));
      // fallback template
      setRawText(JSON.stringify({ providers: {} }, null, 2));
    } finally {
      setRawLoading(false);
    }
  };

  const handleSaveRaw = async () => {
    setRawSaving(true);
    setRawError(null);
    try {
      // validasi JSON dulu di client
      JSON.parse(rawText);
      await saveCoderRawConfig(rawText);
      const fresh = await fetchCoderConfig();
      setConfig(fresh);
      if (fresh.openai_base_url) setConfigBaseUrl(fresh.openai_base_url);
      setRawEditorOpen(false);
    } catch (e) {
      setRawError(e instanceof Error ? e.message : String(e));
    } finally {
      setRawSaving(false);
    }
  };

  const downloadCode = () => {
    if (!code) return;
    const blob = new Blob([code], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `waves-coder-${stack}-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 800);
  };

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const selectedStack = stacks?.find((s) => s.id === stack);
  const ollamaOnline = config?.ollama.online;
  const hasAnyKey = config
    ? Object.values(config.providers).some((p) => p.configured)
    : false;

  return (
    <main className="w-full pb-12" onPaste={handlePaste}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">
          Screen Coder
          {ollamaOnline && (
            <span className="label bg-canvas-inset text-ink-muted ml-1">
              Ollama
            </span>
          )}
        </div>
        {config && !ollamaOnline && !hasAnyKey && (
          <span className="text-[11px] text-amber-600">butuh API key</span>
        )}
      </div>
      <div className="mb-4 text-xs leading-relaxed text-ink-muted">
        Vendor dari <code className="mono"></code> (fork{" "}
        <a
          href="https://github.com/abi/screenshot-to-code"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          abi/screenshot-to-code
        </a>
        ). Pilih stack, upload gambar, dan Generate.
        {selectedStack && (
          <span className="ml-1 text-ink-subtle">
            Stack aktif: {selectedStack.label}.
          </span>
        )}
      </div>

      <div className="card mb-4 overflow-hidden">
        {/* Header: klik untuk minimize/maximize, gear untuk editor langsung */}
        <button
          type="button"
          onClick={() => setConfigOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-canvas-subtle/60 transition-colors"
          aria-expanded={configOpen}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold">
                  Pengaturan Provider
                </span>
                {hasAnyKey ? (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                    {
                      Object.values(config?.providers ?? {}).filter(
                        (p) => p.configured,
                      ).length
                    }{" "}
                    terpasang
                  </span>
                ) : (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    belum ada key
                  </span>
                )}
              </div>
              <div className="truncate text-[11px] leading-relaxed text-ink-muted">
                {hasAnyKey ? "Klik untuk atur API key" : "Klik untuk expand"} •{" "}
                <code className="mono">server\storage\coder\config.json</code> •
                Auto: Gemini → OpenAI → Anthropic → Ollama
              </div>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openRawEditor();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  (e.target as HTMLElement).click();
                }
              }}
              title="Buka editor langsung server/storage/coder/config.json"
              aria-label="Buka editor config.json"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-edge bg-white text-ink-muted hover:bg-canvas-inset hover:text-ink transition-colors"
            >
              {/* gear icon */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                strokeWidth="2"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                />
              </svg>
            </span>
          </div>
        </button>

        {configOpen && (
          <div className="border-t border-edge px-4 py-4">
            <div className="mb-3 text-[11px] leading-relaxed text-ink-muted">
              API key tersimpan di{" "}
              <code className="mono">server/storage/coder/config.json</code> dan
              env var (<code className="mono">OPENAI_API_KEY</code> /{" "}
              <code className="mono">GEMINI_API_KEY</code> /{" "}
              <code className="mono">ANTHROPIC_API_KEY</code>) &gt; storage.
              Auto mode akan pakai Gemini → OpenAI → Anthropic → Ollama lokal.
              {hasAnyKey
                ? ""
                : " Belum ada key yang terpasang — Generate akan gagal sampai salah satu diatur, kecuali Ollama lokal online."}
              {ollamaOnline
                ? " Ollama terdeteksi online."
                : " Ollama offline (opsional untuk model vision lokal)."}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {(["gemini", "openai", "anthropic", "replicate"] as const).map(
                (prov) => {
                  const info = config?.providers[prov];
                  return (
                    <div
                      key={prov}
                      className="rounded-md border border-edge p-3"
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-semibold capitalize">
                          {PROVIDER_META[prov]?.label ?? prov}
                        </span>
                        <span
                          className={`text-[11px] ${info?.configured ? "text-emerald-600" : "text-amber-600"}`}
                        >
                          {info?.configured
                            ? `✓ ${info.source} ${info.preview ?? ""}`
                            : "Belum diatur"}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={configInputs[prov] || ""}
                          onChange={(e) =>
                            setConfigInputs((prev) => ({
                              ...prev,
                              [prov]: e.target.value,
                            }))
                          }
                          placeholder={
                            PROVIDER_META[prov]?.placeholder ?? "API key..."
                          }
                          className="min-w-0 flex-1 rounded-md border border-edge px-2.5 py-1.5 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveProvider(prov)}
                          disabled={configSaving === prov}
                          className="rounded-md border border-edge bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-strong disabled:opacity-60"
                        >
                          {configSaving === prov ? "Menyimpan..." : "Simpan"}
                        </button>
                      </div>
                      <div className="mt-1 text-[11px] text-ink-subtle">
                        {prov === "gemini"
                          ? "Rekomendasi terbaik untuk screenshot-to-code."
                          : prov === "openai"
                            ? "Model vision: gpt-4o-mini / gpt-4o."
                            : prov === "anthropic"
                              ? "Model: claude-sonnet-4."
                              : "Untuk image gen/edit (opsional, dari vendor/coder)."}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
            <div className="mt-3 rounded-md border border-edge bg-canvas-subtle p-3">
              <div className="mb-1 text-xs font-medium">
                OpenAI Base URL (opsional, untuk proxy)
              </div>
              <div className="flex gap-2">
                <input
                  value={configBaseUrl}
                  onChange={(e) => setConfigBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1  (kosong = default)"
                  className="min-w-0 flex-1 rounded-md border border-edge px-2.5 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => handleSaveProvider("openai")}
                  disabled={!!configSaving}
                  className="rounded-md border border-edge bg-white w-40 px-3 py-1.5 text-xs font-medium hover:bg-canvas-inset"
                >
                  Simpan Base URL
                </button>
              </div>
              <div className="mt-1 text-[11px] text-ink-subtle">
                Untuk proxy OpenAI (mis. region block). Biarkan kosong jika
                pakai api.openai.com langsung.
              </div>
            </div>
            {config?.ollama && (
              <div className="mt-3 text-[11px] text-ink-muted">
                Ollama:{" "}
                {config.ollama.online
                  ? `online — ${config.ollama.models.length} model`
                  : "offline"}{" "}
                {config.ollama.models
                  .map((m) => m.name)
                  .slice(0, 3)
                  .join(", ")
                  ? `(${config.ollama.models
                      .slice(0, 3)
                      .map((m) => m.name)
                      .join(", ")})`
                  : ""}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Raw editor modal — style SetupModal: rounded-xl + shadow-soft + ink close button, hanya close via tombol */}
      {rawEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/30" aria-hidden />
          <div className="relative flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-edge bg-white shadow-soft">
            <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-edge px-4 py-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    strokeWidth="2"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                    />
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                    />
                  </svg>
                  Editor config.json
                </h2>
                <p className="mt-0.5 truncate text-[12px] text-ink-muted">
                  <code className="mono">server\storage\coder\config.json</code>{" "}
                  {rawLoading ? "• memuat..." : "• auto-create"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRawEditorOpen(false)}
                aria-label="Tutup Editor"
                title="Close"
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

            <div className="min-h-0 flex-1 overflow-hidden bg-[#0b1020]">
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                spellCheck={false}
                placeholder='{"providers": {"gemini": {"api_key": "AIza..."}, "openai": {"api_key": "sk-..."}}}'
                className="h-[380px] w-full resize-none bg-transparent p-4 font-mono text-[12px] leading-relaxed text-[#cbd5e1] outline-none"
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              />
            </div>
            {rawError && (
              <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
                {rawError}
              </div>
            )}
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-edge bg-canvas-subtle px-4 py-3.5">
              <span className="text-[11px] text-ink-muted">
                Format JSON harus valid. File:{" "}
                <code className="mono">server/storage/coder/config.json</code>
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRawEditorOpen(false)}
                  className="rounded-md border border-edge bg-white w-40 px-3 py-1.5 text-[12px] font-medium hover:bg-canvas-subtle"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSaveRaw}
                  disabled={rawSaving || rawLoading}
                  className="rounded-md bg-ink w-40 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-black disabled:opacity-60"
                >
                  {rawSaving ? "Menyimpan..." : "Simpan File"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        {/* Left: input */}
        <div className="card flex flex-col gap-4 p-5">
          <Dropdown
            label="Stack"
            value={stack}
            options={stackOptions}
            onChange={(v) => setStack(v as CoderStack)}
            placeholder="Pilih stack…"
          />
          {selectedStack && (
            <div className="rounded-md border border-edge bg-canvas-subtle px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
              {selectedStack.hint}
            </div>
          )}

          <Dropdown
            label="Provider"
            value={provider}
            options={providerOptions}
            onChange={(v) => setProvider(v as CoderProvider)}
            placeholder="Auto"
          />
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-muted">
              Model{" "}
              <span className="font-normal text-ink-subtle">
                (opsional, kosong = default)
              </span>
            </label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={
                PROVIDER_META[provider]?.models[0] ??
                PROVIDER_META.openai.models[0]
              }
              list="coder-model-list"
              className="w-full rounded-md border border-edge px-2.5 py-2 text-xs"
            />
            <datalist id="coder-model-list">
              {(PROVIDER_META[provider]?.models ?? []).map((m) => (
                <option key={m} value={m} />
              ))}
              {PROVIDER_META.openai.models.map((m) => (
                <option key={`openai-${m}`} value={m} />
              ))}
            </datalist>
            <div className="mt-1 text-[11px] text-ink-subtle">
              Auto ={" "}
              {hasAnyKey
                ? "pakai key yang tersedia"
                : ollamaOnline
                  ? "pakai Ollama lokal"
                  : "butuh key"}
              .
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-muted">
              Website URL{" "}
              <span className="font-normal text-ink-subtle">(opsional)</span>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                </span>
                <input
                  type="url"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full rounded-md border border-edge bg-white py-2 pl-8 pr-2.5 text-xs placeholder:text-ink-subtle focus:border-ink focus:outline-none"
                />
              </div>
              {websiteUrl && (
                <button
                  type="button"
                  onClick={() => setWebsiteUrl("")}
                  className="rounded-md border border-edge bg-white px-2.5 py-1.5 text-xs hover:bg-canvas-subtle"
                  title="Hapus URL"
                >
                  Hapus
                </button>
              )}
            </div>
            <div className="mt-1 text-[11px] text-ink-subtle">
              Contoh: tempel URL desain referensi, akan dipakai sebagai konteks
              tambahan saat generate.
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-muted">
              Instruksi tambahan{" "}
              <span className="font-normal text-ink-subtle">(opsional)</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Contoh: buat dark mode toggle, pakai font Inter, tambahkan hover effect..."
              className="w-full resize-y rounded-md border border-edge px-2.5 py-2 text-[13px]"
              style={{ fontFamily: "inherit" }}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-muted">
              Screenshot
            </label>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) handlePickImage(f);
              }}
              className="rounded-md border-2 border-dashed border-edge bg-canvas-subtle p-4 text-center"
            >
              {image ? (
                <div className="flex flex-col items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.dataUrl}
                    alt="Preview"
                    className="max-h-48 w-auto rounded border border-edge object-contain"
                  />
                  <div className="text-xs font-medium">{image.name}</div>
                  <div className="flex gap-2">
                    <label
                      htmlFor="coder-file"
                      className="cursor-pointer rounded-md border border-edge bg-white w-40 px-3 py-1.5 text-xs hover:bg-canvas-inset"
                    >
                      Ganti Gambar
                    </label>
                    <button
                      type="button"
                      onClick={() => setImage(null)}
                      className="rounded-md border border-edge bg-white w-40 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="cursor-pointer py-6"
                  onClick={() => document.getElementById("coder-file")?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      document.getElementById("coder-file")?.click();
                    }
                  }}
                  title="Klik untuk pilih gambar"
                >
                  <div className="text-[13px] text-ink-muted">
                    Seret &amp; lepas gambar, klik untuk pilih, atau paste
                    (Ctrl+V)
                  </div>
                  <div className="mt-1 text-[11px] text-ink-subtle">
                    PNG / JPG / WebP, max 12MB
                  </div>
                </div>
              )}
              <input
                id="coder-file"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handlePickImage(e.target.files?.[0])}
              />
            </div>
            {imageError && (
              <div className="mt-2 text-[11px] text-red-600">{imageError}</div>
            )}
            <div className="mt-1 text-[11px] text-ink-subtle">
              Tips: screenshot Figma / mockup / foto UI. Paste langsung dari
              clipboard juga bisa.
            </div>
          </div>

          <button
            onClick={() => handleGenerate(false)}
            disabled={generating || !image}
            className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-strong disabled:opacity-50"
          >
            {generating ? "Generating..." : "Generate Code"}
          </button>

          {!hasAnyKey && !ollamaOnline && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
              Belum ada provider yang siap. Atur API key di Pengaturan Provider
              (Gemini/OpenAI/Anthropic) atau jalankan Ollama lokal.
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Right: preview + code */}
        <div className="card flex min-h-[600px] flex-col p-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <div className="flex gap-1 rounded-md border border-edge bg-canvas-subtle p-1">
              <button
                type="button"
                onClick={() => setTab("preview")}
                className={`rounded px-3 py-1 text-xs font-medium ${tab === "preview" ? "bg-white shadow-sm" : "text-ink-muted hover:text-ink"}`}
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setTab("code")}
                className={`rounded px-3 py-1 text-xs font-medium ${tab === "code" ? "bg-white shadow-sm" : "text-ink-muted hover:text-ink"}`}
              >
                Code
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyCode}
                disabled={!code}
                className="rounded-md border border-edge bg-white px-2.5 py-1 text-xs hover:bg-canvas-subtle disabled:opacity-50"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
              <button
                type="button"
                onClick={downloadCode}
                disabled={!code}
                className="rounded-md border border-edge bg-white px-2.5 py-1 text-xs hover:bg-canvas-subtle disabled:opacity-50"
              >
                Download .html
              </button>
              <button
                type="button"
                onClick={() => setShowRefine((v) => !v)}
                disabled={!code}
                className="rounded-md border border-edge bg-white px-2.5 py-1 text-xs hover:bg-canvas-subtle disabled:opacity-50"
              >
                Refine
              </button>
            </div>
          </div>

          {showRefine && code && (
            <div className="border-b border-edge bg-amber-50/60 px-3 py-3">
              <div className="mb-1 text-xs font-semibold">
                Refine / Update kode
              </div>
              <div className="mb-2 text-[11px] text-ink-muted">
                Instruksi untuk edit kode yang sudah ada (tanpa upload ulang
                screenshot). Contoh: &quot;ganti warna primary jadi biru,
                tambahkan animasi hover&quot;.
              </div>
              <div className="flex gap-2">
                <input
                  value={refineInstruction}
                  onChange={(e) => setRefineInstruction(e.target.value)}
                  placeholder="Instruksi update..."
                  className="min-w-0 flex-1 rounded-md border border-edge px-2.5 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => handleGenerate(true)}
                  disabled={generating || !refineInstruction.trim()}
                  className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-strong disabled:opacity-50"
                >
                  {generating ? "..." : "Update"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRefine(false)}
                  className="rounded-md border border-edge bg-white px-3 py-1.5 text-xs"
                >
                  Tutup
                </button>
              </div>
            </div>
          )}

          {generating ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-ink-muted">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-ink-muted border-t-transparent" />
              <div className="max-w-sm text-center text-[13px]">
                {stage || "Menjalankan..."}{" "}
                {progress > 0 && progress < 100
                  ? `(${Math.round(progress)}%)`
                  : ""}
              </div>
              <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-canvas-inset">
                <div
                  className="h-full bg-ink transition-[width] duration-300"
                  style={{ width: `${Math.min(100, Math.max(5, progress))}%` }}
                />
              </div>
              <div className="max-w-sm text-center text-[11px] text-ink-subtle">
                Bisa 10–60 detik tergantung provider &amp; ukuran gambar. Jangan
                tutup tab.
              </div>
            </div>
          ) : !code ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-[13px] text-ink-muted">
              <div>
                <div className="mb-1 text-lg">◈</div>
                <div>Hasil kode akan muncul di sini.</div>
                <div className="mt-1 text-[11px] text-ink-subtle">
                  Upload screenshot → Generate untuk melihat preview live.
                </div>
                <div className="mt-3 inline-flex gap-1 text-[11px] text-ink-subtle">
                  <span className="rounded bg-canvas-subtle px-1.5 py-0.5">
                    HTML+Tailwind
                  </span>
                  <span className="rounded bg-canvas-subtle px-1.5 py-0.5">
                    React
                  </span>
                  <span className="rounded bg-canvas-subtle px-1.5 py-0.5">
                    Vue
                  </span>
                  <span className="rounded bg-canvas-subtle px-1.5 py-0.5">
                    Bootstrap
                  </span>
                </div>
              </div>
            </div>
          ) : tab === "preview" ? (
            <div className="flex flex-1 flex-col bg-white">
              <iframe
                title="Preview"
                srcDoc={code}
                sandbox="allow-scripts allow-same-origin"
                className="h-[560px] w-full flex-1 border-0"
              />
              <div className="border-t border-edge bg-canvas-subtle px-3 py-1.5 text-[11px] text-ink-muted">
                Preview sandbox (scripts allowed). Jika layout rusak, klik
                Refine atau ganti stack lalu Generate ulang.
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col">
              <pre
                className="flex-1 overflow-auto overscroll-none bg-[#0b1020] p-4 text-[12px] leading-relaxed text-[#cbd5e1]"
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                <code>{code}</code>
              </pre>
              <div className="border-t border-edge bg-canvas-subtle px-3 py-1.5 text-[11px] text-ink-muted">
                {code.length.toLocaleString("id-ID")} karakter ·{" "}
                {raw ? "raw juga tersimpan" : ""}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
