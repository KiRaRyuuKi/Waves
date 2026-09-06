interface Props {
  stage: string;
  progress: number;
}

export default function ProgressOverlay({ stage, progress }: Props) {
  return (
    <div className="p-10 text-center">
      <div className="mb-3 text-[13px] text-ink-muted">{stage}</div>
      <div className="mx-auto h-2 max-w-[420px] overflow-hidden rounded border border-edge bg-canvas-inset">
        <div
          className="h-full bg-ink transition-[width] duration-200 ease-linear"
          style={{ width: `${Math.max(2, progress)}%` }}
        />
      </div>
      <div className="mono mt-2.5 text-xs font-semibold text-green-600">{progress.toFixed(0)}%</div>
    </div>
  );
}