"use client";

import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { isTauri } from "../utils/tauri";

// Static export ships one HTML/JS bundle that runs both inside the Tauri
// webview and in a plain browser tab. This app is only supported in the
// former — `npm run dev` (NODE_ENV=development) is exempt so browser-based
// local testing keeps working.
const DEV_MODE = process.env.NODE_ENV === "development";

export default function TauriOnlyGate({ children }: { children: React.ReactNode }) {
  const [allowed, setAllowed] = useState(DEV_MODE);

  useEffect(() => {
    // isTauri() reads window.__TAURI_INTERNALS__, which isn't present during
    // the static-export pre-render — deferring the check into a microtask
    // (rather than calling setState synchronously in the effect body) avoids
    // a hydration mismatch against that pre-rendered HTML.
    Promise.resolve().then(() => {
      if (isTauri()) setAllowed(true);
    });
  }, []);

  if (!allowed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-cream text-ink px-6 text-center">
        <Cpu className="h-10 w-10 text-clay mb-4" />
        <h1 className="text-xl font-semibold mb-2">Desktop app required</h1>
        <p className="text-sm text-stone max-w-sm">
          Lixionary QA Tools only runs inside the desktop client. Please download and open the app instead of visiting this page in a browser.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
