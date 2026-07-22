"use client";

import { useState } from "react";
import { copyDiagnostics } from "./utils/diagnostics";

// Last-resort boundary for crashes in the root layout itself (e.g. inside
// AppProvider), which error.tsx can't catch since it only wraps {children}
// of the layout, not the layout's own tree. Next.js requires this to render
// its own <html>/<body> — inline styles only, since globals.css/Tailwind and
// the app's own providers may be exactly what's broken.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const [copyLabel, setCopyLabel] = useState("Copy diagnostics");

  const onCopyDiagnostics = async () => {
    const copied = await copyDiagnostics(error);
    setCopyLabel(copied ? "Copied" : "Downloaded");
    setTimeout(() => setCopyLabel("Copy diagnostics"), 2000);
  };

  return (
    <html>
      <body style={{ margin: 0, fontFamily: "sans-serif", background: "#faf9f5", color: "#141413" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ fontSize: 14, color: "#3d3d3a", marginBottom: 24 }}>
              {error.message || "An unexpected error occurred."}
            </p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <button
                onClick={() => window.location.reload()}
                style={{
                  height: 36, padding: "0 16px", borderRadius: 6, border: "none",
                  background: "#cc785c", color: "#faf9f5", fontSize: 14, fontWeight: 500, cursor: "pointer",
                }}
              >
                Reload
              </button>
              <button
                onClick={onCopyDiagnostics}
                style={{
                  height: 36, padding: "0 16px", borderRadius: 6, border: "1px solid #e6dfd8",
                  background: "transparent", color: "#3d3d3a", fontSize: 14, fontWeight: 500, cursor: "pointer",
                }}
              >
                {copyLabel}
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
