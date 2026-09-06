import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Waves",
  description:
    "Toolkit audio AI: pemisahan stem, sintesis suara karakter, dan lainnya.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>
        <div className="flex h-screen flex-col overflow-hidden">
          <header className="pt-4 px-4">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border border-edge rounded-md bg-white px-4 py-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <svg
                    width="26"
                    height="26"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                    className="flex-shrink-0"
                  >
                    <path
                      d="M3 14c1.5-4 3-6 4.5-6s3 4 4.5 4 3-6 4.5-6 3 4 4.5 8"
                      stroke="#1f2937"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="whitespace-nowrap text-xl font-medium leading-tight text-ink">
                    Waves
                  </span>
                </div>
                <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-relaxed text-gray-500">
                  Toolkit pemisahan instrumen musik berbasis Demucs,
                  dengan backend FastAPI (Python) berbasis Next.js + TypeScript.
                </div>
              </div>
              <a
                href="https://github.com/KiRaRyuuKi/Waves"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-gradient-to-b from-[#2f3b46] to-[#1f2937] px-3 py-1.5 text-[13px] text-white no-underline transition-colors hover:from-[#2b2b2b] hover:to-black"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.34.95.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12v3.14c0 .31.2.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
                </svg>
                KiRaRyuuKi/Waves
              </a>
            </div>
          </header>

          <div className="flex flex-1 gap-4 p-4">
            <Sidebar />
            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
