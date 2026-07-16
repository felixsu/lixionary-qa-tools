import { isTauri } from "./tauri";

/** Native window.confirm() is unreliable inside Tauri's production webview
 * (macOS's WKWebView doesn't implement the JS confirm panel by default) —
 * it silently returns false with no error, which is exactly why a
 * destructive-action confirmation could appear to do nothing at all when
 * clicked. Uses @tauri-apps/plugin-dialog's confirm() when running in
 * Tauri (the reliable native equivalent), falls back to window.confirm()
 * otherwise (dev/browser usage, where the native dialog works fine). */
export async function confirmDialog(message: string): Promise<boolean> {
  if (isTauri()) {
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    return confirm(message, { kind: "warning" });
  }
  return window.confirm(message);
}
