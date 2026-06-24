"use client";

import React, { useState, useEffect } from "react";
import { 
  Globe, RefreshCw, Terminal, Eye, EyeOff, 
  AlertCircle, Copy, Download, Trash, Plus, ChevronRight, FileCode, Play
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { useAppContext } from "../../context/AppContext";

export default function WebExplorerPage() {
  const {
    browserUrl,
    setBrowserUrl,
    isBrowserConnected,
    inspectMode,
    vncUrl,
    sessionId,
    networkLogs,
    networkFilter,
    setNetworkFilter,
    selectedLogId,
    logDetails,
    setLogDetails,
    activePomClass,
    setActivePomClass,
    pomClasses,
    setPomClasses,
    pomElements,
    setPomElements,
    selectedElement,
    setSelectedElement,
    selectedElementLocators,
    setSelectedElementLocators,
    selectedElementAction,
    setSelectedElementAction,
    selectedElementMethodName,
    setSelectedElementMethodName,
    activeGenCodeTab,
    setActiveGenCodeTab,
    generatedPomCode,
    setGeneratedPomCode,
    generatedClientCode,
    setGeneratedClientCode,
    selectedLogsForClient,
    setSelectedLogsForClient,
    clientBaseUrl,
    setClientBaseUrl,

    // Profiles state & ops
    profiles,
    selectedProfileId,
    setSelectedProfileId,
    apiCall,
    handleBrowserNavigate,
    handleToggleInspect,
    handleStartBrowser,
    handleDisconnectBrowser,
    handleLogClick,
    handleSaveProfile,
    handleDeleteProfile
  } = useAppContext();

  // Profile manager modal states
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileCookies, setProfileCookies] = useState("");
  const [profileLocalStorage, setProfileLocalStorage] = useState("");
  const [showNewClassModal, setShowNewClassModal] = useState(false);
  const [newClassName, setNewClassName] = useState("");

  // Auto-generate code when POM elements or selected logs change
  useEffect(() => {
    if (isBrowserConnected && sessionId) {
      generatePOM();
    }
  }, [pomElements, activePomClass, isBrowserConnected, sessionId]);

  useEffect(() => {
    if (isBrowserConnected && sessionId && selectedLogsForClient.length) {
      generateHttpClient();
    } else {
      setGeneratedClientCode("");
    }
  }, [selectedLogsForClient, clientBaseUrl, isBrowserConnected, sessionId]);

  const generatePOM = async () => {
    const classElements = pomElements[activePomClass] || [];
    try {
      const res = await apiCall("/api/browser/pom/generate", {
        method: "POST",
        body: JSON.stringify({
          className: activePomClass,
          url: browserUrl,
          elements: classElements
        })
      });
      setGeneratedPomCode(res.code);
    } catch (e) {
      console.error(e);
    }
  };

  const generateHttpClient = async () => {
    try {
      const res = await apiCall("/api/browser/client/generate", {
        method: "POST",
        body: JSON.stringify({
          baseUrl: clientBaseUrl,
          logIds: selectedLogsForClient,
          sessionId: sessionId
        })
      });
      setGeneratedClientCode(res.code);
    } catch (e) {
      console.error(e);
    }
  };

  // Add recorded element to POM list
  const handleAddElementToPOM = () => {
    if (!selectedElement) return;
    
    // Read the form values or fallback
    const strategy = selectedElementLocators[0]?.strategy || "locator (CSS)";
    const selector = selectedElementLocators[0]?.selector || selectedElement.cssSelector;

    const newEl = {
      element_id: `el_${Math.random().toString(36).substring(2, 9)}`,
      method_name: selectedElementMethodName || `click_${selectedElement.tagName}`,
      strategy,
      selector,
      action: selectedElementAction
    };

    setPomElements(prev => {
      const currentClassEls = prev[activePomClass] || [];
      // Prevent duplicate method names
      if (currentClassEls.some(el => el.method_name === newEl.method_name)) {
        alert("Method name already exists in this Page Class.");
        return prev;
      }
      return {
        ...prev,
        [activePomClass]: [...currentClassEls, newEl]
      };
    });

    // Reset element selector view
    setSelectedElement(null);
    setSelectedElementLocators([]);
    setSelectedElementMethodName("");
  };

  const handleCreateClass = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClassName) return;
    if (pomClasses.includes(newClassName)) {
      alert("Class name already exists.");
      return;
    }
    setPomClasses([...pomClasses, newClassName]);
    setPomElements(prev => ({ ...prev, [newClassName]: [] }));
    setActivePomClass(newClassName);
    setNewClassName("");
    setShowNewClassModal(false);
  };

  const handleSaveProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName) return;

    // Basic JSON format check
    if (profileCookies) {
      try {
        JSON.parse(profileCookies);
      } catch (err) {
        alert("Cookies must be a valid JSON array or empty.");
        return;
      }
    }
    if (profileLocalStorage) {
      try {
        JSON.parse(profileLocalStorage);
      } catch (err) {
        alert("LocalStorage must be a valid JSON object or empty.");
        return;
      }
    }

    try {
      await handleSaveProfile(profileName, profileCookies, profileLocalStorage, editingProfileId);
      // Reset form
      setProfileName("");
      setProfileCookies("");
      setProfileLocalStorage("");
      setEditingProfileId(null);
      alert("Browser Profile saved successfully!");
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleOpenEditProfile = (profile: any) => {
    setEditingProfileId(profile.id);
    setProfileName(profile.name);
    setProfileCookies(profile.cookies || "");
    setProfileLocalStorage(profile.localStorage || "");
  };

  const handleClearProfileForm = () => {
    setEditingProfileId(null);
    setProfileName("");
    setProfileCookies("");
    setProfileLocalStorage("");
  };

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredLogs = networkLogs.filter(log => 
    log.url.toLowerCase().includes(networkFilter.toLowerCase()) ||
    log.method.toLowerCase().includes(networkFilter.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      
      {/* Web explorer control bar */}
      <div className="p-3 border-b border-slate-850 bg-slate-900/20 flex items-center justify-between flex-shrink-0 gap-4">
        <div className="flex items-center gap-2 flex-grow">
          <Globe className="h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={browserUrl}
            onChange={(e) => setBrowserUrl(e.target.value)}
            placeholder="https://example.com"
            className="flex-grow bg-slate-950 border border-slate-850 rounded px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500/50"
            disabled={!isBrowserConnected}
          />
          {isBrowserConnected ? (
            <>
              <button
                onClick={handleBrowserNavigate}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-bold transition flex items-center gap-1 text-white"
              >
                Go
              </button>
              <button
                onClick={handleToggleInspect}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${inspectMode ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/40" : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200"}`}
              >
                {inspectMode ? "Inspecting" : "Inspect Element"}
              </button>
              <button
                onClick={handleDisconnectBrowser}
                className="px-3.5 py-1.5 bg-rose-950/80 hover:bg-rose-900 border border-rose-900/50 rounded-lg text-xs font-semibold text-rose-200 transition"
              >
                Disconnect
              </button>
            </>
          ) : (
            <div className="flex items-center gap-3">
              {/* Profile Selector */}
              <select
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
                className="bg-slate-950 border border-slate-850 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 outline-none"
              >
                <option value="">No Profile (Clean Session)</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              
              <button
                onClick={() => setShowProfileModal(true)}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-semibold text-slate-400 transition"
              >
                Manage Profiles
              </button>

              <button
                onClick={() => handleStartBrowser(selectedProfileId)}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-bold text-white transition flex items-center gap-1.5"
              >
                <Play className="h-3.5 w-3.5" />
                Connect VNC Browser
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Workspace split panel */}
      {isBrowserConnected ? (
        <div className="flex-grow flex overflow-hidden">
          {/* Left Panel: Embedded VNC Browser Frame */}
          <div className="w-2/3 h-full bg-black flex flex-col relative">
            {vncUrl ? (
              <iframe
                src={vncUrl}
                className="w-full h-full border-none"
                title="VNC Browser Frame"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-slate-600 text-xs">
                VNC Session initialized. Loading Canvas...
              </div>
            )}
          </div>

          {/* Right Panel: POM recorder, network logs and inspector */}
          <div className="w-1/3 h-full border-l border-slate-850 flex flex-col overflow-hidden bg-slate-950">
            {/* Split subtabs: POM Recorder, Network logs, Code Output */}
            <div className="flex-grow flex flex-col overflow-hidden">
              
              {/* Element Inspector Hook (If inspect clicks an element) */}
              {selectedElement && (
                <div className="m-3 p-3 bg-indigo-500/5 border border-indigo-500/20 rounded-xl space-y-3 flex-shrink-0">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Inspect Selected Node</h4>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">&lt;{selectedElement.tagName}&gt; - "{selectedElement.text}"</p>
                    </div>
                    <button 
                      onClick={() => { setSelectedElement(null); setSelectedElementLocators([]); }}
                      className="text-[10px] text-slate-500 hover:text-slate-300"
                    >
                      Clear
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div>
                      <label className="text-[9px] uppercase font-bold text-slate-500">Method Code Name</label>
                      <input 
                        type="text"
                        value={selectedElementMethodName}
                        onChange={(e) => setSelectedElementMethodName(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
                        placeholder="e.g. click_submit_btn"
                      />
                    </div>

                    <div className="flex gap-2">
                      <div className="w-1/2">
                        <label className="text-[9px] uppercase font-bold text-slate-500">Action Type</label>
                        <select
                          value={selectedElementAction}
                          onChange={(e) => setSelectedElementAction(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1 text-xs outline-none"
                        >
                          <option value="click">Click</option>
                          <option value="fill">Fill / Type</option>
                          <option value="hover">Hover</option>
                          <option value="select_option">Select Option</option>
                        </select>
                      </div>
                      <div className="w-1/2">
                        <label className="text-[9px] uppercase font-bold text-slate-500">Best Strategy Locator</label>
                        <select
                          onChange={(e) => {
                            const selectedIdx = parseInt(e.target.value);
                            const loc = selectedElementLocators[selectedIdx];
                            if (loc) {
                              setSelectedElementLocators([
                                loc,
                                ...selectedElementLocators.filter((_, i) => i !== selectedIdx)
                              ]);
                            }
                          }}
                          className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1 text-xs outline-none"
                        >
                          {selectedElementLocators.map((loc, idx) => (
                            <option key={idx} value={idx}>{loc.strategy} (Score: {loc.score})</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <button
                      onClick={handleAddElementToPOM}
                      className="w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white transition"
                    >
                      Record Node to Page Object Class
                    </button>
                  </div>
                </div>
              )}

              {/* Accordion Panels */}
              <div className="flex-grow overflow-y-auto p-4 space-y-4">
                
                {/* Accordion Item: Page Objects Manager */}
                <div className="rounded-xl border border-slate-850 bg-slate-900/10 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Page Objects (POM)</span>
                    <button
                      onClick={() => setShowNewClassModal(true)}
                      className="p-1 rounded bg-slate-800 border border-slate-700 hover:bg-slate-750 text-indigo-400"
                      title="Create Page Class"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <select
                      value={activePomClass}
                      onChange={(e) => setActivePomClass(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-850 rounded-lg px-2.5 py-1.5 text-xs outline-none"
                    >
                      {pomClasses.map(cls => (
                        <option key={cls} value={cls}>{cls}</option>
                      ))}
                    </select>
                  </div>

                  {/* Recorded POM elements */}
                  <div className="space-y-1.5">
                    {(pomElements[activePomClass] || []).length ? (
                      (pomElements[activePomClass] || []).map(el => (
                        <div key={el.element_id} className="flex items-center justify-between bg-slate-950 p-2 rounded-lg border border-slate-900">
                          <div>
                            <span className="font-semibold text-slate-200 text-xs">{el.method_name}()</span>
                            <p className="text-[9px] text-slate-500 font-mono mt-0.5 truncate w-64">{el.strategy}: {el.selector}</p>
                          </div>
                          <button
                            onClick={() => {
                              setPomElements(prev => ({
                                ...prev,
                                [activePomClass]: prev[activePomClass].filter(item => item.element_id !== el.element_id)
                              }));
                            }}
                            className="text-slate-600 hover:text-red-400"
                          >
                            <Trash className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-[10px] text-slate-500 text-center py-2">No elements recorded yet. Toggle inspect and click elements in the canvas.</p>
                    )}
                  </div>
                </div>

                {/* Accordion Item: Code Output View */}
                <div className="rounded-xl border border-slate-850 bg-slate-900/10 p-3 space-y-3 flex flex-col h-96">
                  <div className="flex items-center justify-between">
                    <div className="flex border border-slate-850 rounded-lg overflow-hidden bg-slate-950">
                      <button
                        onClick={() => setActiveGenCodeTab("pom")}
                        className={`px-3 py-1 text-[9px] font-bold uppercase transition ${activeGenCodeTab === "pom" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                      >
                        POM Class
                      </button>
                      <button
                        onClick={() => setActiveGenCodeTab("client")}
                        className={`px-3 py-1 text-[9px] font-bold uppercase transition ${activeGenCodeTab === "client" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                      >
                        HTTP Client
                      </button>
                    </div>
                    
                    <button
                      onClick={() => {
                        const code = activeGenCodeTab === "pom" ? generatedPomCode : generatedClientCode;
                        const filename = activeGenCodeTab === "pom" ? `${activePomClass}.py` : "http_client.py";
                        if (code) downloadFile(code, filename);
                      }}
                      disabled={activeGenCodeTab === "pom" ? !generatedPomCode : !generatedClientCode}
                      className="p-1 rounded bg-slate-800 border border-slate-700 hover:bg-slate-750 text-indigo-400 disabled:opacity-50"
                      title="Download synthesized file"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex-grow relative bg-slate-950 rounded-lg overflow-hidden border border-slate-900">
                    <Editor
                      height="100%"
                      language="python"
                      theme="vs-dark"
                      value={activeGenCodeTab === "pom" ? generatedPomCode : generatedClientCode}
                      options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        fontSize: 10,
                        scrollbar: { vertical: "auto", horizontal: "auto" }
                      }}
                    />
                  </div>
                </div>

                {/* Accordion Item: Browser Network Logger */}
                <div className="rounded-xl border border-slate-850 bg-slate-900/10 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Intercepted Network Logs</span>
                    <span className="text-[10px] bg-indigo-500/10 text-indigo-400 font-bold px-1.5 py-0.5 rounded">Recording</span>
                  </div>

                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Filter URL/Method..."
                        value={networkFilter}
                        onChange={(e) => setNetworkFilter(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-850 rounded px-2 py-1 text-xs focus:outline-none"
                      />
                    </div>

                    <div className="h-72 overflow-y-auto space-y-1 bg-slate-950 p-2 rounded-lg border border-slate-900">
                      {filteredLogs.map(log => (
                        <div key={log.id} className="flex flex-col gap-1 p-2 border-b border-slate-900 last:border-0 hover:bg-slate-900/40 rounded transition">
                          <div className="flex items-center justify-between">
                            <span className={`text-[9px] uppercase font-extrabold px-1 rounded ${
                              log.method === "GET" ? "bg-emerald-500/10 text-emerald-400" : "bg-blue-500/10 text-blue-400"
                            }`}>{log.method}</span>
                            <span className={`text-[9px] font-bold ${
                              log.status === null ? "text-amber-400" :
                              log.status < 400 ? "text-emerald-400" : "text-rose-400"
                            }`}>
                              {log.status === null ? "Pending" : `${log.status} ${log.statusText}`}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-300 truncate font-mono select-all">{log.url}</p>
                          <div className="flex items-center justify-between mt-1 pt-1 border-t border-slate-900/60">
                            <button
                              onClick={() => handleLogClick(log.id)}
                              className="text-[9px] text-indigo-400 hover:text-indigo-300 font-bold"
                            >
                              Inspect Details
                            </button>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedLogsForClient.includes(log.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedLogsForClient([...selectedLogsForClient, log.id]);
                                  } else {
                                    setSelectedLogsForClient(selectedLogsForClient.filter(id => id !== log.id));
                                  }
                                }}
                                className="rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-0 focus:ring-offset-0 h-3 w-3"
                              />
                              <span className="text-[9px] text-slate-500 font-semibold uppercase">Client</span>
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

              </div>

            </div>
          </div>
        </div>
      ) : (
        <div className="flex-grow flex flex-col items-center justify-center text-slate-500 bg-slate-950 px-4">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="h-16 w-16 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto border border-slate-800">
              <Globe className="h-8 w-8 text-slate-500" />
            </div>
            <div>
              <h3 className="text-slate-200 font-bold text-sm">Browser Session Inactive</h3>
              <p className="text-xs text-slate-500 mt-1">Start a remote debug session to inspect pages, capture network requests, and auto-generate Playwright python POM files.</p>
            </div>
          </div>
        </div>
      )}

      {/* DETAILED LOG INSPECT DRAWER */}
      {logDetails && (
        <div className="fixed inset-y-0 right-0 z-50 w-[500px] border-l border-slate-800 bg-slate-900/95 shadow-2xl backdrop-blur-md flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Network Details</span>
            <button
              onClick={() => setLogDetails(null)}
              className="text-slate-500 hover:text-slate-300 text-xs font-bold"
            >
              Close
            </button>
          </div>
          <div className="flex-grow overflow-y-auto p-5 space-y-5 text-xs font-mono select-text">
            <div>
              <h4 className="text-[10px] font-extrabold uppercase text-slate-500 mb-1.5">Request URL</h4>
              <p className="bg-slate-950 p-2.5 rounded-lg border border-slate-950 text-slate-300 break-all">{logDetails.request.url}</p>
            </div>
            
            <div className="flex gap-4">
              <div className="w-1/2">
                <h4 className="text-[10px] font-extrabold uppercase text-slate-500 mb-1.5">Method</h4>
                <p className="bg-slate-950 p-2 rounded-lg border border-slate-950 text-indigo-400 font-bold">{logDetails.request.method}</p>
              </div>
              <div className="w-1/2">
                <h4 className="text-[10px] font-extrabold uppercase text-slate-500 mb-1.5">Type</h4>
                <p className="bg-slate-950 p-2 rounded-lg border border-slate-950 text-slate-300 font-medium">{logDetails.request.resourceType}</p>
              </div>
            </div>

            <div>
              <h4 className="text-[10px] font-extrabold uppercase text-slate-500 mb-1.5">Request Headers</h4>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-950 text-slate-400 space-y-1">
                {Object.entries(logDetails.request.headers).map(([k, v]) => (
                  <div key={k} className="flex">
                    <span className="text-slate-500 font-bold w-36 truncate">{k}:</span>
                    <span className="text-slate-300 break-all flex-grow">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {logDetails.response ? (
              <>
                <div className="flex gap-4">
                  <div className="w-1/2">
                    <h4 className="text-[10px] font-extrabold uppercase text-slate-500 mb-1.5">Response Status</h4>
                    <p className={`bg-slate-950 p-2 rounded-lg border border-slate-950 font-bold ${logDetails.response.status < 400 ? "text-emerald-400" : "text-rose-400"}`}>
                      {logDetails.response.status} {logDetails.response.statusText}
                    </p>
                  </div>
                </div>

                <div>
                  <h4 className="text-[10px] font-extrabold uppercase text-slate-500 mb-1.5">Response Body</h4>
                  <pre className="bg-slate-950 p-3 rounded-lg border border-slate-950 text-emerald-400 whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {logDetails.response.body}
                  </pre>
                </div>
              </>
            ) : (
              <p className="text-slate-500 text-center italic py-4">Response pending or omitted.</p>
            )}
          </div>
        </div>
      )}

      {/* NEW CLASS MODAL */}
      {showNewClassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <form onSubmit={handleCreateClass} className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-md space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Create New Page Class</h3>
            <input 
              type="text" 
              placeholder="Class name (e.g. LoginPage, DashboardPage)..."
              value={newClassName}
              onChange={(e) => setNewClassName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
              required
            />
            <div className="flex justify-end gap-3 pt-2">
              <button 
                type="button" 
                onClick={() => { setShowNewClassModal(false); setNewClassName(""); }}
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

      {/* BROWSER PROFILES MANAGER MODAL */}
      {showProfileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-4xl space-y-5 shadow-2xl flex flex-col h-[600px] overflow-hidden">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3 flex-shrink-0">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Browser Profiles Manager</h3>
              <button 
                onClick={() => { setShowProfileModal(false); handleClearProfileForm(); }}
                className="text-slate-500 hover:text-slate-300 text-xs font-bold"
              >
                Close
              </button>
            </div>

            <div className="flex flex-grow overflow-hidden gap-6">
              {/* Left Column: Profiles List */}
              <div className="w-1/3 border-r border-slate-800 flex flex-col overflow-hidden pr-4 flex-shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">Profiles List</span>
                </div>
                
                <div className="flex-grow overflow-y-auto space-y-2 pr-1">
                  {profiles.length ? (
                    profiles.map(p => (
                      <div 
                        key={p.id}
                        className={`p-3 rounded-xl border flex flex-col gap-2 transition ${
                          editingProfileId === p.id 
                            ? "bg-indigo-500/10 border-indigo-500/40 text-indigo-400" 
                            : "bg-slate-950 border-slate-850 hover:bg-slate-900 text-slate-200"
                        }`}
                      >
                        <div 
                          className="cursor-pointer"
                          onClick={() => handleOpenEditProfile(p)}
                        >
                          <p className="text-xs font-bold">{p.name}</p>
                          <p className="text-[9px] text-slate-500 mt-1 font-mono">ID: {p.id}</p>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-slate-900 pt-2">
                          <button
                            onClick={() => handleOpenEditProfile(p)}
                            className="text-[9px] font-bold text-indigo-400 hover:text-indigo-300"
                          >
                            Edit
                          </button>
                          <button
                            onClick={async () => {
                              if (confirm("Are you sure you want to delete this profile?")) {
                                await handleDeleteProfile(p.id);
                                if (editingProfileId === p.id) handleClearProfileForm();
                              }
                            }}
                            className="text-[9px] font-bold text-rose-400 hover:text-rose-300"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-6 text-slate-500 text-xs">
                      No profiles configured.
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Profile Editor Form */}
              <form onSubmit={handleSaveProfileSubmit} className="w-2/3 flex flex-col overflow-hidden space-y-4">
                <div className="flex items-center justify-between flex-shrink-0">
                  <span className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">
                    {editingProfileId ? "Edit Profile Settings" : "Configure New Profile"}
                  </span>
                  {editingProfileId && (
                    <button 
                      type="button" 
                      onClick={handleClearProfileForm}
                      className="text-[10px] bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded text-slate-400 font-bold"
                    >
                      New Profile Form
                    </button>
                  )}
                </div>

                <div className="flex-grow overflow-y-auto space-y-4 pr-1">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400">Profile Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Authenticated Admin Session"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="w-full mt-1.5 bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400">
                      Inject Cookies (JSON List Format)
                    </label>
                    <textarea
                      rows={4}
                      value={profileCookies}
                      onChange={(e) => setProfileCookies(e.target.value)}
                      className="w-full mt-1.5 bg-slate-950 border border-slate-850 rounded-xl p-3 text-xs outline-none focus:border-indigo-500 text-emerald-400 font-mono"
                      placeholder='[{"name": "session", "value": "xyz", "domain": "example.com", "path": "/"}]'
                    />
                    <p className="text-[9px] text-slate-500 mt-1 font-semibold">Tip: Paste a Playwright-compatible JSON array containing cookies.</p>
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400">
                      Inject LocalStorage (JSON Object Format)
                    </label>
                    <textarea
                      rows={3}
                      value={profileLocalStorage}
                      onChange={(e) => setProfileLocalStorage(e.target.value)}
                      className="w-full mt-1.5 bg-slate-950 border border-slate-850 rounded-xl p-3 text-xs outline-none focus:border-indigo-500 text-emerald-400 font-mono"
                      placeholder='{"auth_token": "bearer-token-abc", "theme": "dark"}'
                    />
                    <p className="text-[9px] text-slate-500 mt-1 font-semibold">Tip: Paste a key-value object containing storage keys.</p>
                  </div>
                </div>

                <div className="flex justify-end gap-3 flex-shrink-0 border-t border-slate-800 pt-3">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white rounded-lg transition"
                  >
                    {editingProfileId ? "Update Profile" : "Save Profile"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
