"use client";

import React, { useState, useEffect, useRef } from "react";
import { Cpu, AlertCircle, Shield } from "lucide-react";
import { useAppContext } from "../../context/AppContext";
import { useRouter } from "next/navigation";
import { isTauri } from "../../utils/tauri";
import { useAppVersion } from "../../utils/useAppVersion";
import BackendStatusIndicator from "../../components/BackendStatusIndicator";

const LOCAL_API_URL = process.env.NEXT_PUBLIC_LOCAL_API_URL || "http://localhost:8484";

export default function LoginPage() {
  const { token, handleLogin, isLoadingAuth } = useAppContext();
  const appVersion = useAppVersion();
  const [errorMsg, setErrorMsg] = useState("");
  const [isWaitingExternal, setIsWaitingExternal] = useState(false);
  const pollCancelledRef = useRef(false);
  const router = useRouter();

  useEffect(() => {
    return () => {
      pollCancelledRef.current = true;
    };
  }, []);

  // Redirect if already logged in
  useEffect(() => {
    if (!isLoadingAuth && token) {
      router.replace("/home");
    }
  }, [token, isLoadingAuth, router]);

  const onGoogleLogin = async () => {
    setErrorMsg("");
    try {
      const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
      const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI || "http://localhost:8481/callback";
      const scope = "openid profile email";
      const desktop = isTauri();
      // The .desktop suffix tells the callback page (opened in the system
      // browser) to relay the code to the local sidecar instead of exchanging
      // it in that browser.
      const state = Math.random().toString(36).substring(2, 15) + (desktop ? ".desktop" : "");

      localStorage.setItem("oauth_state", state);

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}&prompt=select_account`;

      if (!desktop) {
        window.location.href = authUrl;
        return;
      }

      // Desktop: Google Identity Services popups don't work inside the Tauri
      // webview, so run the whole OAuth flow in the system browser and poll
      // the sidecar for the code the callback page relays back.

      // Preflight: the relay depends on the local sidecar. Fail fast with an
      // actionable message instead of a browser round-trip that can't land.
      try {
        const health = await fetch(`${LOCAL_API_URL}/api/browser-helper/status`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!health.ok) throw new Error();
      } catch {
        throw new Error(
          "The app's local service isn't running yet. On first launch it needs a few minutes to set itself up (requires Python 3 and an internet connection) — please try again shortly. If this keeps happening, check that Python 3 is installed."
        );
      }

      // Flush any stale code left in the sidecar's single-slot mailbox by an
      // earlier abandoned/overlapping attempt (e.g. picked the wrong account,
      // then retried) — otherwise the very first poll below can pop that
      // leftover instead of the one this attempt is about to produce.
      try {
        await fetch(`${LOCAL_API_URL}/api/auth-bridge/code`);
      } catch {
        // already confirmed reachable above — a transient failure here is harmless
      }

      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_external", { url: authUrl });

      setIsWaitingExternal(true);
      pollCancelledRef.current = false;
      const deadline = Date.now() + 180_000;
      let picked: { code: string; state?: string } | null = null;

      while (Date.now() < deadline && !pollCancelledRef.current) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const res = await fetch(`${LOCAL_API_URL}/api/auth-bridge/code`);
          if (res.ok) {
            const data = await res.json();
            // A code whose state doesn't match ours can only be stale leftover
            // from another attempt (state is generated locally, then echoed
            // back verbatim by Google) — discard it and keep waiting for ours,
            // rather than hard-failing the user out of a flow that's still in
            // progress.
            if (!data.pending && data.code && data.state === localStorage.getItem("oauth_state")) {
              picked = data;
              break;
            }
          }
        } catch {
          // sidecar may still be booting — keep polling
        }
      }

      if (pollCancelledRef.current) return;
      if (!picked) {
        throw new Error("Timed out waiting for the browser sign-in to complete. Please try again.");
      }

      await handleLogin(picked.code);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to initialize Google sign-in redirect.");
    } finally {
      setIsWaitingExternal(false);
    }
  };

  if (isLoadingAuth) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-cream text-ink">
        <div className="flex flex-col items-center gap-4">
          <div
            className="h-8 w-8 rounded-full border-2 border-line border-t-clay"
            style={{ animation: "spin 0.8s linear infinite" }}
          />
          <p className="text-sm font-medium text-stone">Loading Lixionary Workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-cream text-ink font-sans px-4">
      <div className="relative w-full max-w-md space-y-8 rounded-2xl border border-line bg-cream p-8 shadow-[0_24px_48px_-12px_rgba(20,20,19,0.18)]">

        <div className="absolute top-4 right-4">
          <BackendStatusIndicator compact />
        </div>

        {/* Header */}
        <div className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-clay">
            <Cpu className="h-9 w-9 text-cream" />
          </div>
          <h1 className="mt-6 font-serif text-3xl font-medium tracking-[-0.3px] text-ink">
            Lixionary Explorer
          </h1>
          <p className="mt-2 text-sm text-stone">
            The collaborative API automation and POM client synthesiser.
          </p>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="flex items-center gap-2.5 rounded-xl border border-danger/30 bg-danger-soft p-3.5 text-xs text-danger font-semibold">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <p>{errorMsg}</p>
          </div>
        )}

        {/* Google Auth Button */}
        <div className="space-y-4">
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-mute">
            Sign in with your Google account
          </p>

          {isWaitingExternal ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-panel px-4 py-4">
              <div
                className="h-5 w-5 rounded-full border-2 border-line border-t-clay"
                style={{ animation: "spin 0.8s linear infinite" }}
              />
              <p className="m-0 text-center text-xs text-graphite leading-relaxed">
                Complete the sign-in in your browser, then return here.
              </p>
              <button
                onClick={() => {
                  pollCancelledRef.current = true;
                  setIsWaitingExternal(false);
                }}
                className="text-xs font-medium text-mute hover:text-ink transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={onGoogleLogin}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-clay hover:bg-clay-dark text-white px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-50 active:scale-[0.99]"
            >
              <Shield className="h-4.5 w-4.5" />
              Sign in with Google
            </button>
          )}
        </div>

        {appVersion && (
          <div className="text-center text-[11px] text-mute/70">v{appVersion}</div>
        )}
      </div>
    </div>
  );
}
