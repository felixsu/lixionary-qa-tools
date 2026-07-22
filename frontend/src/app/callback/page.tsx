"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { RefreshCw, AlertCircle, CheckCircle } from "lucide-react";
import { useAppContext } from "../context/AppContext";

const LOCAL_API_URL = process.env.NEXT_PUBLIC_LOCAL_API_URL || "http://localhost:8484";

function CallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { handleLogin, token } = useAppContext();
  const [errorMsg, setErrorMsg] = useState("");
  const [isProcessing, setIsProcessing] = useState(true);
  const [relayDone, setRelayDone] = useState(false);

  const state = searchParams.get("state");
  const isDesktopRelay = !!state && state.endsWith(".desktop");

  // If already logged in, redirect directly to home — but never for a
  // desktop relay, which runs in the user's own browser, not the app webview.
  useEffect(() => {
    if (token && !isDesktopRelay) {
      router.replace("/home");
    }
  }, [token, isDesktopRelay, router]);

  useEffect(() => {
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      setErrorMsg(error === "access_denied" ? "Authorization access was denied by user." : `Authentication failed: ${error}`);
      setIsProcessing(false);
      return;
    }

    if (!code) {
      setErrorMsg("Authorization code is missing from callback URL.");
      setIsProcessing(false);
      return;
    }

    if (isDesktopRelay) {
      // Desktop sign-in: this page is open in the system browser. Hand the
      // code to the local sidecar for the app to pick up instead of
      // exchanging it here. Retry for a while — on the app's first launch the
      // sidecar spends minutes bootstrapping its venv and may not be
      // listening yet, and the app itself polls for the code for 3 minutes.
      const relay = async () => {
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          try {
            const res = await fetch(`${LOCAL_API_URL}/api/auth-bridge/code`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code, state }),
            });
            if (res.ok) {
              setRelayDone(true);
              setIsProcessing(false);
              return;
            }
          } catch {
            // sidecar not reachable yet — keep retrying
          }
          await new Promise((r) => setTimeout(r, 3000));
        }
        setErrorMsg("Could not hand the sign-in back to the desktop app. Make sure the Lixionary QA Tools app is running and finished its first-launch setup, then try signing in again.");
        setIsProcessing(false);
      };
      relay();
      return;
    }

    const exchangeCode = async () => {
      try {
        await handleLogin(code);
      } catch (err: any) {
        console.error("Code exchange failed:", err);
        setErrorMsg(err.message || "Failed to exchange authorization code for session tokens.");
        setIsProcessing(false);
      }
    };

    exchangeCode();
  }, [searchParams, handleLogin, isDesktopRelay, state]);

  if (relayDone) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-4 text-center">
          <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 mb-2">
            <CheckCircle className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold text-slate-100">Sign-in complete</h2>
          <p className="text-sm text-slate-400">
            Return to the <strong>Lixionary QA Tools</strong> app to continue. You can close this tab.
          </p>
        </div>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-10 w-10 animate-spin text-indigo-500" />
          <p className="text-sm font-medium">
            {isDesktopRelay
              ? "Handing the sign-in to the Lixionary QA Tools app..."
              : "Verifying authorization code with Google..."}
          </p>
        </div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-4 text-center">
          <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 mb-2">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold text-slate-100">Authentication Error</h2>
          <p className="text-sm text-slate-400">{errorMsg}</p>
          <button
            onClick={() => router.replace("/login")}
            className="w-full h-10 bg-slate-800 hover:bg-slate-700 active:bg-slate-650 text-slate-200 font-medium rounded-lg text-sm transition-colors mt-2"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-10 w-10 animate-spin text-indigo-500" />
          <p className="text-sm font-medium">Loading callback data...</p>
        </div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}
