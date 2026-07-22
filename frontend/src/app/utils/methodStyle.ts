import type { CSSProperties } from "react";

/** Background/text color pair for an HTTP method chip, shared by the API
 * Explorer's collection tree/request bar and the Home page's Recent activity list. */
export const methodStyle = (m: string): CSSProperties => {
  const map: Record<string, { bg: string; c: string }> = {
    GET: { bg: "#e3f5e9", c: "#276749" },
    POST: { bg: "#e3ecff", c: "#1a4db5" },
    PUT: { bg: "#fff3e0", c: "#9a5c00" },
    DELETE: { bg: "#fde8e8", c: "#c64545" },
    PATCH: { bg: "#f3e8ff", c: "#6d28d9" },
  };
  const s = map[m] || { bg: "#f0f0ee", c: "#6c6a64" };
  return { background: s.bg, color: s.c };
};
