"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useToast } from "../../../../context/ToastContext";
import type { NetworkLog, NetworkDetails } from "../../../../context/WebExplorerContext";
import { Modal } from "../../../../components/Modal";
import { buildPythonFromNetworkLog } from "../../lib/buildPythonFromNetworkLog";

/** Shows the generated Python client script for one captured request. */
export default function PythonClientModal({
  log,
  details,
  onClose,
}: {
  log: NetworkLog;
  details: NetworkDetails | null;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const [pythonCopied, setPythonCopied] = useState(false);

  const code = buildPythonFromNetworkLog(log, details);

  const copyPythonToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setPythonCopied(true);
      showToast("Python code copied", { type: "success" });
      setTimeout(() => setPythonCopied(false), 1500);
    } catch {
      showToast("Failed to copy", { type: "error" });
    }
  };

  return (
    <Modal title="Python client" onClose={onClose} width={680}>
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-stone leading-relaxed">
          Generated from the captured request and response. Uses{" "}
          <code className="font-mono text-[12px] bg-panel px-1 py-0.5 rounded">requests</code> and{" "}
          <code className="font-mono text-[12px] bg-panel px-1 py-0.5 rounded">pydantic</code>.
        </p>
        <div className="relative">
          <pre className="m-0 p-4 bg-ink-900 text-sage font-mono text-xs leading-relaxed overflow-auto whitespace-pre rounded-xl max-h-[420px]">
            {code}
          </pre>
          <button
            onClick={() => copyPythonToClipboard(code)}
            title="Copy code"
            className="absolute top-3 right-3 h-7 px-2.5 flex items-center gap-1.5 bg-ink-800/80 border border-white/10 rounded-md text-xs font-medium text-cream/70 hover:text-cream hover:bg-ink-700 transition-colors"
          >
            {pythonCopied ? <Check className="h-3.5 w-3.5 text-sage" /> : <Copy className="h-3.5 w-3.5" />}
            {pythonCopied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="flex justify-end pt-1 border-t border-line">
          <button
            onClick={onClose}
            className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
