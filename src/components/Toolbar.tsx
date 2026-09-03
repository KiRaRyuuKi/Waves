interface Props {
  fileName: string | null;
  showReset: boolean;
  onReset: () => void;
}

export default function Toolbar({ fileName, showReset, onReset }: Props) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="var(--fg-muted)" aria-hidden>
          <path d="M1.5 2.5A1.5 1.5 0 0 1 3 1h4.5l2 2H13a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5v-10Z" />
        </svg>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--fg-default)" }}>
          {fileName ?? "Music Stem Studio"}
        </span>
        {fileName && (
          <span className="label" style={{ background: "var(--accent-subtle)", color: "var(--accent-fg)" }}>
            Demucs
          </span>
        )}
      </div>

      {showReset && (
        <button className="btn" onClick={onReset}>
          Track baru
        </button>
      )}
    </div>
  );
}
