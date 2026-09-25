"use client";

import { useState } from "react";
import ImageStudio from "./ImageStudio";
import VideoStudio from "./VideoStudio";

type StudioTab = "image" | "video";

export default function StudioCreation() {
  const [tab, setTab] = useState<StudioTab>("image");

  return (
    <div className="w-full pb-12">
      <div className="mb-1 text-sm font-semibold">Studio Creation</div>
      <div className="mb-4 text-xs text-ink-muted">
        Buat gambar dan video dalam satu tempat. Pilih model, masukkan prompt,
        dan klik Generate.
      </div>

      <div className="w-full mb-3 flex gap-1 rounded-md border border-edge bg-canvas-subtle p-1">
        <button
          onClick={() => setTab("image")}
          className={`flex w-full items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${tab === "image" ? "bg-white shadow-sm text-ink" : "text-ink-muted hover:text-ink"}`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            strokeWidth="2"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
            />
          </svg>
          Image
        </button>
        <button
          onClick={() => setTab("video")}
          className={`flex w-full items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${tab === "video" ? "bg-white shadow-sm text-ink" : "text-ink-muted hover:text-ink"}`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            strokeWidth="2"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
            />
          </svg>
          Video
        </button>
      </div>

      {/* Keep both mounted so prompt/state + polling tidak hilang saat ganti tab */}
      <div className={tab === "image" ? "block" : "hidden"}>
        <ImageStudio />
      </div>
      <div className={tab === "video" ? "block" : "hidden"}>
        <VideoStudio />
      </div>
    </div>
  );
}
