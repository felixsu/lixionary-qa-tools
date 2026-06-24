"use client";

import React, { useState, useEffect } from "react";
import { Cpu, Globe, ArrowRight, RefreshCw, AlertCircle } from "lucide-react";
import { useAppContext } from "../../context/AppContext";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const { token, handleLogin, handleGuestLogin, isLoadingAuth } = useAppContext();
  const [email, setEmail] = useState("developer@lixionary.com");
  const [errorMsg, setErrorMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  // If already logged in, redirect to workspace
  useEffect(() => {
    if (!isLoadingAuth && token) {
      router.replace("/api-explorer");
    }
  }, [token, isLoadingAuth, router]);

  const onSsoLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setErrorMsg("Please enter an email address.");
      return;
    }
    setErrorMsg("");
    setIsSubmitting(true);
    try {
      await handleLogin(email);
    } catch (err: any) {
      setErrorMsg(err.message || "Login failed.");
    } finally {
      setIsSubmitting(false);
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

        {errorMsg && (
          <div className="flex items-center gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-400 font-semibold">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <p>{errorMsg}</p>
          </div>
        )}

        <form onSubmit={onSsoLogin} className="mt-8 space-y-4">
          <div>
            <label htmlFor="email-address" className="sr-only">
              Developer Email Address
            </label>
            <input
              id="email-address"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="w-full rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-sm placeholder-slate-500 text-slate-200 outline-none transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40"
              placeholder="Developer email (e.g. admin@lixionary.com)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="group flex w-full items-center justify-center gap-3 rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-900 px-4 py-3 text-sm font-semibold transition-all duration-200 hover:border-slate-700 disabled:opacity-50"
          >
            <Globe className="h-5 w-5 text-indigo-500 group-hover:scale-110 transition-transform" />
            Sign in via Lixionary Google SSO
          </button>
        </form>

        <div className="relative flex py-2 items-center">
          <div className="flex-grow border-t border-slate-800/60"></div>
          <span className="flex-shrink mx-4 text-xs font-semibold uppercase tracking-wider text-slate-500">OR</span>
          <div className="flex-grow border-t border-slate-800/60"></div>
        </div>

        <button
          onClick={onGuestLogin}
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 px-4 py-3 text-sm font-semibold shadow-lg shadow-indigo-600/25 transition-all duration-200 disabled:opacity-50"
        >
          {isSubmitting ? "Connecting..." : "Start in Guest Developer Mode"}
          <ArrowRight className="h-4 w-4" />
        </button>

        <div className="mt-6 text-center text-xs text-slate-500">
          Developer sandbox bypass active for local deployments.
        </div>
      </div>
    </div>
  );
}
