"use client";

import React, { useState } from "react";
import {
  Send, Plus, Trash2, Share2, ChevronDown, ChevronRight,
  Sparkles, Code2, Copy, Check, X, CheckCircle2,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { useAppContext } from "../../context/AppContext";
import Dropdown from "../../components/Dropdown";

type ConfigTab = "headers" | "auth" | "variables" | "body";

const methodStyle = (m: string): React.CSSProperties => {
  const map: Record<string, { bg: string; c: string }> = {
    GET: { bg: "#e3f5e9", c: "#276749" },
    POST: { bg: "#e3ecff", c: "#1a4db5" },
    PUT: { bg: "#fff3e0", c: "#9a5c00" },
    DELETE: { bg: "#fde8e8", c: "#c64545" },
    PATCH: { bg: "#f3e8ff", c: "#6d28d9" },
  };
  const s = map[m] || { bg: "#f0f0ee", c: "#6c6a64" };
  return { background: s.bg, color: s.c };
};

export default function ApiExplorerPage() {
  const {
    authFunctions,
    collections,
    selectedCollectionId,
    setSelectedCollectionId,
    selectedRequestId,
    setSelectedRequestId,

    reqMethod,
    setReqMethod,
    reqUrl,
    setReqUrl,
    reqHeaders,
    setReqHeaders,
    reqBodyType,
    setReqBodyType,
    reqBody,
    setReqBody,
    reqAuthType,
    setReqAuthType,
    reqAuthConfig,
    setReqAuthConfig,
    reqParserScript,
    setReqParserScript,

    apiResponse,
    isExecutingApi,
    responseTab,
    setResponseTab,
    showAiModal,
    setShowAiModal,
    aiPrompt,
    setAiPrompt,
    isGeneratingAiParser,
    setIsGeneratingAiParser,

    apiCall,
    handleExecuteRequest,
    handleSaveRequest,
    handleCreateRequest,
    handleCreateCollection,
    handleImportCollection,
    handleAddCollaborator,
  } = useAppContext();

  const [importId, setImportId] = useState("");
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [configTab, setConfigTab] = useState<ConfigTab>("headers");

  const [showNewCollectionModal, setShowNewCollectionModal] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [showNewReqModal, setShowNewReqModal] = useState(false);
  const [newReqName, setNewReqName] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const activeCollection = collections.find((c) => c.id === selectedCollectionId);
  const activeRequest = activeCollection?.requests.find((r) => r.id === selectedRequestId);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const onSave = async () => {
    try {
      await handleSaveRequest();
      showToast("Request saved");
    } catch (err: any) {
      alert(err.message);
    }
  };

  const onCreateCollectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColName) return;
    try {
      await handleCreateCollection(newColName);
      setNewColName("");
      setShowNewCollectionModal(false);
      showToast("Collection created");
    } catch (err: any) {
      alert(err.message);
    }
  };

  const onCreateRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await handleCreateRequest(newReqName || "New Request");
      setNewReqName("");
      setShowNewReqModal(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const onImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importId) return;
    try {
      await handleImportCollection(importId);
      setImportId("");
      showToast("Collection imported");
    } catch (err: any) {
      alert(err.message);
    }
  };

  const onShareSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareEmail) return;
    try {
      await handleAddCollaborator(shareEmail);
      setShareEmail("");
      setShowShareModal(false);
      showToast(`Shared with ${shareEmail}`);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const generateAiParserScript = async () => {
    if (!aiPrompt) return;
    setIsGeneratingAiParser(true);
    try {
      const result = await apiCall("/api/ai/generate-parser", {
        method: "POST",
        body: JSON.stringify({
          prompt: aiPrompt,
          responseSample: apiResponse ? JSON.stringify(apiResponse.body, null, 2) : "",
        }),
      });
      if (result.code) {
        setReqParserScript(result.code);
        setShowAiModal(false);
        setAiPrompt("");
        showToast("Parser script generated");
      }
    } catch (e: any) {
      alert(`AI code generation failed: ${e.message}`);
    } finally {
      setIsGeneratingAiParser(false);
    }
  };

  const configTabs: { id: ConfigTab; label: string }[] = [
    { id: "headers", label: "Headers" },
    { id: "auth", label: "Auth" },
    { id: "variables", label: "Variables" },
    { id: "body", label: "Body" },
  ];

  const responseTabs: ("pretty" | "headers" | "raw" | "extracted")[] = [
    "pretty", "headers", "raw", "extracted",
  ];

  const inputCls =
    "h-[30px] bg-cream border border-line rounded-md px-2.5 font-mono text-xs text-graphite outline-none focus:border-clay";

  return (
    <div className="h-full flex overflow-hidden">

      {/* Collections sidebar */}
      <div className="w-[272px] flex-shrink-0 bg-panel border-r border-line flex flex-col overflow-hidden">
        <div className="px-4 py-3.5 border-b border-line flex items-center justify-between flex-shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-stone">Collections</span>
          <div className="flex gap-1">
            <button
              onClick={() => setShowNewCollectionModal(true)}
              title="New collection"
              className="h-7 w-7 rounded-md border border-line bg-cream flex items-center justify-center hover:bg-hover transition-colors"
            >
              <Plus className="h-3.5 w-3.5 text-graphite" />
            </button>
            <button
              onClick={() => setShowShareModal(true)}
              disabled={!selectedCollectionId}
              title="Share collection"
              className="h-7 w-7 rounded-md border border-line bg-cream flex items-center justify-center hover:bg-hover transition-colors disabled:opacity-40"
            >
              <Share2 className="h-3.5 w-3.5 text-graphite" />
            </button>
          </div>
        </div>

        {/* Import bar */}
        <form onSubmit={onImportSubmit} className="px-3 py-2.5 border-b border-line flex gap-1.5 flex-shrink-0">
          <input
            type="text"
            placeholder="Import by collection ID…"
            value={importId}
            onChange={(e) => setImportId(e.target.value)}
            className="flex-1 h-[30px] bg-cream border border-line rounded-md px-2.5 text-xs text-graphite outline-none focus:border-clay"
          />
          <button
            type="submit"
            className="h-[30px] px-2.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-hover transition-colors"
          >
            Import
          </button>
        </form>

        {/* Collections list */}
        <div className="flex-1 overflow-y-auto p-2">
          {collections.map((col) => {
            const isExpanded = col.id === selectedCollectionId;
            return (
              <div key={col.id} className="mb-1">
                <div
                  onClick={() => {
                    setSelectedCollectionId(col.id);
                    setSelectedRequestId(col.requests.length ? col.requests[0].id : "");
                  }}
                  className="group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-hover transition-colors"
                  style={{ background: isExpanded ? "var(--color-hover)" : "transparent" }}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3 text-stone flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-stone flex-shrink-0" />
                  )}
                  <span className="flex-1 text-[13px] font-medium text-ink truncate">{col.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyId(col.id);
                    }}
                    title="Copy collection ID"
                    className="opacity-0 group-hover:opacity-100 text-stone hover:text-clay transition"
                  >
                    {copiedId === col.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {isExpanded && (
                  <div className="pl-2 py-0.5 flex flex-col gap-px">
                    {col.requests.map((req) => {
                      const active = req.id === selectedRequestId;
                      return (
                        <div
                          key={req.id}
                          onClick={() => setSelectedRequestId(req.id)}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer hover:bg-cream transition-colors"
                          style={{
                            background: active ? "var(--color-cream)" : "transparent",
                            borderLeft: `3px solid ${active ? "var(--color-clay)" : "transparent"}`,
                          }}
                        >
                          <span
                            className="font-mono text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0"
                            style={methodStyle(req.method)}
                          >
                            {req.method}
                          </span>
                          <span className="text-xs text-graphite truncate">{req.name}</span>
                        </div>
                      );
                    })}
                    <button
                      onClick={() => setShowNewReqModal(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 mt-1 w-full border border-dashed border-line rounded-md text-[11px] text-mute hover:border-clay hover:text-clay transition-colors"
                    >
                      <Plus className="h-3 w-3" /> Add request
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {collections.length === 0 && (
            <p className="text-xs text-mute text-center px-4 py-8 leading-relaxed">
              No collections yet. Create one with the + button above.
            </p>
          )}
        </div>
      </div>

      {/* Workspace */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeRequest ? (
          <>
            {/* Request bar */}
            <div className="px-4 py-3.5 border-b border-line flex gap-2 items-center flex-shrink-0 bg-cream">
              <Dropdown
                value={reqMethod}
                onChange={setReqMethod}
                options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({
                  value: m,
                  label: <span className="font-mono text-xs font-medium">{m}</span>,
                }))}
                className="h-[38px] flex items-center bg-cream border border-line rounded-lg pl-3 pr-2 hover:bg-panel transition-colors flex-shrink-0"
                renderTrigger={(_, open) => (
                  <>
                    <span className="font-mono text-xs font-medium px-2 py-0.5 rounded" style={methodStyle(reqMethod)}>
                      {reqMethod}
                    </span>
                    <ChevronDown className={`h-3.5 w-3.5 text-stone ml-1.5 transition-transform ${open ? "rotate-180" : ""}`} />
                  </>
                )}
              />

              <input
                type="text"
                value={reqUrl}
                onChange={(e) => setReqUrl(e.target.value)}
                placeholder="Request URL (e.g. {{BASE_URL}}/api/users)"
                className="flex-1 h-[38px] bg-cream border border-line rounded-lg px-3.5 font-mono text-xs text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
              />

              <button
                onClick={onSave}
                className="h-[38px] px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
              >
                Save
              </button>

              <button
                onClick={handleExecuteRequest}
                disabled={isExecutingApi}
                className="h-[38px] px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white flex items-center gap-2 transition-colors disabled:opacity-60 flex-shrink-0"
              >
                {isExecutingApi ? (
                  <span
                    className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white"
                    style={{ animation: "spin 0.7s linear infinite" }}
                  />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send
              </button>
            </div>

            {/* Config panel */}
            <div className="flex-shrink-0 h-[250px] flex flex-col border-b border-line overflow-hidden">
              <div className="flex border-b border-line flex-shrink-0 bg-cream">
                {configTabs.map((tab) => {
                  const on = configTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setConfigTab(tab.id)}
                      className="px-[18px] py-2.5 text-[13px] transition-colors"
                      style={{
                        borderBottom: `2px solid ${on ? "var(--color-clay)" : "transparent"}`,
                        color: on ? "var(--color-ink)" : "var(--color-stone)",
                        fontWeight: on ? 500 : 400,
                      }}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex-1 overflow-y-auto">
                {/* Headers */}
                {configTab === "headers" && (
                  <div className="p-4 flex flex-col gap-1.5">
                    {reqHeaders.length === 0 && (
                      <p className="text-xs text-mute py-4 text-center">No headers defined.</p>
                    )}
                    {reqHeaders.map((header, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          value={header.key}
                          placeholder="Header"
                          onChange={(e) => {
                            const next = [...reqHeaders];
                            next[idx].key = e.target.value;
                            setReqHeaders(next);
                          }}
                          className={`${inputCls} w-[156px]`}
                        />
                        <input
                          value={header.value}
                          placeholder="Value"
                          onChange={(e) => {
                            const next = [...reqHeaders];
                            next[idx].value = e.target.value;
                            setReqHeaders(next);
                          }}
                          className={`${inputCls} flex-1`}
                        />
                        <button
                          onClick={() => setReqHeaders(reqHeaders.filter((_, i) => i !== idx))}
                          className="h-7 w-7 rounded-md border border-line flex items-center justify-center text-stone hover:bg-danger-soft hover:text-danger transition-colors flex-shrink-0"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setReqHeaders([...reqHeaders, { key: "", value: "" }])}
                      className="flex items-center gap-1.5 px-3 py-1.5 mt-1 w-fit border border-dashed border-line rounded-md text-xs text-mute hover:border-clay hover:text-clay transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add header
                    </button>
                  </div>
                )}

                {/* Auth */}
                {configTab === "auth" && (
                  <div className="p-4 flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-stone">Auth type</label>
                      <Dropdown
                        value={reqAuthType}
                        onChange={setReqAuthType}
                        widthClass="w-full"
                        options={[
                          { value: "NONE", label: "No auth" },
                          { value: "BEARER", label: "Bearer token" },
                          { value: "API_KEY", label: "Header API key" },
                          { value: "HOOK", label: "Dynamic auth hook" },
                        ]}
                      />
                    </div>

                    {reqAuthType === "BEARER" && (
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-stone">Token</label>
                        <input
                          type="text"
                          placeholder="Token or {{VARIABLE}}"
                          value={reqAuthConfig.token || ""}
                          onChange={(e) => setReqAuthConfig({ ...reqAuthConfig, token: e.target.value })}
                          className="h-[38px] bg-cream border border-line rounded-lg px-3.5 font-mono text-xs text-ink outline-none focus:border-clay"
                        />
                      </div>
                    )}

                    {reqAuthType === "API_KEY" && (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Header key"
                          value={reqAuthConfig.key || ""}
                          onChange={(e) => setReqAuthConfig({ ...reqAuthConfig, key: e.target.value })}
                          className="w-1/2 h-[38px] bg-cream border border-line rounded-lg px-3.5 font-mono text-xs text-ink outline-none focus:border-clay"
                        />
                        <input
                          type="text"
                          placeholder="Value"
                          value={reqAuthConfig.value || ""}
                          onChange={(e) => setReqAuthConfig({ ...reqAuthConfig, value: e.target.value })}
                          className="w-1/2 h-[38px] bg-cream border border-line rounded-lg px-3.5 font-mono text-xs text-ink outline-none focus:border-clay"
                        />
                      </div>
                    )}

                    {reqAuthType === "HOOK" && (
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-stone">Auth hook</label>
                        <Dropdown
                          value={reqAuthConfig.authFunctionId || ""}
                          onChange={(v) => setReqAuthConfig({ ...reqAuthConfig, authFunctionId: v })}
                          placeholder="Select auth hook…"
                          widthClass="w-full"
                          options={authFunctions.map((f) => ({ value: f.id, label: f.name }))}
                        />
                      </div>
                    )}

                    {reqAuthType === "NONE" && (
                      <p className="text-[11px] text-mute">No authentication configured.</p>
                    )}
                  </div>
                )}

                {/* Variables */}
                {configTab === "variables" && (
                  <div className="flex flex-col h-full">
                    <div className="px-4 py-3 flex items-center justify-between flex-shrink-0">
                      <span className="text-xs text-stone">Parser script — runs after response</span>
                      <button
                        onClick={() => setShowAiModal(true)}
                        disabled={!apiResponse}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-cream border border-line rounded-md text-xs font-medium text-clay hover:bg-panel transition-colors disabled:opacity-50"
                      >
                        <Sparkles className="h-3.5 w-3.5" /> AI agent parser
                      </button>
                    </div>
                    <div className="flex-1 mx-4 mb-4 rounded-lg overflow-hidden border border-line">
                      <Editor
                        height="100%"
                        language="javascript"
                        theme="vs-dark"
                        value={reqParserScript}
                        onChange={(val) => setReqParserScript(val || "")}
                        options={{
                          minimap: { enabled: false },
                          fontSize: 12,
                          lineNumbers: "on",
                          scrollbar: { vertical: "auto", horizontal: "hidden" },
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Body */}
                {configTab === "body" && (
                  <div className="flex flex-col h-full">
                    <div className="px-4 py-3 flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs font-medium text-stone">Type</span>
                      <Dropdown
                        value={reqBodyType}
                        onChange={setReqBodyType}
                        className="h-[30px] px-3 rounded-md text-xs text-ink"
                        options={[
                          { value: "NONE", label: "None" },
                          { value: "JSON", label: "JSON" },
                          { value: "TEXT", label: "Text" },
                        ]}
                      />
                    </div>
                    <div className="flex-1 mx-4 mb-4 rounded-lg overflow-hidden border border-line">
                      {reqBodyType === "NONE" ? (
                        <div className="h-full flex items-center justify-center text-xs text-mute">
                          No request body. Change type to edit.
                        </div>
                      ) : (
                        <Editor
                          height="100%"
                          language={reqBodyType.toLowerCase()}
                          theme="vs-dark"
                          value={reqBody}
                          onChange={(val) => setReqBody(val || "")}
                          options={{
                            minimap: { enabled: false },
                            fontSize: 12,
                            lineNumbers: "on",
                            scrollbar: { vertical: "auto", horizontal: "hidden" },
                          }}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Response panel */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-[160px]">
              <div className="flex items-stretch border-b border-line flex-shrink-0 bg-cream">
                {responseTabs.map((tab) => {
                  const on = responseTab === tab;
                  return (
                    <button
                      key={tab}
                      onClick={() => setResponseTab(tab)}
                      className="px-4 py-2.5 text-[13px] capitalize transition-colors"
                      style={{
                        borderBottom: `2px solid ${on ? "var(--color-clay)" : "transparent"}`,
                        color: on ? "var(--color-ink)" : "var(--color-stone)",
                        fontWeight: on ? 500 : 400,
                      }}
                    >
                      {tab}
                    </button>
                  );
                })}
                <div className="flex-1" />
                {apiResponse && (
                  <div className="flex items-center gap-2 px-4">
                    <span
                      className="font-mono text-xs font-medium px-2.5 py-0.5 rounded-full"
                      style={
                        apiResponse.status < 400
                          ? { background: "#e3f5e9", color: "#276749" }
                          : { background: "#fde8e8", color: "#c64545" }
                      }
                    >
                      {apiResponse.status} {apiResponse.statusText}
                    </span>
                    <span className="font-mono text-xs text-stone">{apiResponse.executionTimeMs} ms</span>
                  </div>
                )}
              </div>

              {!apiResponse ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
                  <Send className="h-7 w-7 text-mute" />
                  <div className="text-sm font-medium text-mute">Send a request to see the response</div>
                  <div className="text-[13px] text-mute text-center max-w-[300px] leading-relaxed">
                    Pretty, Headers, Raw and Extracted variables appear here.
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-hidden flex flex-col">
                  {responseTab === "pretty" && (
                    <pre className="flex-1 m-0 p-4 bg-ink-900 text-sage font-mono text-xs leading-relaxed overflow-auto whitespace-pre-wrap">
                      {typeof apiResponse.body === "object"
                        ? JSON.stringify(apiResponse.body, null, 2)
                        : apiResponse.body}
                    </pre>
                  )}
                  {responseTab === "headers" && (
                    <div className="flex-1 overflow-y-auto p-4">
                      {Object.entries(apiResponse.headers || {}).map(([k, v]) => (
                        <div key={k} className="flex items-baseline gap-2 py-2 border-b border-line-soft">
                          <span className="font-mono text-xs text-stone flex-shrink-0 min-w-[180px]">{k}</span>
                          <span className="font-mono text-xs text-ink break-all">{v as string}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {responseTab === "raw" && (
                    <pre className="flex-1 m-0 p-4 bg-ink-900 text-cream/80 font-mono text-xs leading-relaxed overflow-auto whitespace-pre-wrap">
                      {JSON.stringify(apiResponse, null, 2)}
                    </pre>
                  )}
                  {responseTab === "extracted" && (
                    <div className="flex-1 p-4 overflow-y-auto">
                      {apiResponse.parsedVariables && Object.keys(apiResponse.parsedVariables).length ? (
                        <div className="flex flex-col gap-1.5">
                          {Object.entries(apiResponse.parsedVariables).map(([k, v]) => (
                            <div
                              key={k}
                              className="flex items-center gap-2.5 px-3.5 py-2.5 bg-panel border border-line rounded-lg"
                            >
                              <span className="font-mono text-xs font-medium text-clay min-w-[120px]">{k}</span>
                              <span className="text-[11px] text-stone">=</span>
                              <span className="font-mono text-[11px] text-graphite flex-1 truncate">{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-2.5 min-h-[100px]">
                          <Code2 className="h-6 w-6 text-mute" />
                          <p className="text-[13px] text-mute text-center">
                            No variables extracted. Add a parser script in the Variables tab.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-mute">
            Select a request from the collections to begin testing.
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 bg-ink-900 text-cream px-4 py-3 rounded-lg border-l-4 border-sage text-[13px] shadow-[0_4px_16px_rgba(20,20,19,0.24)] max-w-[360px]"
          style={{ animation: "fadeUp 0.2s ease-out" }}
        >
          <CheckCircle2 className="h-4 w-4 text-sage flex-shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* Modals */}
      {showNewCollectionModal && (
        <Modal title="Create collection" onClose={() => setShowNewCollectionModal(false)}>
          <form onSubmit={onCreateCollectionSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">Name</label>
              <input
                type="text"
                placeholder="e.g. Authentication Suite"
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                autoFocus
                required
                className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
              />
            </div>
            <ModalFooter onCancel={() => setShowNewCollectionModal(false)} submitLabel="Create" />
          </form>
        </Modal>
      )}

      {showNewReqModal && (
        <Modal title="Create request" onClose={() => setShowNewReqModal(false)}>
          <form onSubmit={onCreateRequestSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">Name</label>
              <input
                type="text"
                placeholder="e.g. Get user profile"
                value={newReqName}
                onChange={(e) => setNewReqName(e.target.value)}
                autoFocus
                className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
              />
            </div>
            <ModalFooter onCancel={() => setShowNewReqModal(false)} submitLabel="Create" />
          </form>
        </Modal>
      )}

      {showShareModal && (
        <Modal title="Share collection" onClose={() => setShowShareModal(false)}>
          <form onSubmit={onShareSubmit} className="flex flex-col gap-5">
            <p className="text-[13px] text-stone leading-relaxed">
              Share this collection with another developer by email. It will appear in their workspace.
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">Email</label>
              <input
                type="email"
                placeholder="collaborator@lixionary.com"
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
                autoFocus
                required
                className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
              />
            </div>
            <ModalFooter onCancel={() => setShowShareModal(false)} submitLabel="Share" />
          </form>
        </Modal>
      )}

      {showAiModal && (
        <Modal title="AI agent parser" onClose={() => setShowAiModal(false)} width={560}>
          <div className="flex flex-col gap-5">
            <p className="text-[13px] text-stone leading-relaxed">
              Describe how to extract tokens, variables, or keys from the sample response. The agent
              generates a sandboxed JS parser script for you.
            </p>
            <textarea
              rows={4}
              placeholder="e.g. Extract body.access_token and save it to access_token"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              autoFocus
              className="bg-cream border border-line rounded-lg p-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)] resize-none"
            />
            <div className="flex justify-end gap-2 pt-1 border-t border-line">
              <button
                onClick={() => { setShowAiModal(false); setAiPrompt(""); }}
                disabled={isGeneratingAiParser}
                className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={generateAiParserScript}
                disabled={isGeneratingAiParser || !aiPrompt}
                className="h-10 px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {isGeneratingAiParser && (
                  <span
                    className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white"
                    style={{ animation: "spin 0.7s linear infinite" }}
                  />
                )}
                Generate script
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
  width = 480,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(20,20,19,0.5)", backdropFilter: "blur(2px)" }}
    >
      <div
        className="bg-cream rounded-2xl p-8 shadow-[0_24px_48px_-12px_rgba(20,20,19,0.18)] flex flex-col gap-5"
        style={{ width }}
      >
        <div className="flex items-center justify-between">
          <h2 className="m-0 font-serif text-xl font-medium text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg border border-line flex items-center justify-center hover:bg-panel transition-colors"
          >
            <X className="h-4 w-4 text-graphite" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalFooter({ onCancel, submitLabel }: { onCancel: () => void; submitLabel: string }) {
  return (
    <div className="flex justify-end gap-2 pt-1 border-t border-line">
      <button
        type="button"
        onClick={onCancel}
        className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
      >
        Cancel
      </button>
      <button
        type="submit"
        className="h-10 px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white transition-colors"
      >
        {submitLabel}
      </button>
    </div>
  );
}
