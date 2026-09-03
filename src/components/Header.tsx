interface Props {
  onReset?: () => void;
  showReset: boolean;
}

export default function Header({ onReset, showReset }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "20px 24px",
        borderBottom: "1px solid var(--border-hairline)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.3 }}>Music Stem Studio</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
          local · Demucs
        </span>
      </div>
      {showReset && (
        <button
          onClick={onReset}
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            background: "transparent",
            border: "1px solid var(--border-hairline)",
            borderRadius: 8,
            padding: "7px 12px",
          }}
        >
          Track baru
        </button>
      )}
    </div>
  );
}
