interface Props {
  stage: string;
  progress: number;
}

export default function ProgressOverlay({ stage, progress }: Props) {
  return (
    <div style={{ padding: "40px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 12 }}>{stage}</div>
      <div
        style={{
          maxWidth: 420,
          margin: "0 auto",
          height: 8,
          borderRadius: 4,
          background: "var(--canvas-inset)",
          overflow: "hidden",
          border: "1px solid var(--border-default)",
        }}
      >
        <div
          style={{
            width: `${Math.max(2, progress)}%`,
            height: "100%",
            background: "var(--success-emphasis)",
            transition: "width 200ms ease",
          }}
        />
      </div>
      <div className="mono" style={{ fontSize: 12, color: "var(--success-fg)", marginTop: 10, fontWeight: 600 }}>
        {progress.toFixed(0)}%
      </div>
    </div>
  );
}
