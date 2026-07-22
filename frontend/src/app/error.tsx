"use client";

import { useState } from "react";
import { copyDiagnostics } from "./utils/diagnostics";
import { useAppVersion } from "./utils/useAppVersion";

// Catches render-time crashes in the page tree below the root layout. Does
// NOT depend on useToast() — the provider tree above this boundary may be
// exactly what's implicated in the crash, so this manages its own minimal
// "Copied" state instead.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [copyLabel, setCopyLabel] = useState("Copy diagnostics");
  const appVersion = useAppVersion();

  const onCopyDiagnostics = async () => {
    const copied = await copyDiagnostics(error, appVersion);
    setCopyLabel(copied ? "Copied" : "Downloaded");
    setTimeout(() => setCopyLabel("Copy diagnostics"), 2000);
  };

  return (
    <div className="h-full min-h-screen flex items-center justify-center bg-cream px-6">
      <div className="max-w-md w-full text-center">
        <h1 className="text-lg font-semibold text-ink mb-2">Something went wrong</h1>
        <p className="text-sm text-graphite mb-6">{error.message || "An unexpected error occurred."}</p>
        <div className="flex items-center justify-center gap-2.5">
          <button
            onClick={() => reset()}
            className="h-9 px-4 rounded-md bg-clay text-cream text-sm font-medium hover:opacity-90 transition"
          >
            Reload
          </button>
          <button
            onClick={onCopyDiagnostics}
            className="h-9 px-4 rounded-md border border-line text-graphite text-sm font-medium hover:bg-hover transition"
          >
            {copyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
