"use client";

import { useSyncExternalStore } from "react";

// Screencast frames arrive many times a second. Routing them through
// AppContext's single (unmemoized) provider value would re-render every
// consumer app-wide on every frame — including whatever page a user
// navigates to next, since the browser session (and its WS) outlives the
// Web Explorer page that opened it. An external store + useSyncExternalStore
// scopes frame updates to only the component that actually renders them.
let currentFrame: string | null = null;
const listeners = new Set<() => void>();

export function setScreencastFrame(frame: string | null) {
  currentFrame = frame;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return currentFrame;
}

export function useScreencastFrame(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
