"use client";

import { useEffect, useState } from "react";

/** A render-safe "current time" for relative-time labels ("2m ago"),
 * refreshed periodically via an effect rather than calling Date.now()
 * directly during render (which React's purity rules flag). Returns 0 until
 * the first tick lands just after mount. */
export function useNowTick(intervalMs: number): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const seed = setTimeout(tick, 0); // deferred, not a direct synchronous setState in the effect body
    const interval = setInterval(tick, intervalMs);
    return () => { clearTimeout(seed); clearInterval(interval); };
  }, [intervalMs]);
  return now;
}
