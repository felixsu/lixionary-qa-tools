"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { copyDiagnostics } from "../utils/diagnostics";

export type ToastType = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  type?: ToastType;
  action?: ToastAction;
  durationMs?: number;
}

interface ToastEntry {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastContextType {
  showToast: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const DEFAULT_DURATION_MS = 2600;

// Mounted above AppProvider in layout.tsx so both AppContext's own error
// paths and every page can call useToast(). Also owns the last line of
// defense for JS errors that never went through a try/catch at all.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, options: ToastOptions = {}) => {
    const { type = "info", action, durationMs = DEFAULT_DURATION_MS } = options;
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, type, action }]);
    // Error toasts persist until manually dismissed — they carry the
    // "Copy diagnostics" action and shouldn't vanish before it's used.
    if (type !== "error") {
      setTimeout(() => dismiss(id), durationMs);
    }
  }, [dismiss]);

  useEffect(() => {
    const reportError = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(message, {
        type: "error",
        action: {
          label: "Copy diagnostics",
          onClick: async () => {
            const copied = await copyDiagnostics(error);
            showToast(copied ? "Diagnostics copied" : "Diagnostics downloaded", { type: "success" });
          },
        },
      });
    };

    const onError = (event: ErrorEvent) => {
      reportError(event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      reportError(event.reason);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-2.5 bg-ink-900 text-cream px-4 py-3 rounded-lg border-l-4 ${
              toast.type === "error" ? "border-red-500" : toast.type === "success" ? "border-sage" : "border-line"
            } text-[13px] shadow-[0_4px_16px_rgba(20,20,19,0.24)] max-w-[360px]`}
            style={{ animation: "fadeUp 0.2s ease-out" }}
          >
            {toast.type === "error" ? (
              <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
            ) : toast.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-sage flex-shrink-0" />
            ) : (
              <Info className="h-4 w-4 text-mute flex-shrink-0" />
            )}
            <span className="flex-1">{toast.message}</span>
            {toast.action && (
              <button
                onClick={toast.action.onClick}
                className="text-cream underline underline-offset-2 flex-shrink-0 hover:opacity-80"
              >
                {toast.action.label}
              </button>
            )}
            {toast.type === "error" && (
              <button
                onClick={() => dismiss(toast.id)}
                className="text-cream/70 hover:text-cream flex-shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
