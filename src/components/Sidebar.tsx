"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const NAV: NavItem[] = [
  {
    href: "/",
    label: "Stem Separator",
    icon: (
      <path d="M3 14c1.5-4 3-6 4.5-6s3 4 4.5 4 3-6 4.5-6 3 4 4.5 8" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    href: "/voice",
    label: "Voice Synthesis",
    icon: (
      <>
        <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
        <path d="M6 11a6 6 0 0 0 12 0M12 18v3" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: "/training",
    label: "Fine-tune (ID)",
    icon: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6M9 15l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full min-h-0 w-64 flex-shrink-0 flex-col overflow-hidden rounded-md border border-edge bg-white shadow-soft">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-edge bg-canvas-subtle px-3 py-2 text-[13px] font-medium text-gray-700">
        <span>Navigasi</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 14c1.5-4 3-6 4.5-6s3 4 4.5 4 3-6 4.5-6 3 4 4.5 8" />
        </svg>
      </div>
      <nav className="min-h-0 overflow-y-auto p-2">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-colors ${
                active
                  ? "bg-canvas-inset text-ink"
                  : "text-ink-muted hover:bg-canvas-subtle"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {item.icon}
              </svg>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
