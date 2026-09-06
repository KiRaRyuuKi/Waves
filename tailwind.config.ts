import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}", "./next.config.js"],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: "#ffffff",
          subtle: "#f9fafb",
          inset: "#f3f4f6",
        },
        edge: {
          DEFAULT: "#e5e7eb",
          soft: "rgba(229, 231, 235, 0.5)",
        },
        ink: {
          DEFAULT: "#111827",
          muted: "#4b5563",
          subtle: "#9ca3af",
        },
        stem: {
          vocals: "#16a34a",
          drums: "#d97706",
          bass: "#7c3aed",
          other: "#dc2626",
        },
      },
      boxShadow: {
        soft: "0 1px 2px rgba(17, 24, 39, 0.06)",
        float: "0 4px 12px rgba(17, 24, 39, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;