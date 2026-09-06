"use client";

import { useEffect, useMemo, useState } from "react";
import { coverUrl, fetchVoiceModels, synthesizeVoice, type VoiceModelInfo } from "../lib/voiceApi";
import Dropdown, { type DropdownOption } from "./Dropdown";

interface GameGroup {
  game: string;
  items: VoiceModelInfo[];
}

export default function VoiceStudio() {
  const [models, setModels] = useState<VoiceModelInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeGame, setActiveGame] = useState<string>("");
  const [modelId, setModelId] = useState<string>("");
  const [speakerId, setSpeakerId] = useState(0);
  const [text, setText] = useState("");
  const [noiseScale, setNoiseScale] = useState(0.667);
  const [noiseScaleW, setNoiseScaleW] = useState(0.8);
  const [lengthScale, setLengthScale] = useState(1.0);
  const [generating, setGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const games: GameGroup[] = useMemo(() => {
    if (!models) return [];
    const groups: GameGroup[] = [];
    for (const m of models) {
      const game = m.game || "Lainnya";
      const group = groups.find((g) => g.game === game);
      if (group) group.items.push(m);
      else groups.push({ game, items: [m] });
    }
    return groups;
  }, [models]);

  useEffect(() => {
    fetchVoiceModels()
      .then((list) => {
        setModels(list);
        const first = list.find((m) => m.ready !== false) ?? list[0];
        if (first) {
          setActiveGame(first.game || "Lainnya");
          setModelId(first.id);
          setSpeakerId(first.default_sid ?? 0);
          setText(first.sample_text ?? "");
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Gagal memuat daftar model."));
  }, []);

  const visibleModels = useMemo(() => {
    const group = games.find((g) => g.game === activeGame);
    return group ? group.items : [];
  }, [games, activeGame]);

  const selectedModel = models?.find((m) => m.id === modelId) ?? null;

  const selectModel = (m: VoiceModelInfo) => {
    setModelId(m.id);
    setSpeakerId(m.default_sid ?? 0);
    setText(m.sample_text ?? "");
    setAudioUrl(null);
  };

  const gameOptions: DropdownOption[] = useMemo(
    () =>
      games.map((g) => ({
        id: g.game,
        label: g.game,
        right: <span className="flex-shrink-0 text-[11px] text-ink-muted">{g.items.length}</span>,
      })),
    [games]
  );

  const characterOptions: DropdownOption[] = useMemo(
    () =>
      visibleModels.map((m) => ({
        id: m.id,
        label: m.name,
        disabled: m.ready === false,
        icon: (
          <img
            src={coverUrl(m.id)}
            alt=""
            width={28}
            height={28}
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            className="flex-shrink-0 rounded-[5px] object-cover"
          />
        ),
        right:
          m.ready === false ? (
            <span className="flex-shrink-0 text-[11px] text-amber-600">belum siap</span>
          ) : undefined,
      })),
    [visibleModels]
  );

  const handleGameChange = (gameId: string) => {
    setActiveGame(gameId);
    const group = games.find((g) => g.game === gameId);
    const next = group?.items.find((m) => m.ready !== false) ?? group?.items[0];
    if (next) selectModel(next);
  };

  const handleModelChange = (id: string) => {
    const m = models?.find((x) => x.id === id);
    if (m) selectModel(m);
  };

  const handleGenerate = async () => {
    if (!modelId || !text.trim()) return;
    if (selectedModel?.ready === false) {
      setGenError("Model yang dipilih belum siap (checkpoint tidak lengkap).");
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      const blob = await synthesizeVoice({ modelId, text, speakerId, noiseScale, noiseScaleW, lengthScale });
      setAudioUrl(URL.createObjectURL(blob));
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Sintesis gagal.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <main className="w-full pb-12">
      <div className="mb-1 text-sm font-semibold">Voice Synthesis</div>
      <div className="mb-4 text-xs text-ink-muted">
        Sintesis suara karakter berbasis VITS, jalan lokal. Pilih game dan karakter di bawah.
      </div>

      {loadError && (
        <div className="card p-4 text-[13px] text-red-600">{loadError}</div>
      )}

      {models && models.length === 0 && (
        <div className="card p-5 text-[13px] text-ink-muted">
          Belum ada model suara terpasang. Taruh foldernya di{" "}
          <code className="mono">server/storage/models/&lt;id&gt;/</code> (cukup checkpoint{" "}
          <code className="mono">*.pth</code>; katalog &amp; config diambil dari{" "}
          <code className="mono">info.json</code> / <code className="mono">_default_config.json</code>) — lihat{" "}
          <code className="mono">server/storage/models/README.md</code>.
        </div>
      )}

      {models && models.length > 0 && selectedModel && (
        <div className="card flex flex-col gap-4 p-5">
          {/* Kartu model terpilih */}
          <div className="flex items-center gap-3.5">
            <img
              src={coverUrl(selectedModel.id)}
              alt=""
              width={64}
              height={64}
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
              className="flex-shrink-0 rounded-[10px] object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[17px] font-semibold">{selectedModel.name}</div>
              <div className="text-[13px] text-ink-muted">
                {selectedModel.game} · {selectedModel.language}
              </div>
            </div>
            {selectedModel.ready === false && (
              <span className="flex-shrink-0 text-[11px] text-amber-600">belum siap</span>
            )}
          </div>

          {selectedModel.ready === false && (
            <div className="text-xs text-red-600">
              Model ini belum punya checkpoint lengkap (masih pointer Git LFS). Pilih karakter lain yang <em>siap</em>.
            </div>
          )}

          {/* Dropdown game + karakter */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
            <Dropdown
              label="Game"
              value={activeGame}
              options={gameOptions}
              onChange={handleGameChange}
              placeholder="Pilih game…"
            />
            <Dropdown
              label="Karakter"
              value={modelId}
              options={characterOptions}
              onChange={handleModelChange}
              placeholder="Pilih karakter…"
            />
          </div>

          {selectedModel.speakers.length > 1 && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-muted">Speaker</label>
              <select
                value={speakerId}
                onChange={(e) => setSpeakerId(Number(e.target.value))}
                className="w-full rounded-md border border-edge bg-white px-2 py-1.5 text-[13px]"
              >
                {selectedModel.speakers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-muted">Teks</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              maxLength={500}
              className="w-full resize-y rounded-md border border-edge px-2.5 py-2 text-[13px]"
              style={{ fontFamily: "inherit" }}
            />
          </div>

          <details>
            <summary className="cursor-pointer text-xs text-ink-muted">Opsi lanjutan</summary>
            <div className="mt-2.5 grid grid-cols-3 gap-3">
              {[
                { label: "Noise scale", value: noiseScale, set: setNoiseScale },
                { label: "Noise scale W", value: noiseScaleW, set: setNoiseScaleW },
                { label: "Length scale", value: lengthScale, set: setLengthScale },
              ].map((f) => (
                <div key={f.label}>
                  <label className="mb-1 block text-[11px] text-ink-muted">{f.label}</label>
                  <input
                    type="number"
                    step={0.01}
                    value={f.value}
                    onChange={(e) => f.set(parseFloat(e.target.value))}
                    className="w-full rounded-md border border-edge px-1.5 py-1 text-xs"
                  />
                </div>
              ))}
            </div>
          </details>

          <button
            className="btn btn-primary self-start"
            disabled={generating || !text.trim()}
            onClick={handleGenerate}
          >
            {generating ? "Membuat suara…" : "Generate"}
          </button>

          {genError && <div className="text-[13px] text-red-600">{genError}</div>}

          {audioUrl && (
            <div className="border-t border-edge-soft pt-3.5">
              <audio controls src={audioUrl} className="w-full" />
              <div className="mt-1.5 text-[11px] text-ink-muted">
                Hasil hanya berupa blob di browser dan tidak disimpan ke disk.
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}