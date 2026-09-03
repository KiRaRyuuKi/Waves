import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Waves — Music Stem Studio",
  description: "Pisahkan instrumen musik dengan Demucs, mixer real-time di browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <header
          style={{
            background: "var(--header-bg)",
            borderBottom: "1px solid var(--header-border)",
            padding: "0 16px",
            height: 62,
            display: "flex",
            alignItems: "center",
          }}
        >
          <div
            style={{
              maxWidth: 1012,
              margin: "0 auto",
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M3 14c1.5-4 3-6 4.5-6s3 4 4.5 4 3-6 4.5-6 3 4 4.5 8"
                stroke="#ffffff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 16 }}>
              <a href="https://github.com/KiRaRyuuKi/Waves" style={{ color: "#ffffff", fontWeight: 600 }}>
                KiRaRyuuKi
              </a>
              <span style={{ color: "#9198a1" }}>/</span>
              <a href="https://github.com/KiRaRyuuKi/Waves" style={{ color: "#ffffff", fontWeight: 600 }}>
                Waves
              </a>
            </div>
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: "#9198a1",
                border: "1px solid #3d444d",
                borderRadius: "2em",
                padding: "1px 8px",
              }}
            >
              local · Demucs
            </span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
