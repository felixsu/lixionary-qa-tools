"use client";

import React, { useRef, useState } from "react";
import { Activity, Check, Code2, Copy, RotateCcw, Save, X } from "lucide-react";
import { useWebExplorer } from "../../../context/WebExplorerContext";
import type { NetworkLog } from "../../../context/WebExplorerContext";
import { methodStyle, statusStyle } from "../../../utils/methodStyle";
import { sectionLabel } from "../lib/styles";

/**
 * Network Activity view: captured request list (filterable) on the left,
 * selected request/response details on the right.
 */
export default function NetworkPanel({
  onOpenPythonModal,
  onOpenSaveModal,
}: {
  onOpenPythonModal: (log: NetworkLog, e: React.MouseEvent) => void;
  onOpenSaveModal: (log: NetworkLog, e: React.MouseEvent) => void;
}) {
  const {
    networkLogs,
    networkFilter,
    setNetworkFilter,
    networkPillFilter,
    setNetworkPillFilter,
    handleClearNetworkLogs,
    logDetails,
    setLogDetails,
    handleLogClick,
  } = useWebExplorer();

  const filteredLogs = networkLogs.filter((log) => {
    const matchesText =
      networkFilter === "" ||
      log.url.toLowerCase().includes(networkFilter.toLowerCase()) ||
      log.method.toLowerCase().includes(networkFilter.toLowerCase());
    const matchesPill =
      networkPillFilter === "all" ||
      (networkPillFilter === "api" && log.url.toLowerCase().includes("api"));
    return matchesText && matchesPill;
  });

  return (
    <div className="w-full h-full flex overflow-hidden bg-cream font-sans">
      {/* Left pane: Requests list */}
      <div className="w-1/2 h-full border-r border-line flex flex-col overflow-hidden bg-panel">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between flex-shrink-0">
          <span className={sectionLabel}>
            <Activity className="h-3.5 w-3.5 text-stone" /> Network requests
          </span>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-danger animate-pulse" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-danger">Recording</span>
            </div>
            <button
              onClick={handleClearNetworkLogs}
              title="Clear network log"
              className="h-[22px] px-2 rounded-md border border-line text-[10px] font-medium text-mute hover:text-ink hover:border-clay transition-colors flex items-center gap-1"
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          </div>
        </div>
        <div className="px-3 pt-2.5 pb-0 flex gap-1.5 flex-shrink-0">
          {(["all", "api"] as const).map((pill) => (
            <button
              key={pill}
              onClick={() => setNetworkPillFilter(pill)}
              className={`h-[22px] px-2.5 rounded-full text-[10px] font-semibold transition-colors ${
                networkPillFilter === pill
                  ? "bg-clay text-white"
                  : "bg-line text-mute hover:text-ink"
              }`}
            >
              {pill === "all" ? "Show all" : "API"}
            </button>
          ))}
        </div>
        <div className="p-3 pb-3 pt-2 border-b border-line flex-shrink-0">
          <input
            type="text"
            placeholder="Filter by URL or method…"
            value={networkFilter}
            onChange={(e) => setNetworkFilter(e.target.value)}
            className="w-full h-[32px] bg-cream border border-line rounded-lg px-3 text-xs text-graphite outline-none focus:border-clay transition-colors"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {filteredLogs.map((log) => {
            const isActive = logDetails?.request.url === log.url && logDetails?.request.method === log.method;
            return (
              <div
                key={log.id}
                onClick={() => handleLogClick(log.id)}
                className={`flex flex-col gap-1.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  isActive ? "bg-cream border-clay" : "bg-cream/40 border-line hover:bg-cream"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={methodStyle(log.method)}>
                    {log.method}
                  </span>
                  <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={statusStyle(log.status)}>
                    {log.status === null ? "Pending" : log.status}
                  </span>
                  <span className="font-mono text-[11px] text-graphite flex-1 truncate">{log.url}</span>
                  <button
                    onClick={(e) => onOpenPythonModal(log, e)}
                    title="Show Python client code"
                    className="h-5 w-5 rounded flex items-center justify-center text-stone hover:text-clay hover:bg-line transition-colors flex-shrink-0"
                  >
                    <Code2 className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => onOpenSaveModal(log, e)}
                    title="Save to API Explorer collection"
                    className="h-5 w-5 rounded flex items-center justify-center text-stone hover:text-clay hover:bg-line transition-colors flex-shrink-0"
                  >
                    <Save className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
          {filteredLogs.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-mute py-12 gap-2">
              <Activity className="h-8 w-8 text-mute/50" />
              <p className="text-xs">No network activity captured yet.</p>
            </div>
          )}
        </div>
      </div>

      {/* Right pane: Selected Request details */}
      <div className="w-1/2 h-full flex flex-col overflow-hidden bg-cream">
        {logDetails ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-line flex items-center justify-between flex-shrink-0 bg-panel">
              <span className="text-xs font-semibold text-graphite font-mono truncate max-w-[80%]">
                {logDetails.request.method} {logDetails.request.url}
              </span>
              <button
                onClick={() => setLogDetails(null)}
                className="h-6 w-6 rounded-md hover:bg-line flex items-center justify-center transition-colors"
              >
                <X className="h-4 w-4 text-mute hover:text-graphite" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 font-mono text-[11px] leading-normal select-text">
              <Field label="Request URL">
                <span className="text-graphite break-all">{logDetails.request.url}</span>
              </Field>
              <div className="flex gap-4">
                <Field label="Method" className="w-1/2">
                  <span className="text-clay font-semibold">{logDetails.request.method}</span>
                </Field>
                <Field label="Status" className="w-1/2">
                  <span className="font-semibold" style={{ color: (logDetails.response?.status ?? 0) < 400 ? "var(--color-clay)" : "var(--color-danger)" }}>
                    {logDetails.response ? `${logDetails.response.status} ${logDetails.response.statusText}` : "Pending"}
                  </span>
                </Field>
              </div>

              {logDetails.request.postData && (() => {
                let requestPayloadText: string;
                try {
                  requestPayloadText = JSON.stringify(JSON.parse(logDetails.request.postData), null, 2);
                } catch {
                  requestPayloadText = logDetails.request.postData;
                }
                return (
                  <Field label="Request Payload" copyText={requestPayloadText}>
                    <pre className="mt-1 p-2 bg-panel rounded border border-line overflow-auto max-h-40 whitespace-pre-wrap font-mono text-[10px]">
                      {requestPayloadText}
                    </pre>
                  </Field>
                );
              })()}

              {logDetails.response?.body && (() => {
                let responsePayloadText: string;
                try {
                  responsePayloadText = JSON.stringify(JSON.parse(logDetails.response.body), null, 2);
                } catch {
                  responsePayloadText = logDetails.response.body;
                }
                return (
                  <Field label="Response Payload" copyText={responsePayloadText}>
                    <pre className="mt-1 p-2 bg-panel rounded border border-line overflow-auto max-h-64 whitespace-pre-wrap font-mono text-[10px]">
                      {responsePayloadText}
                    </pre>
                  </Field>
                );
              })()}

              <Field label="Request Headers">
                <div className="mt-1 p-2 bg-panel rounded border border-line flex flex-col gap-1 overflow-auto max-h-40 text-[10px] font-mono">
                  {Object.entries(logDetails.request.headers || {}).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="text-mute flex-shrink-0 font-semibold">{k}:</span>
                      <span className="text-graphite break-all">{v as string}</span>
                    </div>
                  ))}
                </div>
              </Field>

              {logDetails.response?.headers && (
                <Field label="Response Headers">
                  <div className="mt-1 p-2 bg-panel rounded border border-line flex flex-col gap-1 overflow-auto max-h-40 text-[10px] font-mono">
                    {Object.entries(logDetails.response.headers || {}).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <span className="text-mute flex-shrink-0 font-semibold">{k}:</span>
                        <span className="text-graphite break-all">{v as string}</span>
                      </div>
                    ))}
                  </div>
                </Field>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-mute gap-2">
            <Activity className="h-8 w-8 text-mute/30" />
            <p className="text-xs">Select a request to inspect details.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children, className = "", copyText }: { label: string; children: React.ReactNode; className?: string; copyText?: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      const el = contentRef.current;
      if (!el) return;
      e.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };

  const handleCopy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-mute">{label}</h4>
        {copyText !== undefined && (
          <button
            onClick={handleCopy}
            title="Copy to clipboard"
            className="h-5 w-5 rounded flex items-center justify-center text-stone hover:text-clay hover:bg-line transition-colors"
          >
            {copied ? <Check className="h-3 w-3 text-sage" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </div>
      <div
        ref={contentRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="bg-panel p-2.5 rounded-lg border border-line outline-none focus:ring-1 focus:ring-clay/40"
      >
        {children}
      </div>
    </div>
  );
}
