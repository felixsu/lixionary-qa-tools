"use client";

import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface SecretInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
}

// Masked-by-default input with an eye toggle, for API keys and other secrets.
export default function SecretInput({ value, onChange, placeholder, autoComplete = "off" }: SecretInputProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="relative flex-1">
      <input
        type={revealed ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
        className="w-full h-10 bg-cream border border-line rounded-lg pl-3.5 pr-10 font-mono text-xs text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
      />
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        title={revealed ? "Hide" : "Reveal"}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md flex items-center justify-center text-stone hover:bg-panel hover:text-graphite transition-colors"
      >
        {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
