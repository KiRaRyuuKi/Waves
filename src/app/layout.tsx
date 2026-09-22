import type { Metadata } from "next";

import Sidebar from "@/components/Sidebar";
import DeviceSelect from "@/components/DeviceSelect";
import GitHubButton from "@/components/GitHubButton";
import { DeviceProvider } from "@/lib/deviceContext";

import "./globals.css";

export const metadata: Metadata = {
  title: "Waves",
  description:
    "Toolkit serba guna dengan backend FastAPI (Python) berbasis Next.js + TypeScript.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <DeviceProvider>
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
                    Toolkit serba guna dengan backend FastAPI (Python) berbasis Next.js + TypeScript.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <DeviceSelect />
                  <GitHubButton />
                </div>
              </div>
            </header>

            <div className="flex min-h-0 flex-1 gap-4 py-4 pl-4">
              <Sidebar />
              <main className="min-h-0 min-w-0 flex-1 pr-4 overflow-y-auto">
                {children}
              </main>
            </div>
          </div>
        </DeviceProvider>
      </body>
    </html>
  );
}
