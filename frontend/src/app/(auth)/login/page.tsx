"use client";

import React, { useState, useEffect, useRef } from "react";
import Script from "next/script";
import { Cpu, ArrowRight, RefreshCw, AlertCircle } from "lucide-react";
import { useAppContext } from "../../context/AppContext";
import { useRouter } from "next/navigation";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: object) => void;
          renderButton: (element: HTMLElement, config: object) => void;
          prompt: () => void;
        };
      };
    };
  }
}

export default function LoginPage() {
  const { token, handleLogin, handleGuestLogin, isLoadingAuth } = useAppContext();
  const [errorMsg, setErrorMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [gsiReady, setGsiReady] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Redirect if already logged in
  useEffect(() => {
    if (!isLoadingAuth && token) {
      router.replace("/api-explorer");
    }
  }, [token, isLoadingAuth, router]);

  // Initialize Google Sign-In once the GSI script is loaded and element is mounted
  const initGoogleSignIn = () => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || !window.google?.accounts?.id || !googleBtnRef.current) return;

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response: { credential: string }) => {
        setErrorMsg("");
        setIsSubmitting(true);
        try {
          await handleLogin(response.credential);
        } catch (err: any) {
          setErrorMsg(err.message || "Google Sign-In failed.");
        } finally {
          setIsSubmitting(false);
        }
      },
      use_fedcm_for_prompt: true,
    });

    window.google.accounts.id.renderButton(googleBtnRef.current, {
      type: "standard",
      theme: "filled_black",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: googleBtnRef.current.offsetWidth || 400,
    });

    setGsiReady(true);
  };

  // Re-init if ref becomes available after script load
  useEffect(() => {
    if (gsiReady || !googleBtnRef.current) return;
    initGoogleSignIn();
  }, [googleBtnRef.current]);

  const onGuestLogin = async () => {
    setErrorMsg("");
    setIsSubmitting(true);
    try {
      await handleGuestLogin();
    } catch (err: any) {
      setErrorMsg(err.message || "Guest login failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingAuth) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-10 w-10 animate-spin text-indigo-500" />
          <p className="text-sm font-medium">Loading Lixionary Workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Load Google Identity Services script */}
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={initGoogleSignIn}
      />

      <div className="flex min-h-screen w-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black text-slate-200 px-4">
        <div className="w-full max-w-md space-y-8 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-8 shadow-2xl backdrop-blur-xl">
          
          {/* Header */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 shadow-lg shadow-indigo-500/30">
              <Cpu className="h-9 w-9 text-white" />
            </div>
            <h1 className="mt-6 text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-indigo-200 to-violet-300 bg-clip-text text-transparent">
              Lixionary Explorer
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              The collaborative API automation and POM client synthesiser.
            </p>
          </div>

          {/* Error message */}
          {errorMsg && (
            <div className="flex items-center gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-400 font-semibold">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <p>{errorMsg}</p>
            </div>
          )}

          {/* Google Sign-In button container */}
          <div className="space-y-4">
            <p className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
              Sign in with your organisation account
            </p>

            {/* The GSI library renders its button into this div */}
            <div
              ref={googleBtnRef}
              id="google-signin-btn"
              className="w-full flex justify-center min-h-[44px]"
            />

            {/* Loading skeleton while GSI script loads */}
            {!gsiReady && (
              <div className="w-full h-11 rounded-md bg-slate-800/60 animate-pulse" />
            )}
          </div>

          <div className="relative flex py-2 items-center">
            <div className="flex-grow border-t border-slate-800/60"></div>
            <span className="flex-shrink mx-4 text-xs font-semibold uppercase tracking-wider text-slate-500">OR</span>
            <div className="flex-grow border-t border-slate-800/60"></div>
          </div>

          {/* Guest / Developer mode */}
          <button
            onClick={onGuestLogin}
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 px-4 py-3 text-sm font-semibold shadow-lg shadow-indigo-600/25 transition-all duration-200 disabled:opacity-50"
          >
            {isSubmitting ? "Connecting..." : "Start in Guest Developer Mode"}
            <ArrowRight className="h-4 w-4" />
          </button>

          <div className="mt-6 text-center text-xs text-slate-500">
            Guest mode uses a shared read-only sandbox account.
          </div>
        </div>
      </div>
    </>
  );
}
