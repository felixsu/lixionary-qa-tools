"use client";

import React from "react";
import { X } from "lucide-react";

export function Modal({
  title,
  onClose,
  children,
  width = 480,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(20,20,19,0.5)", backdropFilter: "blur(2px)" }}
    >
      <div
        className="bg-cream rounded-2xl p-8 shadow-[0_24px_48px_-12px_rgba(20,20,19,0.18)] flex flex-col gap-5"
        style={{ width }}
      >
        <div className="flex items-center justify-between">
          <h2 className="m-0 font-serif text-xl font-medium text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg border border-line flex items-center justify-center hover:bg-panel transition-colors"
          >
            <X className="h-4 w-4 text-graphite" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ModalFooter({ onCancel, submitLabel }: { onCancel: () => void; submitLabel: string }) {
  return (
    <div className="flex justify-end gap-2 pt-1 border-t border-line">
      <button
        type="button"
        onClick={onCancel}
        className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
      >
        Cancel
      </button>
      <button
        type="submit"
        className="h-10 px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white transition-colors"
      >
        {submitLabel}
      </button>
    </div>
  );
}
