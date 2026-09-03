interface Props {
  stage: string;
  progress: number;
}

export default function ProgressOverlay({ stage, progress }: Props) {
  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "64px 24px", textAlign: "center" }}>
      <div className="mono" style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
        {stage}
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: "var(--bg-panel-raised)",
          overflow: "hidden",
          border: "1px solid var(--border-hairline)",
        }}
      >
        <div
          style={{
            width: `${Math.max(2, progress)}%`,
            height: "100%",
            background: "var(--signal)",
            transition: "width 200ms ease",
          }}
        />
      </div>
      <div className="mono" style={{ fontSize: 12, color: "var(--signal)", marginTop: 10 }}>
        {progress.toFixed(0)}%
      </div>
    </div>
  );
}
