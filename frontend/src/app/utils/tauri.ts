// Distinguishes "running inside the Tauri desktop app" from "running as a
// plain web page" — the Next.js bundle is shared between both, and Tauri
// APIs must only ever be dynamically imported after this check passes.
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
