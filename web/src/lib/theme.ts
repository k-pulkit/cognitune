import { useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
  window.dispatchEvent(new CustomEvent("gl-theme", { detail: dark }));
}

/** Theme preference in localStorage (a per-browser convenience), applied as the `dark` class. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => {
    try {
      return (localStorage.getItem("groklab.theme") as ThemePref) || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("groklab.theme", pref);
    } catch {
      /* ignore */
    }
    apply(pref);
    if (pref !== "system") return;
    const m = media();
    const on = () => apply("system");
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [pref]);
  return { pref, setPref };
}

/** True while the page shows the dark theme; follows changes. */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const on = (e: Event) => setDark((e as CustomEvent<boolean>).detail);
    window.addEventListener("gl-theme", on);
    return () => window.removeEventListener("gl-theme", on);
  }, []);
  return dark;
}
