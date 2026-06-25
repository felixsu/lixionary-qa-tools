"use client";

import React, { useState } from "react";
import { 
  Play, Send, Plus, Trash, Share2, 
  Lock, Unlock, RefreshCw, AlertCircle, Copy, Check
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { useAppContext } from "../../context/AppContext";

export default function ApiExplorerPage() {
  const {
    environments,
    selectedEnvId,
    authFunctions,
    collections,
    selectedCollectionId,
    setSelectedCollectionId,
    selectedRequestId,
    setSelectedRequestId,
    
    reqName,
    setReqName,
    reqMethod,
    setReqMethod,
    reqUrl,
    setReqUrl,
    reqHeaders,
    setReqHeaders,
    reqQueryParams,
    setReqQueryParams,
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
    fetchEnvironments,
    handleExecuteRequest,
    handleSaveRequest,
    handleCreateRequest,
    handleCreateCollection,
    handleImportCollection,
    handleAddCollaborator
  } = useAppContext();

  // Local component states
  const [importId, setImportId] = useState("");
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [copiedRequestId, setCopiedRequestId] = useState<string | null>(null);
  const [requestConfigTab, setRequestConfigTab] = useState<"headers" | "auth" | "chaining">("headers");

  // Custom Modal States (XSS & Prompt Prevention)
  const [showNewCollectionModal, setShowNewCollectionModal] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [showNewReqModal, setShowNewReqModal] = useState(false);
  const [newReqName, setNewReqName] = useState("");

  const activeCollection = collections.find(c => c.id === selectedCollectionId);
  const activeRequest = activeCollection?.requests.find(r => r.id === selectedRequestId);

  const onCreateCollectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColName) return;
    try {
      await handleCreateCollection(newColName);
      setNewColName("");
      setShowNewCollectionModal(false);
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
      alert("Collection imported successfully!");
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
      alert(`Shared successfully with ${shareEmail}`);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedRequestId(id);
    setTimeout(() => setCopiedRequestId(null), 2000);
  };

  const generateAiParserScript = async () => {
    if (!aiPrompt) return;
    setIsGeneratingAiParser(true);
    try {
      const payload = {
        prompt: aiPrompt,
        responseSample: apiResponse ? JSON.stringify(apiResponse.body, null, 2) : ""
      };
      const result = await apiCall("/api/ai/generate-parser", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      if (result.code) {
        setReqParserScript(result.code);
        setShowAiModal(false);
        setAiPrompt("");
      }
    } catch (e: any) {
      alert(`AI Code Generation Failed: ${e.message}`);
    } finally {
      setIsGeneratingAiParser(false);
    }
  };

  return (
    <div className="h-full flex overflow-hidden">
      
      {/* Collection Left Sidebar */}
      <div className="w-72 border-r border-slate-850 bg-slate-900/10 flex-shrink-0 flex flex-col justify-between">
        <div className="flex flex-col flex-grow overflow-hidden">
          <div className="p-4 border-b border-slate-850 flex items-center justify-between flex-shrink-0">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Collections</span>
            <div className="flex gap-2">
              <button
                onClick={() => setShowNewCollectionModal(true)}
                className="p-1 rounded bg-slate-800 border border-slate-700 hover:bg-slate-750 text-indigo-400"
                title="New Collection"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                onClick={() => setShowShareModal(true)}
                className="p-1 rounded bg-slate-800 border border-slate-700 hover:bg-slate-750 text-indigo-400"
                title="Share / Import Collections"
                disabled={!selectedCollectionId}
              >
                <Share2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Import / Share bar */}
          <form onSubmit={onImportSubmit} className="p-3 border-b border-slate-850 flex gap-2 flex-shrink-0">
            <input
              type="text"
              placeholder="Import by Collection ID..."
              value={importId}
              onChange={(e) => setImportId(e.target.value)}
              className="flex-grow bg-slate-950 border border-slate-850 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-indigo-500/50"
            />
            <button
              type="submit"
              className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition"
            >
              Import
            </button>
          </form>

          {/* Collections List */}
          <div className="flex-grow overflow-y-auto p-3 space-y-3">
            {collections.map(col => (
              <div key={col.id} className={`rounded-xl border transition-all ${col.id === selectedCollectionId ? "border-indigo-500/40 bg-indigo-500/5" : "border-slate-850 bg-slate-900/10"}`}>
                <div 
                  onClick={() => {
                    setSelectedCollectionId(col.id);
                    if (col.requests.length) {
                      setSelectedRequestId(col.requests[0].id);
                    } else {
                      setSelectedRequestId("");
                    }
                  }}
                  className="p-3 flex items-center justify-between cursor-pointer hover:bg-slate-800/20 rounded-t-xl"
                >
                  <div>
                    <h3 className="text-xs font-bold text-slate-200">{col.name}</h3>
                    <p className="text-[10px] text-slate-500 truncate w-48 mt-0.5">ID: {col.id}</p>
                  </div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyId(col.id);
                    }}
                    className="text-[10px] bg-slate-800 hover:bg-slate-700 px-1.5 py-0.5 rounded text-slate-400"
                  >
                    {copiedRequestId === col.id ? "Copied" : "Copy ID"}
                  </button>
                </div>

                {col.id === selectedCollectionId && (
                  <div className="p-2 border-t border-slate-850/60 bg-slate-900/20 space-y-1 rounded-b-xl">
                    {col.requests.map(req => (
                      <button
                        key={req.id}
                        onClick={() => setSelectedRequestId(req.id)}
                        className={`flex w-full items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${req.id === selectedRequestId ? "bg-indigo-500/15 text-indigo-400" : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"}`}
                      >
                        <span className="truncate w-40 text-left">{req.name}</span>
                        <span className={`text-[9px] uppercase font-bold px-1 rounded ${
                          req.method === "GET" ? "bg-emerald-500/10 text-emerald-400" :
                          req.method === "POST" ? "bg-blue-500/10 text-blue-400" :
                          req.method === "PUT" ? "bg-amber-500/10 text-amber-400" :
                          "bg-rose-500/10 text-rose-400"
                        }`}>{req.method}</span>
                      </button>
                    ))}
                    <button
                      onClick={() => setShowNewReqModal(true)}
                      className="flex w-full items-center justify-center gap-1.5 px-3 py-2 mt-1 border border-dashed border-slate-800 hover:border-slate-700 text-[10px] font-semibold text-slate-500 hover:text-slate-400 rounded-lg transition"
                    >
                      <Plus className="h-3 w-3" />
                      Add Request
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Request / Response Editor Panel */}
      <div className="flex-grow flex flex-col overflow-hidden bg-slate-950">
        {activeRequest ? (
          <div className="flex-grow flex flex-col overflow-hidden">
            {/* Request Controller Header */}
            <div className="p-4 border-b border-slate-850 bg-slate-900/10 flex items-center gap-3 flex-shrink-0">
              <select
                value={reqMethod}
                onChange={(e) => setReqMethod(e.target.value)}
                className="bg-slate-900 border border-slate-800 text-xs font-bold rounded-xl px-3 py-2 text-indigo-400 outline-none focus:ring-1 focus:ring-indigo-500/30"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>

              <input
                type="text"
                value={reqUrl}
                onChange={(e) => setReqUrl(e.target.value)}
                className="flex-grow bg-slate-950 border border-slate-850 rounded-xl px-4 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500/50"
                placeholder="Request URL (e.g. {{BASE_URL}}/api/users)"
              />

              <button
                onClick={handleExecuteRequest}
                disabled={isExecutingApi}
                className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-bold text-white transition disabled:opacity-50"
              >
                {isExecutingApi ? <RefreshCw className="h-4.5 w-4.5 animate-spin" /> : <Send className="h-4.5 w-4.5" />}
                Send
              </button>
              <button
                onClick={handleSaveRequest}
                className="rounded-xl border border-slate-800 bg-slate-900/60 hover:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 transition"
              >
                Save
              </button>
            </div>

            {/* Request Settings Tabs and Payload Body editor vertically stacked */}
            <div className="flex-grow flex flex-col overflow-hidden">
              
              {/* Tab Bar below URL */}
              <div className="px-4 py-2 border-b border-slate-850 bg-slate-900/10 flex items-center justify-between flex-shrink-0">
                <div className="flex gap-2">
                  <button
                    onClick={() => setRequestConfigTab("headers")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${requestConfigTab === "headers" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                  >
                    Headers
                  </button>
                  <button
                    onClick={() => setRequestConfigTab("auth")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${requestConfigTab === "auth" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                  >
                    Authentication
                  </button>
                  <button
                    onClick={() => setRequestConfigTab("chaining")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${requestConfigTab === "chaining" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                  >
                    Variables Chaining
                  </button>
                </div>

                {/* Additional controls for active tab */}
                {requestConfigTab === "headers" && (
                  <button
                    onClick={() => setReqHeaders([...reqHeaders, { key: "", value: "" }])}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold bg-slate-900 border border-slate-800 hover:bg-slate-800 text-indigo-400 rounded-lg transition"
                  >
                    <Plus className="h-3 w-3" /> Add Header
                  </button>
                )}
                {requestConfigTab === "chaining" && (
                  <button
                    onClick={() => setShowAiModal(true)}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 rounded-lg transition disabled:opacity-50"
                    disabled={!apiResponse}
                  >
                    AI Agent Parser
                  </button>
                )}
              </div>

              {/* Tab Content Window */}
              <div className="h-[250px] flex-shrink-0 border-b border-slate-850 flex flex-col overflow-hidden bg-slate-950">
                {requestConfigTab === "headers" && (
                  <div className="flex-grow overflow-y-auto p-4 space-y-2">
                    {reqHeaders.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-slate-500 text-xs">
                        No headers defined. Click "Add Header" above.
                      </div>
                    ) : (
                      reqHeaders.map((header, idx) => (
                        <div key={idx} className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Header Key"
                            value={header.key}
                            onChange={(e) => {
                              const newH = [...reqHeaders];
                              newH[idx].key = e.target.value;
                              setReqHeaders(newH);
                            }}
                            className="w-1/2 bg-slate-950 border border-slate-850 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
                          />
                          <input
                            type="text"
                            placeholder="Value"
                            value={header.value}
                            onChange={(e) => {
                              const newH = [...reqHeaders];
                              newH[idx].value = e.target.value;
                              setReqHeaders(newH);
                            }}
                            className="w-1/2 bg-slate-950 border border-slate-850 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
                          />
                          <button
                            onClick={() => setReqHeaders(reqHeaders.filter((_, i) => i !== idx))}
                            className="p-2 text-slate-600 hover:text-red-400"
                          >
                            <Trash className="h-4 w-4" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {requestConfigTab === "auth" && (
                  <div className="p-4 flex-grow flex flex-col bg-slate-950 justify-center">
                    <div className="flex items-center gap-3 border-b border-slate-850 pb-3 mb-4 flex-shrink-0">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Auth Type:</span>
                      <select
                        value={reqAuthType}
                        onChange={(e) => setReqAuthType(e.target.value)}
                        className="bg-slate-900 border border-slate-800 text-xs rounded-lg px-3 py-1.5 text-slate-300 outline-none"
                      >
                        <option value="NONE">No Auth</option>
                        <option value="BEARER">Bearer Token</option>
                        <option value="API_KEY">Header API Key</option>
                        <option value="AUTH_HOOK">Dynamic Auth Hook</option>
                      </select>
                    </div>
                    <div className="flex-grow flex items-center justify-center">
                      {reqAuthType === "NONE" && <p className="text-[11px] text-slate-500">No authentication configured.</p>}
                      {reqAuthType === "BEARER" && (
                        <div className="w-full">
                          <input
                            type="text"
                            placeholder="Token (or {{VARIABLE}})"
                            value={reqAuthConfig.token || ""}
                            onChange={(e) => setReqAuthConfig({ ...reqAuthConfig, token: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs focus:outline-none"
                          />
                        </div>
                      )}
                      {reqAuthType === "API_KEY" && (
                        <div className="w-full flex gap-3">
                          <input
                            type="text"
                            placeholder="Header Key"
                            value={reqAuthConfig.key || ""}
                            onChange={(e) => setReqAuthConfig({ ...reqAuthConfig, key: e.target.value })}
                            className="w-1/2 bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs focus:outline-none"
                          />
                          <input
                            type="text"
                            placeholder="Value"
                            value={reqAuthConfig.value || ""}
                            onChange={(e) => setReqAuthConfig({ ...reqAuthConfig, value: e.target.value })}
                            className="w-1/2 bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs focus:outline-none"
                          />
                        </div>
                      )}
                      {reqAuthType === "AUTH_HOOK" && (
                        <div className="w-full">
                          <select
                            value={reqAuthConfig.authFunctionId || ""}
                            onChange={(e) => setReqAuthConfig({ ...reqAuthConfig, authFunctionId: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-850 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none"
                          >
                            <option value="">Select Auth Hook script...</option>
                            {authFunctions.map(f => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {requestConfigTab === "chaining" && (
                  <div className="flex-grow relative bg-slate-950">
                    <Editor
                      height="100%"
                      language="javascript"
                      theme="vs-dark"
                      value={reqParserScript}
                      onChange={(val) => setReqParserScript(val || "")}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 11,
                        lineNumbers: "on",
                        scrollbar: { vertical: "auto", horizontal: "hidden" }
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Request Payload Editor */}
              <div className="flex-grow flex flex-col overflow-hidden bg-slate-950">
                <div className="px-4 py-2 border-b border-slate-850 bg-slate-900/5 flex items-center justify-between flex-shrink-0">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Payload Body</span>
                  <select
                    value={reqBodyType}
                    onChange={(e) => setReqBodyType(e.target.value)}
                    className="bg-slate-900 border border-slate-800 text-[11px] rounded-lg px-2 py-1 text-slate-300 outline-none"
                  >
                    <option value="NONE">None</option>
                    <option value="JSON">JSON</option>
                    <option value="TEXT">Text</option>
                  </select>
                </div>
                <div className="flex-grow relative bg-slate-950">
                  {reqBodyType === "NONE" ? (
                    <div className="flex h-full items-center justify-center text-slate-500 text-xs">
                      No request body. Change payload body type above to edit.
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
                        scrollbar: { vertical: "auto", horizontal: "hidden" }
                      }}
                    />
                  )}
                </div>
              </div>

            </div>

            {/* Execution Response Pane */}
            <div className="h-72 border-t border-slate-850 flex flex-col overflow-hidden flex-shrink-0 bg-slate-950">
              <div className="px-6 py-3 border-b border-slate-850 bg-slate-900/20 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-4">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Response Panel</span>
                  {apiResponse && (
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${apiResponse.status < 400 ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                        {apiResponse.status} {apiResponse.statusText}
                      </span>
                      <span className="text-xs text-slate-500 font-medium">Time: {apiResponse.executionTimeMs} ms</span>
                    </div>
                  )}
                </div>

                {apiResponse && (
                  <div className="flex border border-slate-850 rounded-lg overflow-hidden bg-slate-950">
                    {["pretty", "headers", "raw", "extracted"].map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setResponseTab(tab as any)}
                        className={`px-3 py-1 text-[10px] font-bold uppercase transition ${responseTab === tab ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex-grow overflow-auto p-4 bg-slate-950 text-xs">
                {!apiResponse ? (
                  <div className="flex h-full items-center justify-center text-slate-500">
                    Send a request to see response details here.
                  </div>
                ) : (
                  <>
                    {responseTab === "pretty" && (
                      <pre className="text-emerald-400 font-mono select-text whitespace-pre-wrap">
                        {typeof apiResponse.body === "object" ? JSON.stringify(apiResponse.body, null, 2) : apiResponse.body}
                      </pre>
                    )}
                    {responseTab === "headers" && (
                      <div className="space-y-1 font-mono">
                        {Object.entries(apiResponse.headers).map(([k, v]) => (
                          <div key={k} className="flex border-b border-slate-900 pb-1">
                            <span className="text-indigo-400 font-bold w-48">{k}:</span>
                            <span className="text-slate-300">{v as string}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {responseTab === "raw" && (
                      <pre className="text-slate-400 font-mono select-text whitespace-pre-wrap">
                        {JSON.stringify(apiResponse, null, 2)}
                      </pre>
                    )}
                    {responseTab === "extracted" && (
                      <div>
                        <h4 className="text-xs font-bold text-slate-400 mb-2">Variables Extracted and Saved:</h4>
                        {apiResponse.parsedVariables && Object.keys(apiResponse.parsedVariables).length ? (
                          <div className="space-y-1.5">
                            {Object.entries(apiResponse.parsedVariables).map(([k, v]) => (
                              <div key={k} className="flex items-center gap-2 bg-slate-900/50 p-2 rounded-lg border border-slate-900">
                                <span className="font-bold text-indigo-400">{k}</span>
                                <span className="text-slate-500 font-bold">=</span>
                                <span className="text-emerald-400 font-mono">{String(v)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-slate-500">No variables saved by this execution.</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-slate-500 text-sm">
            Select a request from the sidebar collections to begin testing.
          </div>
        )}
      </div>

      {/* NEW COLLECTION MODAL */}
      {showNewCollectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <form onSubmit={onCreateCollectionSubmit} className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-md space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Create New Collection</h3>
            <input 
              type="text" 
              placeholder="Collection name..."
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs outline-none focus:border-indigo-500"
              required
            />
            <div className="flex justify-end gap-3 pt-2">
              <button 
                type="button" 
                onClick={() => { setShowNewCollectionModal(false); setNewColName(""); }}
                className="px-3.5 py-1.5 rounded-lg border border-slate-800 text-xs font-semibold text-slate-400 hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* NEW REQUEST MODAL */}
      {showNewReqModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <form onSubmit={onCreateRequestSubmit} className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-md space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Create New Request</h3>
            <input 
              type="text" 
              placeholder="Request name (e.g. Get User Profile)..."
              value={newReqName}
              onChange={(e) => setNewReqName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs outline-none focus:border-indigo-500"
              required
            />
            <div className="flex justify-end gap-3 pt-2">
              <button 
                type="button" 
                onClick={() => { setShowNewReqModal(false); setNewReqName(""); }}
                className="px-3.5 py-1.5 rounded-lg border border-slate-800 text-xs font-semibold text-slate-400 hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* COLLABORATOR SHARE MODAL */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <form onSubmit={onShareSubmit} className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-md space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Share Collection</h3>
            <p className="text-[11px] text-slate-400">Share this collection with another developer by typing their email. They will see it in their workspaces.</p>
            <input 
              type="email" 
              placeholder="collaborator@lixionary.com"
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs outline-none focus:border-indigo-500"
              required
            />
            <div className="flex justify-end gap-3 pt-2">
              <button 
                type="button" 
                onClick={() => { setShowShareModal(false); setShareEmail(""); }}
                className="px-3.5 py-1.5 rounded-lg border border-slate-800 text-xs font-semibold text-slate-400 hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition"
              >
                Share
              </button>
            </div>
          </form>
        </div>
      )}

      {/* AI PARSER MODAL */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-xl space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">AI Prompt Parser Generator</h3>
            <p className="text-[11px] text-slate-400">Provide instructions to the Gemini AI Agent on how to extract tokens, variables, or keys from the sample API response. It will generate a sandboxed JS script for you.</p>
            
            <textarea
              rows={4}
              placeholder="e.g. Extract the token value from body.token and save it to the environment variable access_token"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs outline-none focus:border-indigo-500 text-slate-200"
            />
            
            <div className="flex justify-end gap-3 pt-2">
              <button 
                type="button" 
                onClick={() => { setShowAiModal(false); setAiPrompt(""); }}
                className="px-3.5 py-1.5 rounded-lg border border-slate-800 text-xs font-semibold text-slate-400 hover:bg-slate-800 transition"
                disabled={isGeneratingAiParser}
              >
                Cancel
              </button>
              <button 
                onClick={generateAiParserScript}
                disabled={isGeneratingAiParser || !aiPrompt}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition disabled:opacity-50"
              >
                {isGeneratingAiParser ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                Generate Script
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
