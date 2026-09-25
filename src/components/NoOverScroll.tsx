"use client";

import { useEffect } from "react";

export default function NoOverScroll() {
  useEffect(() => {
    const isScrollable = (el: HTMLElement | null): boolean => {
      if (!el) return false;
      const { overflowY } = getComputedStyle(el);
      return (
        overflowY === "auto" ||
        overflowY === "scroll" ||
        el.scrollHeight > el.clientHeight
      );
    };

    const handler = (e: WheelEvent) => {
      if (e.cancelable !== true) return;
      // Kumpulkan scroller di rantai target -> root
      const scrollables: HTMLElement[] = [];
      let el = e.target as HTMLElement | null;
      while (el && el !== document.documentElement) {
        if (isScrollable(el) && el.scrollHeight > el.clientHeight) {
          scrollables.push(el);
        }
        el = el.parentElement;
      }
      const dir = e.deltaY > 0 ? 1 : -1;
      let anyCanScroll = false;
      for (const s of scrollables) {
        const can =
          dir > 0
            ? s.scrollTop < s.scrollHeight - s.clientHeight - 0.5
            : s.scrollTop > 0.5;
        if (can) {
          anyCanScroll = true;
          break;
        }
      }
      // Tidak ada scroller yang bisa meneruskan scroll -> batalkan default
      // supaya overscroll glow/bounce tidak digambar browser.
      if (!anyCanScroll) e.preventDefault();
    };

    document.addEventListener("wheel", handler, {
      passive: false,
      capture: true,
    });
    return () =>
      document.removeEventListener("wheel", handler, { capture: true });
  }, []);

  return null;
}