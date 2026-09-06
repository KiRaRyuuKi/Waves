"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface DropdownOption {
  id: string;
  label: string;
  icon?: ReactNode;
  right?: ReactNode;
  disabled?: boolean;
}

interface Props {
  label: string;
  options: DropdownOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function Dropdown({ label, options, value, onChange, placeholder = "Pilih…", disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
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

  const selected = options.find((o) => o.id === value);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <label className="mb-1 block text-xs font-semibold text-ink-muted">{label}</label>
<button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        className={`flex w-full h-10 items-center gap-2 rounded-md border bg-white px-2.5 py-[7px] text-[13px] outline-none transition-shadow ${
          disabled
            ? "cursor-not-allowed opacity-60"
            : open
              ? "border-gray-400 shadow-[0_0_0_3px_rgba(17,24,39,0.08)]"
              : "border-edge"
        }`}
      >
        {selected?.icon}
        <span
          className={`flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left ${
            selected ? "text-ink" : "text-ink-subtle"
          }`}
        >
          {selected ? selected.label : placeholder}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="flex-shrink-0 text-ink-muted"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-[260px] overflow-y-auto rounded-md border border-edge bg-white p-1 shadow-float"
        >
          {options.length === 0 && (
            <div className="px-2.5 py-2 text-[13px] text-ink-muted">Tidak ada pilihan</div>
          )}
          {options.map((o) => {
            const isSel = o.id === value;
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={isSel}
                disabled={o.disabled}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-[5px] border-none px-2 py-1.5 text-left text-[13px] ${
                  o.disabled
                    ? "cursor-not-allowed opacity-55"
                    : isSel
                      ? "cursor-pointer bg-canvas-inset"
                      : "cursor-pointer hover:bg-canvas-subtle"
                }`}
              >
                {o.icon}
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{o.label}</span>
                {o.right}
                {isSel && (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="flex-shrink-0 text-ink"
                    aria-hidden
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}