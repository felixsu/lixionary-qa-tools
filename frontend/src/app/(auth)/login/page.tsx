"use client";

import React, { useState, useEffect } from "react";
import { Cpu, ArrowRight, RefreshCw, AlertCircle, Shield } from "lucide-react";
import { useAppContext } from "../../context/AppContext";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const { token, handleGuestLogin, isLoadingAuth } = useAppContext();
  const [errorMsg, setErrorMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  // Redirect if already logged in
  useEffect(() => {
    if (!isLoadingAuth && token) {
      router.replace("/api-explorer");
    }
  }, [token, isLoadingAuth, router]);

  const onIamLogin = () => {
    setErrorMsg("");
    try {
      const clientId = process.env.NEXT_PUBLIC_IAM_CLIENT_ID || "ca4d16ef-9a5c-43df-811c-ea9cda47b19a";
      const iamFrontendUrl = process.env.NEXT_PUBLIC_IAM_FRONTEND_URL || "http://localhost:8081";
      const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI || "http://localhost:8481/callback";
      const scope = "openid profile email";
      const state = Math.random().toString(36).substring(2, 15);
      
      localStorage.setItem("oauth_state", state);

      window.location.href = `${iamFrontendUrl}/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}`;
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to initialize IAM Login redirect.");
    }
  };

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

        {/* Lixionary IAM Auth Button */}
        <div className="space-y-4">
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
            Sign in with your organisation account
          </p>

          <button
            onClick={onIamLogin}
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-slate-100 hover:bg-white text-slate-950 px-4 py-3 text-sm font-semibold transition-all duration-200 disabled:opacity-50 shadow-md shadow-white/5 active:scale-[0.99]"
          >
            <Shield className="h-4.5 w-4.5 text-indigo-600" />
            Sign in with Lixionary IAM
          </button>
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
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 px-4 py-3 text-sm font-semibold shadow-lg shadow-indigo-600/25 transition-all duration-200 disabled:opacity-50 active:scale-[0.99]"
        >
          {isSubmitting ? "Connecting..." : "Start in Guest Developer Mode"}
          <ArrowRight className="h-4 w-4" />
        </button>

        <div className="mt-6 text-center text-xs text-slate-500">
          Guest mode uses a shared read-only sandbox account.
        </div>
      </div>
    </div>
  );
}
