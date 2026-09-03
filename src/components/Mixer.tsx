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
    <div
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border-hairline)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {stems.map((stem) => (
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
        />
      ))}
    </div>
  );
}
