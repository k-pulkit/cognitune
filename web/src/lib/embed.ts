import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * True when the app runs inside the VS Code extension: its panel is a webview that holds this
 * app in an iframe, so the parent window is the panel, not this one.
 */
export const embedded = typeof window !== "undefined" && window.parent !== window;

/** Messages from the app to the extension (the panel relays them). */
export type ToEditor = { type: "ready" } | { type: "reveal"; path: string; line?: number };

export function toEditor(msg: ToEditor) {
  // "*": the panel's origin is a per-session vscode-webview:// URL. The message holds only a
  // path and a line, and the extension checks both before it acts.
  if (embedded) window.parent.postMessage({ cognitune: msg }, "*");
}

/**
 * Listens for "go to this page" from the extension, so a command such as "Lens this file" moves
 * the open app instead of reloading it. Only the parent window (the panel) is trusted.
 */
export function EmbedBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!embedded) return;
    const on = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const m = (e.data as { cognitune?: { type?: string; to?: unknown } } | null)?.cognitune;
      if (m?.type === "navigate" && typeof m.to === "string" && m.to.startsWith("/")) navigate(m.to);
    };
    window.addEventListener("message", on);
    toEditor({ type: "ready" });
    return () => window.removeEventListener("message", on);
  }, [navigate]);
  return null;
}
