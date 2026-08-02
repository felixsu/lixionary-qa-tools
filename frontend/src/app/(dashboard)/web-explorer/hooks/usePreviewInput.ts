"use client";

import React, { useRef } from "react";
import { useWebExplorer } from "../../../context/WebExplorerContext";

/**
 * Mouse/keyboard/wheel relay for the screencast preview. Owns the container
 * ref and the letterbox math that maps container coordinates onto the remote
 * browser viewport (the screencast image is object-contain, so black bars
 * appear on whichever axis the aspect ratios disagree).
 */
export function usePreviewInput() {
  const {
    isBrowserConnected,
    inspectMode,
    viewportSize,
    isVerifying,
    isExploring,
    sendBrowserMouseEvent,
    sendBrowserWheelEvent,
    sendBrowserKeyboardEvent,
  } = useWebExplorer();

  const previewContainerRef = useRef<HTMLDivElement>(null);

  const handlePreviewMouseEvent = (e: React.MouseEvent, type: "click" | "move" | "down" | "up") => {
    if (isVerifying || isExploring) return;
    if (!previewContainerRef.current || !isBrowserConnected) return;

    if (type === "move" && e.buttons !== 1 && !inspectMode) return;

    const rect = previewContainerRef.current.getBoundingClientRect();
    const containerWidth = rect.width;
    const containerHeight = rect.height;

    // Aspect ratio of the actual browser viewport (profile-configurable resolution)
    const imageAspectRatio = viewportSize.width / viewportSize.height;
    const containerAspectRatio = containerWidth / containerHeight;

    let renderedWidth = containerWidth;
    let renderedHeight = containerHeight;
    let offsetX = 0;
    let offsetY = 0;

    if (containerAspectRatio > imageAspectRatio) {
      // Container is wider than the image: black bars on left/right
      renderedWidth = containerHeight * imageAspectRatio;
      offsetX = (containerWidth - renderedWidth) / 2;
    } else {
      // Container is taller than the image: black bars on top/bottom
      renderedHeight = containerWidth / imageAspectRatio;
      offsetY = (containerHeight - renderedHeight) / 2;
    }

    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const x = (clickX - offsetX) / renderedWidth;
    const y = (clickY - offsetY) / renderedHeight;

    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
      sendBrowserMouseEvent(type, x, y);
    }
  };

  const handlePreviewKeyDown = (e: React.KeyboardEvent) => {
    // Escape is reserved for the app (close overlays, exit inspect mode) and
    // is never relayed to the remote page — letting it bubble keeps the
    // document-level Esc handlers alive while the preview has focus. Use the
    // real Chromium window to send Esc to the page under test.
    if (e.key === "Escape") return;
    if (inspectMode || isVerifying || isExploring) return;
    if (!isBrowserConnected) return;

    e.preventDefault();
    e.stopPropagation();

    sendBrowserKeyboardEvent(e.key);
  };

  const handlePreviewWheel = (e: React.WheelEvent) => {
    if (isVerifying || isExploring) return;
    if (!isBrowserConnected) return;

    sendBrowserWheelEvent(e.deltaX, e.deltaY);
  };

  return { previewContainerRef, handlePreviewMouseEvent, handlePreviewKeyDown, handlePreviewWheel };
}
