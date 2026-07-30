"use client";

import React from "react";

interface SelectablePreProps {
  className?: string;
  children: React.ReactNode;
}

// Focusable <pre> that scopes Cmd/Ctrl+A to its own contents: clicking inside
// focuses the block, and select-all then highlights only this block instead of
// the whole page.
export default function SelectablePre({ className, children }: SelectablePreProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLPreElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(e.currentTarget);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  return (
    <pre tabIndex={0} onKeyDown={handleKeyDown} className={`${className ?? ""} outline-none`}>
      {children}
    </pre>
  );
}
