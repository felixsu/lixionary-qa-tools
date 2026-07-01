"use client";

import React, { useState, useEffect } from "react";
import { Cpu, ArrowRight, AlertCircle, Shield } from "lucide-react";
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
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-line bg-cream p-8 shadow-[0_24px_48px_-12px_rgba(20,20,19,0.18)]">

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

        {/* Lixionary IAM Auth Button */}
        <div className="space-y-4">
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-mute">
            Sign in with your organisation account
          </p>

          <button
            onClick={onIamLogin}
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-clay hover:bg-clay-dark text-white px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-50 active:scale-[0.99]"
          >
            <Shield className="h-4.5 w-4.5" />
            Sign in with Lixionary IAM
          </button>
        </div>

        <div className="relative flex py-2 items-center">
          <div className="flex-grow border-t border-line"></div>
          <span className="flex-shrink mx-4 text-xs font-semibold uppercase tracking-wider text-mute">OR</span>
          <div className="flex-grow border-t border-line"></div>
        </div>

        {/* Guest / Developer mode */}
        <button
          onClick={onGuestLogin}
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-cream border border-line hover:bg-panel text-graphite px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-50 active:scale-[0.99]"
        >
          {isSubmitting ? "Connecting..." : "Start in Guest Developer Mode"}
          <ArrowRight className="h-4 w-4" />
        </button>

        <div className="mt-6 text-center text-xs text-mute">
          Guest mode uses a shared read-only sandbox account.
        </div>
      </div>
    </div>
  );
}
