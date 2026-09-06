interface Props {
  fileName: string | null;
  showReset: boolean;
  onReset: () => void;
}

export default function Toolbar({ fileName, showReset, onReset }: Props) {
  return (
    <div className="mb-1 flex items-center justify-between">
      <div className="w-full">
        <span className="mb-1 text-sm font-semibold">
          {fileName ?? "Music Stem Studio"}
        </span>
        {fileName && (
          <span className="label bg-canvas-inset text-ink-muted ml-1">
            Demucs
          </span>
        )}
        <div className="text-xs text-ink-muted">
          Pemisah instrumen musik menjadi beberapa stem menggunakan Demucs.
        </div>
      </div>

      {showReset && (
        <div className=" flex min-w-80 items-center justify-end">
          <button className="btn" onClick={onReset}>
            Track baru
          </button>
        </div>
      )}
    </div>
  );
}
