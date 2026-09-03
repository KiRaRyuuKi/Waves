export type JobStatus = "queued" | "processing" | "done" | "error";

export interface JobState {
  id: string;
  status: JobStatus;
  progress: number;
  stage: string;
  stems: string[];
  error: string | null;
  model: string;
}

export type ModelId = "htdemucs" | "htdemucs_ft" | "mdx_extra";

export interface ModelOption {
  id: ModelId;
  label: string;
  description: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "htdemucs",
    label: "Standard",
    description: "Cepat, kualitas solid untuk kebanyakan lagu",
  },
  {
    id: "htdemucs_ft",
    label: "High Quality",
    description: "4x lebih lambat, hasil pemisahan lebih bersih",
  },
  {
    id: "mdx_extra",
    label: "Alternative",
    description: "Model berbeda, kadang lebih baik untuk lagu tertentu",
  },
];

// A stable identity color per stem name so the same instrument always
// reads the same way across the waveform, meter, and fader.
export const STEM_COLORS: Record<string, string> = {
  vocals: "var(--stem-vocals)",
  drums: "var(--stem-drums)",
  bass: "var(--stem-bass)",
  other: "var(--stem-other)",
};

export const STEM_LABELS: Record<string, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Other",
};
