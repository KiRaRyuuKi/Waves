import type { MultiStemPlayer } from "../lib/audioEngine";
import type { Peaks } from "../lib/peaks";
import ChannelStrip from "./ChannelStrip";

interface StemEntry {
  name: string;
  label: string;
  color: string;
  peaks: Peaks;
}

interface Props {
  stems: StemEntry[];
  duration: number;
  currentTime: number;
  engine: MultiStemPlayer;
  onSeek: (time: number) => void;
}

export default function Mixer({ stems, duration, currentTime, engine, onSeek }: Props) {
  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <span>Stems</span>
        <span>{stems.length} track{stems.length === 1 ? "" : "s"}</span>
      </div>
      {stems.map((stem, i) => (
        <ChannelStrip
          key={stem.name}
          name={stem.name}
          label={stem.label}
          color={stem.color}
          peaks={stem.peaks}
          duration={duration}
          currentTime={currentTime}
          engine={engine}
          onSeek={onSeek}
          last={i === stems.length - 1}
        />
      ))}
    </div>
  );
}
