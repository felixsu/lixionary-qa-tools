"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { RefreshCw, AlertCircle } from "lucide-react";
import { useAppContext } from "../context/AppContext";

function CallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { handleLogin, token } = useAppContext();
  const [errorMsg, setErrorMsg] = useState("");
  const [isProcessing, setIsProcessing] = useState(true);

  // If already logged in, redirect directly to api-explorer
  useEffect(() => {
    if (token) {
      router.replace("/api-explorer");
    }
  }, [token, router]);

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
  }, [searchParams, handleLogin]);

  if (isProcessing) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-10 w-10 animate-spin text-indigo-500" />
          <p className="text-sm font-medium">Verifying authorization code with Lixionary IAM...</p>
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
