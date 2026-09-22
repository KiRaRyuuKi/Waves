"use client";

import { useEffect, useRef, useState } from "react";

interface ServerState {
  running: boolean;
  mode?: string;
  backendPid?: number;
  frontendPid?: number;
  backendPort?: string;
  frontendPort?: string;
  startedAt?: string;
}

export default function ServerControl() {
  const [state, setState] = useState<ServerState>({ running: false });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"" | "start" | "restart" | "stop">("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/control/status", { cache: "no-store" });
        if (alive && res.ok) {
          const data = (await res.json()) as ServerState;
          setState(data);
        }
      } catch {
        if (alive) setState((s) => ({ ...s, running: false }));
      }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function act(action: "start" | "restart" | "stop") {
    setBusy(action);
    try {
      await fetch(`/api/control/${action === "start" ? "restart" : action}`, {
        method: "POST",
      });
      if (action === "stop") setOpen(false);
      setTimeout(
        () => setState((s) => ({ ...s, running: action !== "stop" })),
        1000,
      );
    } catch {
      setOpen(false);
    } finally {
      setBusy("");
    }
  }

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={
          state.running
            ? "Server berjalan — klik untuk menu"
            : "Server belum berjalan"
        }
        className={`relative flex h-[38px] w-[38px] pl-1 items-center justify-center rounded-md border transition-colors ${
          state.running
            ? "border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100"
            : "border-edge bg-white text-ink-subtle hover:bg-canvas-subtle"
        }`}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 2v9" />
          <path d="M18.36 6.64a9 9 0 1 1-12.72 0" />
        </svg>
        <span className="absolute right-1 top-1 flex h-1.5 w-1.5">
          <span
            className={`absolute -right-0 -top-0 h-1.5 w-1.5 rounded-full ${state.running ? "bg-red-500" : "bg-gray-500"}`}
          />
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-50 mb-1.5 w-60 rounded-lg border border-edge bg-white p-1 shadow-float"
        >
          <div className="px-2.5 py-2 text-[11px] text-ink-muted">
            {state.running ? (
              <>
                Server berjalan ·{" "}
                <span className="font-medium text-green-700">
                  {state.mode === "start" ? "Production" : "Development"}
                </span>
              </>
            ) : (
              <>Server tidak berjalan</>
            )}
          </div>
          <div className="mx-2 my-0.5 border-t border-edge" />
          <button
            type="button"
            role="menuitem"
            disabled={busy !== ""}
            onClick={() => act(state.running ? "restart" : "start")}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-canvas-subtle disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            <span className="flex-1">
              {state.running ? "Restart Server" : "Start Server"}
            </span>
            {busy === "restart" && (
              <span className="text-[11px] text-ink-muted">…</span>
            )}
            {busy === "start" && (
              <span className="text-[11px] text-ink-muted">…</span>
            )}
          </button>
          <div className="mx-2 my-0.5" />
          <button
            type="button"
            role="menuitem"
            disabled={!state.running || busy !== ""}
            onClick={() => act("stop")}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg
              width="15"
              height="15"
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
            <span className="flex-1">Close Server</span>
            {busy === "stop" && (
              <span className="text-[11px] text-red-400">…</span>
            )}
          </button>
          <div className="mx-2 my-0.5 border-t border-edge" />
          <div className="px-2.5 py-1.5 text-[10px] leading-relaxed text-ink-muted">
            Start/restart mengaktifkan ulang backend (dan frontend bila belum
            jalan). Close menghentikan backend &amp; frontend.
          </div>
        </div>
      )}
    </div>
  );
}
