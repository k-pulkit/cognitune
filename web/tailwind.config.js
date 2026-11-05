import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const c = (v) => `rgb(var(--${v}) / <alpha-value>)`;

/** Colours are CSS variables (index.css) so light and dark share one set of class names. */
export default {
  content: [here("./index.html"), here("./src/**/*.{ts,tsx}")],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: c("bg"), panel: c("panel"), raised: c("raised"), line: c("line"), ink: c("ink"), muted: c("muted"),
        accent: c("accent"), "accent-ink": c("accent-ink"), good: c("good"), warn: c("warn"), bad: c("bad"),
      },
      fontFamily: {
        sans: ["'Inter Variable'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono Variable'", "ui-monospace", "monospace"],
        // Long-form text (lessons, feedback, tutor replies); serif or sans is a reader's choice.
        read: ["var(--read-font)"],
      },
      // One step up from Tailwind's defaults: this is a reading tool, often used for an hour at a time.
      fontSize: {
        xs: ["12.5px", { lineHeight: "1.55" }],
        sm: ["14px", { lineHeight: "1.6" }],
        base: ["16px", { lineHeight: "1.65" }],
      },
      // Steps used across the app that Tailwind's default opacity scale lacks (bg-accent/12 etc.).
      opacity: { 8: "0.08", 12: "0.12", 35: "0.35", 45: "0.45", 55: "0.55", 85: "0.85" },
      boxShadow: { soft: "0 1px 2px rgb(0 0 0 / 0.06), 0 4px 16px -4px rgb(0 0 0 / 0.08)" },
      keyframes: { shimmer: { "100%": { transform: "translateX(100%)" } } },
    },
  },
};
