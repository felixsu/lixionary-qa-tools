"use client";

import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Send, Plus, Trash2, Share2, ChevronDown, ChevronRight,
  Sparkles, Code2, Copy, Check, X, AlignLeft, Minimize2,
  PanelLeftClose, PanelLeftOpen, Folder, Play, Pencil, AlertCircle, Wand2,
  Upload, Search
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { useAppContext, findRequestInTree, findRequestOwnerCollection, findAncestorPathToRequest } from "../../context/AppContext";
import type { InputBinding } from "../../context/AppContext";
import { useToast } from "../../context/ToastContext";
import { useSearchIndexStatus } from "../../context/SearchIndexStatusContext";
import SearchResultsList from "./SearchResultsList";
import Dropdown from "../../components/Dropdown";
import { Modal, ModalFooter } from "../../components/Modal";
import MarkdownContent from "../../components/guide/MarkdownContent";
import { confirmDialog } from "../../utils/confirmDialog";
import { scanInputNames } from "../../utils/requestTokens";
import { methodStyle } from "../../utils/methodStyle";
import {
  serializeCollectionForExport,
  collectionExportFilename,
  downloadJson,
  parseCollectionImport,
  prepareImportedCollection,
} from "../../utils/collectionTransfer";

type ConfigTab = "headers" | "params" | "auth" | "inputs" | "output" | "interceptor" | "description" | "body";

interface ParsedCurl {
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  body: string;
  bodyType: string;
  authType?: string;
  authConfig?: { token?: string; key?: string; value?: string };
}

// Tokenize a shell-ish command respecting single/double quotes and line continuations.
const tokenizeShell = (input: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === "\\" && (input[i + 1] === "\n" || input[i + 1] === "\r")) {
      // line continuation
      continue;
    }
    if (/\s/.test(ch)) {
      if (has || current) {
        tokens.push(current);
        current = "";
        has = false;
      }
      continue;
    }
    current += ch;
    has = true;
  }
  if (has || current) tokens.push(current);
  return tokens;
};

const parseCurl = (text: string): ParsedCurl | null => {
  const trimmed = text.trim();
  if (!/^curl\s/i.test(trimmed)) return null;

  const tokens = tokenizeShell(trimmed);
  let method = "";
  let url = "";
  const headers: { key: string; value: string }[] = [];
  let body = "";
  let authConfig: ParsedCurl["authConfig"] | undefined;
  let authType: string | undefined;

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "-X" || t === "--request") {
      method = (tokens[++i] || "").toUpperCase();
    } else if (t === "-H" || t === "--header") {
      const h = tokens[++i] || "";
      const idx = h.indexOf(":");
      if (idx > -1) {
        headers.push({ key: h.slice(0, idx).trim(), value: h.slice(idx + 1).trim() });
      }
    } else if (t === "-d" || t === "--data" || t === "--data-raw" || t === "--data-binary" || t === "--data-ascii") {
      body = tokens[++i] || "";
    } else if (t === "-u" || t === "--user") {
      const creds = tokens[++i] || "";
      authType = "BASIC";
      authConfig = { token: btoa(creds) };
    } else if (t === "--url") {
      url = tokens[++i] || "";
    } else if (t.startsWith("-")) {
      // skip unknown flags; consume an arg if it looks like one (best-effort no-op)
    } else if (!url) {
      url = t;
    }
  }

  if (!url) return null;
  if (!method) method = body ? "POST" : "GET";

  const ctHeader = headers.find((h) => h.key.toLowerCase() === "content-type");
  let bodyType = "NONE";
  if (body) {
    const isJson =
      (ctHeader && ctHeader.value.toLowerCase().includes("json")) ||
      (() => {
        try { JSON.parse(body); return true; } catch { return false; }
      })();
    bodyType = isJson ? "JSON" : "TEXT";
  }

  // Basic auth from curl maps to an API-key style Authorization header in this app.
  if (authType === "BASIC" && authConfig?.token) {
    headers.push({ key: "Authorization", value: `Basic ${authConfig.token}` });
    authType = undefined;
    authConfig = undefined;
  }

  return { method, url, headers, body, bodyType, authType, authConfig };
};

const countRequestsInTree = (node: any): number => {
  let count = node.requests?.length || 0;
  if (node.children) {
    for (const child of node.children) {
      count += countRequestsInTree(child);
    }
  }
  return count;
};

interface CollectionNodeProps {
  node: any;
  depth: number;
  selectedCollectionId: string;
  selectedRequestId: string;
  setSelectedCollectionId: (id: string) => void;
  setSelectedRequestId: (id: string) => void;
  setTargetAddColId: (id: string | null) => void;
  setShowNewReqModal: (show: boolean) => void;
  setShowNewSubColModal: (show: boolean) => void;
  handleMoveNode: (nodeId: string, nodeType: "request" | "collection", targetColId: string) => Promise<void>;
  handleDeleteNode: (nodeId: string, nodeType: "request" | "collection") => Promise<void>;
  handleRenameNode: (nodeId: string, nodeType: "request" | "collection", newName: string) => Promise<void>;
  handleDuplicateRequest: (req: any) => Promise<void>;
  handleCopyId: (id: string) => void;
  handleExportCollection: (node: any) => void;
  copiedId: string | null;
  methodStyle: (method: string) => React.CSSProperties;
  expandedFolders: Record<string, boolean>;
  toggleFolder: (id: string) => void;
  editingNodeId: string | null;
  setEditingNodeId: (id: string | null) => void;
  editingName: string;
  setEditingName: (name: string) => void;
}

const CollectionNode: React.FC<CollectionNodeProps> = ({
  node,
  depth,
  selectedCollectionId,
  selectedRequestId,
  setSelectedCollectionId,
  setSelectedRequestId,
  setTargetAddColId,
  setShowNewReqModal,
  setShowNewSubColModal,
  handleMoveNode,
  handleDeleteNode,
  handleRenameNode,
  handleDuplicateRequest,
  handleCopyId,
  handleExportCollection,
  copiedId,
  methodStyle,
  expandedFolders,
  toggleFolder,
  editingNodeId,
  setEditingNodeId,
  editingName,
  setEditingName,
}) => {
  const { showToast } = useToast();
  const [isDragOver, setIsDragOver] = useState(false);
  const isFolderExpanded = expandedFolders[node.id] ?? (depth === 1);

  const handleDragStart = (e: React.DragEvent, id: string, type: "request" | "collection") => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.setData("item-type", type);
    e.stopPropagation();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const nodeId = e.dataTransfer.getData("text/plain");
    const nodeType = e.dataTransfer.getData("item-type") as "request" | "collection";
    
    if (!nodeId || !nodeType) return;
    try {
      await handleMoveNode(nodeId, nodeType, node.id);
    } catch (err: any) {
      showToast(err.message, { type: "error" });
    }
  };

  return (
    <div className="mb-1 select-none">
      {/* Folder Header */}
      <div
        draggable={depth > 1}
        onDragStart={(e) => handleDragStart(e, node.id, "collection")}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          toggleFolder(node.id);
          if (depth === 1) {
            setSelectedCollectionId(node.id);
            if (node.requests && node.requests.length > 0) {
              setSelectedRequestId(node.requests[0].id);
            }
          }
        }}
        className="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer hover:bg-hover transition-colors"
        style={{
          background: isDragOver
            ? "rgba(204, 120, 92, 0.15)"
            : selectedCollectionId === node.id && depth === 1
            ? "var(--color-hover)"
            : "transparent",
          border: isDragOver ? "1px dashed var(--color-clay)" : "1px solid transparent",
          paddingLeft: `${depth * 8}px`,
        }}
      >
        {isFolderExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-stone flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-stone flex-shrink-0" />
        )}
        <Folder className="h-4 w-4 text-stone/80 flex-shrink-0" />
        {editingNodeId === node.id ? (
          <input
            type="text"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                if (editingName.trim()) {
                  try {
                    await handleRenameNode(node.id, "collection", editingName.trim());
                  } catch (err: any) {
                    showToast(err.message, { type: "error" });
                  }
                }
                setEditingNodeId(null);
              } else if (e.key === "Escape") {
                setEditingNodeId(null);
              }
            }}
            onBlur={async () => {
              if (editingName.trim() && editingName.trim() !== node.name) {
                try {
                  await handleRenameNode(node.id, "collection", editingName.trim());
                } catch (err: any) {
                  showToast(err.message, { type: "error" });
                }
              }
              setEditingNodeId(null);
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            className="flex-1 h-[24px] bg-cream border border-clay rounded px-2 text-xs text-graphite outline-none focus:border-clay"
          />
        ) : (
          <span className="flex-1 text-[13px] font-medium text-ink truncate">{node.name}</span>
        )}
        
        {editingNodeId !== node.id && (
          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {depth === 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!node.cloudId) {
                    showToast("This collection hasn't finished syncing yet — try again in a moment.", { type: "error" });
                    return;
                  }
                  handleCopyId(node.cloudId);
                }}
                title="Copy collection ID"
                className="text-stone hover:text-clay transition"
              >
                {copiedId === node.cloudId ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            )}
            {depth === 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleExportCollection(node);
                }}
                title="Export collection as JSON"
                className="text-stone hover:text-clay transition"
              >
                <Share2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingNodeId(node.id);
                setEditingName(node.name);
              }}
              title="Rename collection"
              className="text-stone hover:text-clay transition"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                const count = countRequestsInTree(node);
                if (count > 0) {
                  const yes = await confirmDialog(`This collection contains ${count} request(s). Are you sure you want to delete it and all its contents?`);
                  if (!yes) return;
                } else {
                  const yes = await confirmDialog(`Are you sure you want to delete the collection "${node.name}"?`);
                  if (!yes) return;
                }
                try {
                  await handleDeleteNode(node.id, "collection");
                } catch (err: any) {
                  showToast(err.message, { type: "error" });
                }
              }}
              title="Delete collection"
              className="text-stone hover:text-danger transition"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Expanded Folder Contents */}
      {isFolderExpanded && (
        <div className="flex flex-col gap-px mt-0.5">
          {/* Render children collections recursively */}
          {node.children && node.children.map((child: any) => (
            <CollectionNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedCollectionId={selectedCollectionId}
              selectedRequestId={selectedRequestId}
              setSelectedCollectionId={setSelectedCollectionId}
              setSelectedRequestId={setSelectedRequestId}
              setTargetAddColId={setTargetAddColId}
              setShowNewReqModal={setShowNewReqModal}
              setShowNewSubColModal={setShowNewSubColModal}
              handleMoveNode={handleMoveNode}
              handleDeleteNode={handleDeleteNode}
              handleRenameNode={handleRenameNode}
              handleDuplicateRequest={handleDuplicateRequest}
              handleCopyId={handleCopyId}
              handleExportCollection={handleExportCollection}
              copiedId={copiedId}
              methodStyle={methodStyle}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              editingNodeId={editingNodeId}
              setEditingNodeId={setEditingNodeId}
              editingName={editingName}
              setEditingName={setEditingName}
            />
          ))}

          {/* Render request items */}
          {node.requests && node.requests.map((req: any) => {
            const active = req.id === selectedRequestId;
            return (
              <div
                key={req.id}
                draggable
                onDragStart={(e) => handleDragStart(e, req.id, "request")}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedRequestId(req.id);
                }}
                className="group/req flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer hover:bg-cream transition-colors"
                style={{
                  marginLeft: `${(depth + 1) * 8}px`,
                  background: active ? "var(--color-cream)" : "transparent",
                  borderLeft: `3px solid ${active ? "var(--color-clay)" : "transparent"}`,
                }}
              >
                <span
                  className="font-mono text-[9px] font-medium px-1.5 py-0.5 rounded flex-shrink-0"
                  style={methodStyle(req.method)}
                >
                  {req.method}
                </span>
                {editingNodeId === req.id ? (
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        if (editingName.trim()) {
                          try {
                            await handleRenameNode(req.id, "request", editingName.trim());
                          } catch (err: any) {
                            showToast(err.message, { type: "error" });
                          }
                        }
                        setEditingNodeId(null);
                      } else if (e.key === "Escape") {
                        setEditingNodeId(null);
                      }
                    }}
                    onBlur={async () => {
                      if (editingName.trim() && editingName.trim() !== req.name) {
                        try {
                          await handleRenameNode(req.id, "request", editingName.trim());
                        } catch (err: any) {
                          showToast(err.message, { type: "error" });
                        }
                      }
                      setEditingNodeId(null);
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 h-[24px] bg-cream border border-clay rounded px-2 text-xs text-graphite outline-none focus:border-clay"
                  />
                ) : (
                  <>
                    <span className="text-xs text-graphite truncate flex-1">{req.name}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover/req:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingNodeId(req.id);
                          setEditingName(req.name);
                        }}
                        title="Rename request"
                        className="text-stone hover:text-clay transition flex-shrink-0"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await handleDuplicateRequest(req);
                          } catch (err: any) {
                            showToast(err.message, { type: "error" });
                          }
                        }}
                        title="Duplicate request"
                        className="text-stone hover:text-clay transition flex-shrink-0"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const yes = await confirmDialog(`Are you sure you want to delete the request "${req.name}"?`);
                          if (!yes) return;
                          try {
                            await handleDeleteNode(req.id, "request");
                          } catch (err: any) {
                            showToast(err.message, { type: "error" });
                          }
                        }}
                        title="Delete request"
                        className="text-stone hover:text-danger transition flex-shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {/* Add actions buttons */}
          <div
            className="flex gap-1.5 mt-1 mb-1.5"
            style={{ marginLeft: `${(depth + 1) * 8}px` }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setTargetAddColId(node.id);
                setShowNewReqModal(true);
              }}
              className="flex-1 flex items-center justify-center gap-1 py-1 px-1.5 border border-dashed border-line rounded-md text-[10px] text-mute hover:border-clay hover:text-clay transition-colors"
            >
              <Plus className="h-3 w-3" /> Request
            </button>
            {depth < 5 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setTargetAddColId(node.id);
                  setShowNewSubColModal(true);
                }}
                className="flex-1 flex items-center justify-center gap-1 py-1 px-1.5 border border-dashed border-line rounded-md text-[10px] text-mute hover:border-clay hover:text-clay transition-colors"
              >
                <Plus className="h-3 w-3" /> Collection
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
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
    reqInterceptorScript,
    setReqInterceptorScript,
    reqInputs,
    setReqInputs,
    reqOutputs,
    setReqOutputs,
    reqOutputDescriptions,
    setReqOutputDescriptions,
    reqDescription,
    setReqDescription,
    selectedEnvId,

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
    handleCreateSubCollection,
    handleMoveNode,
    handleDeleteNode,
    handleRenameNode,
    handleDuplicateRequest,
    handleCreateCollection,
    handleImportCollection,
    importCollectionTree,
    handleAddCollaborator,
  } = useAppContext();

  const [importId, setImportId] = useState("");
  const importFileRef = useRef<HTMLInputElement>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [configTab, setConfigTab] = useState<ConfigTab>("headers");

  const [showNewCollectionModal, setShowNewCollectionModal] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [showNewReqModal, setShowNewReqModal] = useState(false);
  const [newReqName, setNewReqName] = useState("");
  const [showNewSubColModal, setShowNewSubColModal] = useState(false);
  const [newSubColName, setNewSubColName] = useState("");
  const [targetAddColId, setTargetAddColId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const { showToast } = useToast();
  const [bodyCopied, setBodyCopied] = useState(false);
  const [responseCopied, setResponseCopied] = useState(false);
  const [curlCopied, setCurlCopied] = useState(false);
  const [pythonCopied, setPythonCopied] = useState(false);
  const [showPythonModal, setShowPythonModal] = useState(false);
  const [showCurlModal, setShowCurlModal] = useState(false);
  const [isBuildingCurl, setIsBuildingCurl] = useState(false);
  const [resolvedCurl, setResolvedCurl] = useState("");
  const [curlError, setCurlError] = useState<string | null>(null);
  const [newOutputName, setNewOutputName] = useState("");
  const [descMode, setDescMode] = useState<"write" | "preview">("write");
  const [showImproveModal, setShowImproveModal] = useState(false);
  const [improvedDraft, setImprovedDraft] = useState("");
  const [improveMode, setImproveMode] = useState<"preview" | "edit">("preview");
  const [isImprovingDescription, setIsImprovingDescription] = useState(false);
  const [resolvedPreview, setResolvedPreview] = useState<{
    url: string;
    headers: Record<string, string>;
    params: Record<string, string>;
    body: string;
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { state: searchIndexState } = useSearchIndexStatus();
  const [configHeight, setConfigHeight] = useState(296);
  const containerRef = useRef<HTMLDivElement>(null);
  const bodyEditorRef = useRef<any>(null);

  const activeCollection = selectedRequestId ? findRequestOwnerCollection(collections, selectedRequestId) : undefined;
  const activeRequest = activeCollection ? findRequestInTree(activeCollection, selectedRequestId) : undefined;

  // Bare {{name}} tokens across all interpolated fields, live as the user types
  const detectedInputs = useMemo(
    () => scanInputNames({
      url: reqUrl,
      headers: reqHeaders,
      queryParams: reqQueryParams,
      body: reqBody,
      authType: reqAuthType,
      authConfig: reqAuthConfig,
    }),
    [reqUrl, reqHeaders, reqQueryParams, reqBody, reqAuthType, reqAuthConfig]
  );
  // Saved bindings whose token no longer appears anywhere (pruned on save)
  const staleInputs = reqInputs.filter((b) => !detectedInputs.includes(b.name));

  const setInputBinding = (name: string, patch: Partial<InputBinding>) =>
    setReqInputs((prev) => {
      const idx = prev.findIndex((b) => b.name === name);
      if (idx === -1) return [...prev, { name, source: "literal", value: "", ...patch }];
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });

  const renameOutputAt = (index: number, newName: string) => {
    const oldName = reqOutputs[index];
    setReqOutputs((prev) => prev.map((o, i) => (i === index ? newName : o)));
    if (oldName === newName) return;
    setReqOutputDescriptions((prev) => {
      const { [oldName]: desc, ...rest } = prev;
      return newName ? { ...rest, [newName]: desc ?? "" } : rest;
    });
  };

  const removeOutputAt = (index: number) => {
    const name = reqOutputs[index];
    setReqOutputs((prev) => prev.filter((_, i) => i !== index));
    setReqOutputDescriptions((prev) => {
      const { [name]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const setOutputDescription = (name: string, description: string) =>
    setReqOutputDescriptions((prev) => ({ ...prev, [name]: description }));

  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Persist the selected request in the URL so it survives a refresh.
  useEffect(() => {
    if (!selectedRequestId) return;
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("request") === selectedRequestId) return;
    params.set("request", selectedRequestId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [selectedRequestId]);

  // Deep-link: once collections load, select the request named in the URL (if any).
  useEffect(() => {
    const requestParam = searchParams.get("request");
    if (!requestParam || requestParam === selectedRequestId) return;
    const owner = findRequestOwnerCollection(collections, requestParam);
    if (owner) {
      setSelectedCollectionId(owner.id);
      setSelectedRequestId(requestParam);
      const path = findAncestorPathToRequest(owner, requestParam);
      if (path) {
        setExpandedFolders((prev) => {
          const next = { ...prev };
          for (const id of path) next[id] = true;
          return next;
        });
      }
    }
  }, [collections]);

  const toggleFolder = (id: string) => {
    setExpandedFolders(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const onSave = async () => {
    try {
      await handleSaveRequest();
      showToast("Request saved", { type: "success" });
    } catch (err: any) {
      showToast(err.message, { type: "error" });
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (selectedRequestId) onSave();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedRequestId, onSave]);

  const onCreateCollectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColName) return;
    try {
      await handleCreateCollection(newColName);
      setNewColName("");
      setShowNewCollectionModal(false);
      showToast("Collection created", { type: "success" });
    } catch (err: any) {
      showToast(err.message, { type: "error" });
    }
  };

  const onCreateRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await handleCreateRequest(newReqName || "New Request", targetAddColId || undefined);
      setNewReqName("");
      setShowNewReqModal(false);
      setTargetAddColId(null);
    } catch (err: any) {
      showToast(err.message, { type: "error" });
    }
  };

  const onCreateSubCollectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetAddColId) return;
    try {
      await handleCreateSubCollection(newSubColName || "New Sub-collection", targetAddColId);
      setNewSubColName("");
      setShowNewSubColModal(false);
      setTargetAddColId(null);
      showToast("Sub-collection created", { type: "success" });
    } catch (err: any) {
      showToast(err.message, { type: "error" });
    }
  };

  const onImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importId) return;
    try {
      await handleImportCollection(importId);
      setImportId("");
      showToast("Collection connected", { type: "success" });
    } catch (err: any) {
      showToast(err.message, { type: "error" });
    }
  };

  const onShareSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareEmail) return;
    try {
      await handleAddCollaborator(shareEmail);
      setShareEmail("");
      setShowShareModal(false);
      showToast(`Shared with ${shareEmail}`, { type: "success" });
    } catch (err: any) {
      showToast(err.message, { type: "error" });
    }
  };

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    showToast("Collection ID copied — ready to share", { type: "success" });
  };

  const handleExportCollection = (node: any) => {
    downloadJson(serializeCollectionForExport(node), collectionExportFilename(node.name));
    showToast("Collection exported", { type: "success" });
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const { collection } = parseCollectionImport(await file.text());
      const prepared = prepareImportedCollection(collection, authFunctions);
      const created = await importCollectionTree(prepared);
      setSelectedCollectionId(created.id);
      showToast(`Imported "${created.name}"`, { type: "success" });
    } catch (err: any) {
      showToast(err.message, { type: "error" });
    } finally {
      // Reset so picking the same file again re-fires onChange.
      input.value = "";
    }
  };

  const runGenerateParser = async (promptText: string) => {
    setIsGeneratingAiParser(true);
    try {
      const responseSource = apiResponse ?? activeRequest?.lastResponse;
      const result = await apiCall("/api/ai/generate-parser", {
        method: "POST",
        body: JSON.stringify({
          prompt: promptText,
          responseBodySample: responseSource ? JSON.stringify(responseSource.body, null, 2) : "",
          outputs: reqOutputs,
        }),
      });
      if (result.generatedScript) {
        setReqParserScript(result.generatedScript);
        showToast("Parser script generated", { type: "success" });
      }
    } catch (e: any) {
      showToast(`AI code generation failed: ${e.message}`, { type: "error" });
    } finally {
      setIsGeneratingAiParser(false);
    }
  };

  const runImproveDescription = async () => {
    setIsImprovingDescription(true);
    try {
      const result = await apiCall("/api/ai/improve-description", {
        method: "POST",
        body: JSON.stringify({
          draft: reqDescription,
          name: activeRequest?.name || "",
          method: reqMethod,
          url: reqUrl,
          bodyType: reqBodyType,
          body: reqBody,
          inputs: reqInputs,
          outputs: reqOutputs,
          outputDescriptions: reqOutputDescriptions,
        }),
      });
      if (result.improvedDescription) {
        setImprovedDraft(result.improvedDescription);
        setImproveMode("preview");
        setShowImproveModal(true);
      }
    } catch (e: any) {
      showToast(`AI description improvement failed: ${e.message}`, { type: "error" });
    } finally {
      setIsImprovingDescription(false);
    }
  };

  const generateAiParserScript = async () => {
    if (!aiPrompt) return;
    await runGenerateParser(aiPrompt);
    setShowAiModal(false);
    setAiPrompt("");
  };

  const handleFixMissingOutputs = async () => {
    const missing: string[] = (apiResponse ?? activeRequest?.lastResponse)?.missingOutputs || [];
    if (!missing.length) return;
    await runGenerateParser(
      `Update the parser script so these declared outputs are set on both the output object and as env vars (same name for both): ${missing.join(", ")}.`
    );
  };

  const handleUrlPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    const parsed = parseCurl(text);
    if (!parsed) return; // not a curl command — allow normal paste
    e.preventDefault();
    setReqMethod(parsed.method);
    setReqUrl(parsed.url);
    setReqHeaders(parsed.headers.length ? parsed.headers : [{ key: "", value: "" }]);
    setReqBodyType(parsed.bodyType);
    setReqBody(parsed.body);
    if (parsed.authType) {
      setReqAuthType(parsed.authType);
      setReqAuthConfig({ ...reqAuthConfig, ...parsed.authConfig });
    }
    showToast("Imported from curl", { type: "success" });
  };

  const formatBody = (minify: boolean) => {
    try {
      const parsed = JSON.parse(reqBody);
      setReqBody(JSON.stringify(parsed, null, minify ? undefined : 2));
    } catch {
      showToast("Invalid JSON", { type: "error" });
    }
  };

  const insertBodyToken = (token: string) => {
    const editor = bodyEditorRef.current;
    if (!editor) return;
    const selection = editor.getSelection();
    editor.executeEdits("insert-dynamic-token", [{ range: selection, text: token, forceMoveMarkers: true }]);
    editor.focus();
  };

  const copyToClipboard = (text: string, setFlag: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setFlag(true);
    setTimeout(() => setFlag(false), 2000);
  };

  const getResponseText = (): string => {
    if (responseTab === "last") {
      const lastResponse = activeRequest?.lastResponse;
      if (!lastResponse) return "";
      return typeof lastResponse.body === "object"
        ? JSON.stringify(lastResponse.body, null, 2)
        : String(lastResponse.body ?? "");
    }
    if (!apiResponse) return "";
    if (responseTab === "headers") return JSON.stringify(apiResponse.headers || {}, null, 2);
    if (responseTab === "raw") return JSON.stringify(apiResponse, null, 2);
    if (responseTab === "extracted") return JSON.stringify(apiResponse.outputs || {}, null, 2);
    return typeof apiResponse.body === "object"
      ? JSON.stringify(apiResponse.body, null, 2)
      : String(apiResponse.body ?? "");
  };

  const buildCurlFromFields = (
    method: string,
    url: string,
    headers: Record<string, string>,
    params: Record<string, string>,
    bodyType: string,
    body: string
  ): string => {
    let fullUrl = url;
    const q = Object.entries(params).filter(([k]) => k !== "");
    if (q.length) {
      const qs = q.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
      fullUrl += (fullUrl.includes("?") ? "&" : "?") + qs;
    }
    const shell = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
    const parts: string[] = [`curl -X ${method}`, `  ${shell(fullUrl)}`];
    Object.entries(headers).filter(([k]) => k !== "").forEach(([k, v]) => {
      parts.push(`  -H ${shell(`${k}: ${v}`)}`);
    });
    if (bodyType !== "NONE" && body) {
      parts.push(`  -d ${shell(body)}`);
    }
    return parts.join(" \\\n");
  };

  const handleCopyCurl = async () => {
    setShowCurlModal(true);
    setIsBuildingCurl(true);
    setCurlError(null);
    setCurlCopied(false);
    try {
      const resolved = await apiCall("/api/executor/preview", {
        method: "POST",
        body: JSON.stringify({
          requestId: selectedRequestId,
          method: reqMethod,
          url: reqUrl,
          headers: reqHeaders.filter((h) => h.key !== ""),
          queryParams: reqQueryParams.filter((p) => p.key !== ""),
          bodyType: reqBodyType,
          body: reqBody,
          authType: reqAuthType,
          authConfig: {
            token: reqAuthConfig.token,
            key: reqAuthConfig.key,
            value: reqAuthConfig.value,
            authFunctionId: reqAuthConfig.authFunctionId || null,
            tokenField: reqAuthConfig.tokenField
          },
          requestInterceptorScript: reqInterceptorScript,
          inputs: reqInputs,
          environmentId: selectedEnvId || null
        })
      });
      const curl = buildCurlFromFields(reqMethod, resolved.url, resolved.headers, resolved.params, reqBodyType, resolved.body);
      setResolvedCurl(curl);
      copyToClipboard(curl, setCurlCopied);
    } catch (e: any) {
      setCurlError(e.message || "Failed to resolve request tokens");
    } finally {
      setIsBuildingCurl(false);
    }
  };

  const buildPython = (
    resolved?: { url: string; headers: Record<string, string>; params: Record<string, string>; body: string } | null
  ): string => {
    const extraModels: string[] = [];

    const toClassName = (name: string) =>
      name.replace(/[^a-zA-Z0-9]/g, "_").replace(/^[0-9]/, "_$&")
          .split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");

    const pyType = (v: any, nameHint: string): string => {
      if (v === null) return "Optional[Any]";
      if (typeof v === "boolean") return "bool";
      if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
      if (typeof v === "string") return "str";
      if (Array.isArray(v)) {
        if (v.length > 0 && v[0] !== null && typeof v[0] === "object" && !Array.isArray(v[0])) {
          const modelName = toClassName(nameHint) + "Item";
          extraModels.push(`class ${modelName}(BaseModel):\n${modelFields(v[0], modelName)}`);
          return `List[${modelName}]`;
        }
        return "List[Any]";
      }
      if (typeof v === "object") {
        const modelName = toClassName(nameHint);
        extraModels.push(`class ${modelName}(BaseModel):\n${modelFields(v, modelName)}`);
        return modelName;
      }
      return "Any";
    };

    const modelFields = (obj: Record<string, any>, parentName: string): string =>
      Object.entries(obj)
        .map(([k, v]) => `    ${k}: ${pyType(v, parentName + "_" + k)}`)
        .join("\n") || "    pass";

    const q = resolved
      ? Object.entries(resolved.params).filter(([k]) => k !== "")
      : reqQueryParams.filter((p) => p.key !== "").map((p) => [p.key, p.value] as [string, string]);
    let url = resolved ? resolved.url : reqUrl;
    if (q.length) {
      const qs = q.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
      url += (url.includes("?") ? "&" : "?") + qs;
    }

    const bodySource = resolved ? resolved.body : reqBody;
    let requestBodyObj: Record<string, any> | null = null;
    if (reqBodyType === "JSON" && bodySource) {
      try { requestBodyObj = JSON.parse(bodySource); } catch { /* ignore */ }
    }
    const hasRequestModel = requestBodyObj && typeof requestBodyObj === "object" && !Array.isArray(requestBodyObj);

    const responseBodyObj = activeRequest?.lastResponse?.body;
    let responseModelName = "";
    let responseModelBlock = "";

    if (responseBodyObj !== null && responseBodyObj !== undefined) {
      if (Array.isArray(responseBodyObj) && responseBodyObj.length > 0 &&
          typeof responseBodyObj[0] === "object" && responseBodyObj[0] !== null && !Array.isArray(responseBodyObj[0])) {
        responseModelName = "List[ResponseItem]";
        responseModelBlock = `class ResponseItem(BaseModel):\n${modelFields(responseBodyObj[0], "ResponseItem")}`;
      } else if (typeof responseBodyObj === "object" && !Array.isArray(responseBodyObj)) {
        responseModelName = "ResponseBody";
        responseModelBlock = `class ResponseBody(BaseModel):\n${modelFields(responseBodyObj, "ResponseBody")}`;
      }
    }

    // Build request model fields (which may push sub-models into extraModels)
    const requestModelBlock = hasRequestModel
      ? `class RequestBody(BaseModel):\n${modelFields(requestBodyObj!, "RequestBody")}`
      : "";

    const lines: string[] = [];
    lines.push("from __future__ import annotations");
    lines.push("import requests");
    lines.push("from pydantic import BaseModel");
    lines.push("from typing import Any, Dict, List, Optional");

    // Emit sub-models first (they are referenced by the top-level models)
    for (const m of extraModels) {
      lines.push("");
      lines.push(m);
    }

    if (requestModelBlock) {
      lines.push("");
      lines.push(requestModelBlock);
    }

    if (responseModelBlock) {
      lines.push("");
      lines.push(responseModelBlock);
    }

    const returnType = responseModelName || "dict";
    lines.push("");
    lines.push("");
    lines.push(`def call_api() -> ${returnType}:`);
    lines.push(`    url = "${url}"`);

    const filteredHeaders: [string, string][] = resolved
      ? Object.entries(resolved.headers).filter(([k]) => k !== "")
      : reqHeaders.filter((h) => h.key !== "").map((h) => [h.key, h.value]);
    if (filteredHeaders.length) {
      lines.push("    headers = {");
      filteredHeaders.forEach(([k, v]) => {
        lines.push(`        "${k}": "${v}",`);
      });
      lines.push("    }");
    } else {
      lines.push("    headers = {}");
    }

    if (hasRequestModel) {
      const fieldInits = Object.entries(requestBodyObj!).map(([k, v]) => {
        const val = typeof v === "string" ? `"${v}"` : JSON.stringify(v);
        return `        ${k}=${val},`;
      }).join("\n");
      lines.push("    payload = RequestBody(");
      lines.push(fieldInits);
      lines.push("    )");
    }

    const method = reqMethod.toLowerCase();
    const hasBody = hasRequestModel || (reqBodyType !== "NONE" && bodySource);
    if (hasBody) {
      lines.push(`    response = requests.${method}(`);
      lines.push("        url,");
      lines.push("        headers=headers,");
      if (hasRequestModel) {
        lines.push("        json=payload.model_dump(),");
      } else {
        lines.push(`        data=${JSON.stringify(bodySource)},`);
      }
      lines.push("    )");
    } else {
      lines.push(`    response = requests.${method}(url, headers=headers)`);
    }

    lines.push("    response.raise_for_status()");
    if (responseModelName === "ResponseBody") {
      lines.push("    return ResponseBody(**response.json())");
    } else if (responseModelName) {
      lines.push("    return response.json()  # List[ResponseItem]");
    } else {
      lines.push("    return response.json()");
    }

    return lines.join("\n");
  };

  const handleShowPython = async () => {
    setShowPythonModal(true);
    setResolvedPreview(null);
    setPreviewError(null);
    try {
      const resolved = await apiCall("/api/executor/preview", {
        method: "POST",
        body: JSON.stringify({
          requestId: selectedRequestId,
          method: reqMethod,
          url: reqUrl,
          headers: reqHeaders.filter((h) => h.key !== ""),
          queryParams: reqQueryParams.filter((p) => p.key !== ""),
          bodyType: reqBodyType,
          body: reqBody,
          authType: reqAuthType,
          authConfig: {
            token: reqAuthConfig.token,
            key: reqAuthConfig.key,
            value: reqAuthConfig.value,
            authFunctionId: reqAuthConfig.authFunctionId || null,
            tokenField: reqAuthConfig.tokenField
          },
          requestInterceptorScript: reqInterceptorScript,
          inputs: reqInputs,
          environmentId: selectedEnvId || null
        })
      });
      setResolvedPreview(resolved);
    } catch (e: any) {
      setPreviewError(e.message || "Failed to resolve request tokens");
    }
  };

  const handleSplitDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = configHeight;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const next = startHeight + (moveEvent.clientY - startY);
      setConfigHeight(Math.min(Math.max(next, 140), rect.height - 160));
    };
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const configTabs: { id: ConfigTab; label: string }[] = [
    { id: "headers", label: "Headers" },
    { id: "params", label: "Params" },
    { id: "auth", label: "Auth" },
    { id: "inputs", label: detectedInputs.length ? `Input (${detectedInputs.length})` : "Input" },
    { id: "output", label: reqOutputs.length ? `Output (${reqOutputs.length})` : "Output" },
    { id: "interceptor", label: "Interceptor" },
    { id: "description", label: "Description" },
    { id: "body", label: "Body" },
  ];

  const responseTabs: ("pretty" | "headers" | "raw" | "extracted" | "last")[] = [
    "pretty", "headers", "raw", "extracted", "last",
  ];

  const inputCls =
    "h-[30px] bg-cream border border-line rounded-md px-2.5 font-mono text-xs text-graphite outline-none focus:border-clay";

  return (
    <div className="h-full flex overflow-hidden">

      {/* Collections sidebar */}
      <div
        className="flex-shrink-0 bg-panel border-r border-line flex flex-col overflow-hidden transition-all duration-200"
        style={{ width: sidebarCollapsed ? 40 : 280 }}
      >
        <div className="px-2 py-3.5 border-b border-line flex items-center justify-between flex-shrink-0 gap-1">
          {!sidebarCollapsed && (
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-stone pl-2 flex-1">Collections</span>
          )}
          <div className="flex gap-1 items-center ml-auto">
            {!sidebarCollapsed && (
              <>
                <button
                  onClick={() => setShowNewCollectionModal(true)}
                  title="New collection"
                  className="h-7 w-7 rounded-md border border-line bg-cream flex items-center justify-center hover:bg-hover transition-colors"
                >
                  <Plus className="h-3.5 w-3.5 text-graphite" />
                </button>
              </>
            )}
            <button
              onClick={() => setSidebarCollapsed((v) => !v)}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="h-7 w-7 rounded-md border border-line bg-cream flex items-center justify-center hover:bg-hover transition-colors flex-shrink-0"
            >
              {sidebarCollapsed
                ? <PanelLeftOpen className="h-3.5 w-3.5 text-graphite" />
                : <PanelLeftClose className="h-3.5 w-3.5 text-graphite" />}
            </button>
          </div>
        </div>

        {/* Search across name / endpoint / description */}
        <div className="px-3 pt-2.5 pb-1.5 flex-shrink-0" style={{ display: sidebarCollapsed ? "none" : undefined }}>
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-mute absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search name, endpoint, description…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-[30px] bg-cream border border-line rounded-md pl-8 pr-2.5 text-xs text-graphite outline-none focus:border-clay"
            />
          </div>
          {searchIndexState === "indexing" && (
            <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-mute">
              <span className="h-1.5 w-1.5 rounded-full bg-clay animate-pulse" />
              Indexing requests…
            </div>
          )}
        </div>

        {/* Connect-by-ID bar */}
        <form onSubmit={onImportSubmit} className="px-3 pt-1 pb-1.5 flex gap-1.5 flex-shrink-0" style={{ display: sidebarCollapsed || searchQuery.trim() ? "none" : undefined }}>
          <input
            type="text"
            placeholder="Connect collection by ID…"
            value={importId}
            onChange={(e) => setImportId(e.target.value)}
            className="flex-1 h-[30px] bg-cream border border-line rounded-md px-2.5 text-xs text-graphite outline-none focus:border-clay"
          />
          <button
            type="submit"
            className="h-[30px] px-2.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-hover transition-colors"
          >
            Connect
          </button>
        </form>

        {/* JSON-file import */}
        <div className="px-3 pb-2.5 border-b border-line flex-shrink-0" style={{ display: sidebarCollapsed || searchQuery.trim() ? "none" : undefined }}>
          <input
            type="file"
            accept=".json,application/json"
            ref={importFileRef}
            onChange={onImportFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => importFileRef.current?.click()}
            className="w-full flex items-center justify-center gap-1 py-1.5 px-1.5 border border-dashed border-line rounded-md text-[10px] text-mute hover:border-clay hover:text-clay transition-colors"
          >
            <Upload className="h-3 w-3" /> Import from JSON file
          </button>
        </div>

        {/* Collections list (replaced by ranked search results while searching) */}
        <div className="flex-1 overflow-y-auto p-2" style={{ display: sidebarCollapsed ? "none" : undefined }}>
          {searchQuery.trim() ? (
            <SearchResultsList
              query={searchQuery}
              collections={collections}
              onSelectRequest={(collectionLocalId, requestId) => {
                setSelectedCollectionId(collectionLocalId);
                setSelectedRequestId(requestId);
              }}
            />
          ) : (
            <>
              {collections.map((col) => (
                <CollectionNode
                  key={col.id}
                  node={col}
                  depth={1}
                  selectedCollectionId={selectedCollectionId}
                  selectedRequestId={selectedRequestId}
                  setSelectedCollectionId={setSelectedCollectionId}
                  setSelectedRequestId={setSelectedRequestId}
                  setTargetAddColId={setTargetAddColId}
                  setShowNewReqModal={setShowNewReqModal}
                  setShowNewSubColModal={setShowNewSubColModal}
                  handleMoveNode={handleMoveNode}
                  handleDeleteNode={handleDeleteNode}
                  handleRenameNode={handleRenameNode}
                  handleDuplicateRequest={handleDuplicateRequest}
                  handleCopyId={handleCopyId}
                  handleExportCollection={handleExportCollection}
                  copiedId={copiedId}
                  methodStyle={methodStyle}
                  expandedFolders={expandedFolders}
                  toggleFolder={toggleFolder}
                  editingNodeId={editingNodeId}
                  setEditingNodeId={setEditingNodeId}
                  editingName={editingName}
                  setEditingName={setEditingName}
                />
              ))}
              {collections.length === 0 && (
                <p className="text-xs text-mute text-center px-4 py-8 leading-relaxed">
                  No collections yet. Create one with the + button above.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Workspace */}
      <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden">
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
                onPaste={handleUrlPaste}
                onKeyDown={(e) => { if (e.key === "Enter") handleExecuteRequest(); }}
                placeholder="Request URL (paste a curl command to import)"
                className="flex-1 h-[38px] bg-cream border border-line rounded-lg px-3.5 font-mono text-xs text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
              />

              <button
                onClick={onSave}
                className="h-[38px] px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
              >
                Save
              </button>

              <button
                onClick={handleCopyCurl}
                title="Copy as cURL"
                className="h-[38px] px-3 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors flex items-center gap-1.5 flex-shrink-0"
              >
                {curlCopied ? <Check className="h-3.5 w-3.5 text-sage" /> : <Copy className="h-3.5 w-3.5" />}
                cURL
              </button>

              <button
                onClick={handleShowPython}
                title="Show Python client code (requests + Pydantic)"
                className="h-[38px] px-3 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors flex items-center gap-1.5 flex-shrink-0"
              >
                <Code2 className="h-3.5 w-3.5" />
                Show Python
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
            <div className="flex-shrink-0 flex flex-col border-b border-line overflow-hidden" style={{ height: configHeight }}>
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

                {/* Query Params */}
                {configTab === "params" && (
                  <div className="p-4 flex flex-col gap-1.5">
                    {reqQueryParams.length === 0 && (
                      <p className="text-xs text-mute py-4 text-center">No query parameters defined.</p>
                    )}
                    {reqQueryParams.map((param, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          value={param.key}
                          placeholder="Parameter"
                          onChange={(e) => {
                            const next = [...reqQueryParams];
                            next[idx].key = e.target.value;
                            setReqQueryParams(next);
                          }}
                          className={`${inputCls} w-[156px]`}
                        />
                        <input
                          value={param.value}
                          placeholder="Value"
                          onChange={(e) => {
                            const next = [...reqQueryParams];
                            next[idx].value = e.target.value;
                            setReqQueryParams(next);
                          }}
                          className={`${inputCls} flex-1`}
                        />
                        <button
                          onClick={() => setReqQueryParams(reqQueryParams.filter((_, i) => i !== idx))}
                          className="h-7 w-7 rounded-md border border-line flex items-center justify-center text-stone hover:bg-danger-soft hover:text-danger transition-colors flex-shrink-0"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setReqQueryParams([...reqQueryParams, { key: "", value: "" }])}
                      className="flex items-center gap-1.5 px-3 py-1.5 mt-1 w-fit border border-dashed border-line rounded-md text-xs text-mute hover:border-clay hover:text-clay transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add param
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
                          placeholder="Token, {{env.VARIABLE}} or {{input}}"
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
                      <div className="flex flex-col gap-3">
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
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-medium text-stone">Token field</label>
                          <input
                            type="text"
                            placeholder="e.g. access_token"
                            value={reqAuthConfig.tokenField || ""}
                            onChange={(e) => setReqAuthConfig({ ...reqAuthConfig, tokenField: e.target.value })}
                            className="h-[38px] bg-cream border border-line rounded-lg px-3.5 font-mono text-xs text-ink outline-none focus:border-clay"
                          />
                          <p className="text-[11px] text-mute">
                            Leave blank if this hook returns a plain string. Required if it returns an object (e.g. access_token).
                          </p>
                        </div>
                      </div>
                    )}

                    {reqAuthType === "NONE" && (
                      <p className="text-[11px] text-mute">No authentication configured.</p>
                    )}
                  </div>
                )}

                {/* Inputs */}
                {configTab === "inputs" && (
                  <div className="p-4 flex flex-col gap-1.5">
                    {detectedInputs.length === 0 && staleInputs.length === 0 && (
                      <p className="text-xs text-mute py-4 text-center">
                        No inputs detected. Type {"{{name}}"} in the URL, headers, params, body or auth fields.
                        Use {"{{env.NAME}}"} for environment variables.
                      </p>
                    )}
                    {detectedInputs.map((name) => {
                      const binding = reqInputs.find((b) => b.name === name);
                      const source = binding?.source || "literal";
                      return (
                        <div key={name} className="flex items-center gap-2">
                          <span className="font-mono text-xs font-medium text-clay w-[156px] truncate flex-shrink-0" title={`{{${name}}}`}>
                            {name}
                          </span>
                          <Dropdown
                            value={source}
                            onChange={(v) => setInputBinding(name, { source: v as InputBinding["source"], value: "" })}
                            className="h-[30px] px-2.5 rounded-md text-xs text-ink"
                            widthClass="w-[120px]"
                            options={[
                              { value: "literal", label: "Literal" },
                              { value: "generator", label: "Generator" },
                            ]}
                          />
                          {source === "literal" ? (
                            <input
                              value={binding?.value || ""}
                              placeholder={`unbound — sent as {{${name}}}`}
                              onChange={(e) => setInputBinding(name, { value: e.target.value })}
                              className={`${inputCls} flex-1`}
                            />
                          ) : (
                            <GeneratorBindingButton
                              value={binding?.value || ""}
                              onChange={(tokenBody) => setInputBinding(name, { value: tokenBody })}
                            />
                          )}
                        </div>
                      );
                    })}
                    {staleInputs.map((binding) => (
                      <div key={binding.name} className="flex items-center gap-2 opacity-50">
                        <span className="font-mono text-xs w-[156px] truncate flex-shrink-0 line-through" title={binding.name}>
                          {binding.name}
                        </span>
                        <span className="text-[11px] text-mute flex-1">not referenced in the request — removed on save</span>
                        <button
                          onClick={() => setReqInputs(reqInputs.filter((b) => b.name !== binding.name))}
                          className="h-7 w-7 rounded-md border border-line flex items-center justify-center text-stone hover:bg-danger-soft hover:text-danger transition-colors flex-shrink-0"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {detectedInputs.length > 0 && (
                      <p className="text-[11px] text-mute mt-2">
                        Inputs are resolved once per run; a generator used in several places gets the same value.
                        Literal values may contain {"{{env.X}}"} and {"{{$...}}"} tokens.
                      </p>
                    )}
                  </div>
                )}

                {/* Output */}
                {configTab === "output" && (
                  <div className="flex flex-col h-full">
                    <div className="px-4 pt-3 pb-2 flex flex-col gap-2 flex-shrink-0">
                      <div className="flex flex-col gap-2">
                        <span className="text-xs font-medium text-stone">Declared outputs</span>
                        <div className="flex flex-col gap-1.5">
                          {reqOutputs.map((name, index) => (
                            <div key={index} className="flex flex-col gap-1 p-2 bg-panel border border-line rounded-md">
                              <div className="flex items-center gap-2">
                                <input
                                  value={name}
                                  placeholder="output name"
                                  onChange={(e) => renameOutputAt(index, e.target.value)}
                                  className={`${inputCls} flex-1 font-mono`}
                                />
                                <button
                                  onClick={() => removeOutputAt(index)}
                                  className="h-7 w-7 rounded-md border border-line flex items-center justify-center text-stone hover:bg-danger-soft hover:text-danger transition-colors flex-shrink-0"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <input
                                value={reqOutputDescriptions[name] || ""}
                                placeholder="description (optional)"
                                onChange={(e) => setOutputDescription(name, e.target.value)}
                                className={`${inputCls} text-[11px]`}
                              />
                            </div>
                          ))}
                          <input
                            value={newOutputName}
                            placeholder="add output…"
                            onChange={(e) => setNewOutputName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              const name = newOutputName.trim();
                              if (name && !reqOutputs.includes(name)) setReqOutputs([...reqOutputs, name]);
                              setNewOutputName("");
                            }}
                            className={`${inputCls} w-full`}
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-mute">
                          Parser script runs after the response — assign <code className="font-mono">output.&lt;name&gt;</code> for
                          each declared output; <code className="font-mono">env.set(key, value)</code> writes environment variables.
                        </span>
                        <button
                          onClick={() => setShowAiModal(true)}
                          disabled={!apiResponse && !activeRequest?.lastResponse}
                          title={!apiResponse && !activeRequest?.lastResponse ? "Trigger a successful request at least once to enable the AI agent parser" : undefined}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-cream border border-line rounded-md text-xs font-medium text-clay hover:bg-panel transition-colors disabled:opacity-50 flex-shrink-0"
                        >
                          <Sparkles className="h-3.5 w-3.5" /> AI agent parser
                        </button>
                      </div>
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

                {configTab === "interceptor" && (
                  <div className="flex flex-col h-full">
                    <div className="px-4 pt-3 pb-2 flex-shrink-0">
                      <span className="text-[11px] text-mute">
                        Runs after environment-variable and dynamic-token (<code className="font-mono">{"{{$date...}}"}</code>) interpolation and
                        after auth resolution, right before the request is sent. Mutate <code className="font-mono">request.headers</code>,{" "}
                        <code className="font-mono">request.params</code>, <code className="font-mono">request.body</code> (raw string) or{" "}
                        <code className="font-mono">request.url</code> — these are applied to the outgoing request.{" "}
                        <code className="font-mono">request.method</code>/<code className="font-mono">request.bodyType</code> are read-only context.{" "}
                        <code className="font-mono">env</code> exposes the active environment&apos;s variables (read-only). Use{" "}
                        <code className="font-mono">crypto.hmac(algorithm, secret, message, encoding?)</code>,{" "}
                        <code className="font-mono">crypto.hash(algorithm, message, encoding?)</code>, and{" "}
                        <code className="font-mono">crypto.base64Encode/base64Decode(value)</code> for signing (algorithm: sha256/sha1/sha512/md5,
                        encoding: hex default or base64). Use <code className="font-mono">request.params</code> for query values — there&apos;s no{" "}
                        <code className="font-mono">URL</code>/<code className="font-mono">URLSearchParams</code> global available.
                      </span>
                    </div>
                    <div className="flex-1 mx-4 mb-4 rounded-lg overflow-hidden border border-line">
                      <Editor
                        height="100%"
                        language="javascript"
                        theme="vs-dark"
                        value={reqInterceptorScript}
                        onChange={(val) => setReqInterceptorScript(val || "")}
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

                {/* Description */}
                {configTab === "description" && (
                  <div className="flex flex-col h-full">
                    <div className="px-4 py-3 flex items-center gap-2 flex-shrink-0">
                      <div className="flex items-center rounded-md border border-line overflow-hidden">
                        {(["write", "preview"] as const).map((mode) => (
                          <button
                            key={mode}
                            onClick={() => setDescMode(mode)}
                            className="h-[30px] px-3 text-xs font-medium transition-colors"
                            style={{
                              background: descMode === mode ? "var(--color-panel)" : "var(--color-cream)",
                              color: descMode === mode ? "var(--color-ink)" : "var(--color-stone)",
                            }}
                          >
                            {mode === "write" ? "Write" : "Preview"}
                          </button>
                        ))}
                      </div>
                      <span className="text-[11px] text-mute">Markdown supported</span>
                      <button
                        onClick={runImproveDescription}
                        disabled={isImprovingDescription}
                        className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-cream border border-line rounded-md text-xs font-medium text-clay hover:bg-panel transition-colors disabled:opacity-50 flex-shrink-0"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {isImprovingDescription ? "Improving…" : "Improve with AI"}
                      </button>
                    </div>
                    <div className="flex-1 mx-4 mb-4 rounded-lg overflow-hidden border border-line bg-cream">
                      {descMode === "write" ? (
                        <textarea
                          value={reqDescription}
                          onChange={(e) => setReqDescription(e.target.value)}
                          placeholder="Describe this request in Markdown… (purpose, inputs, outputs, caveats)"
                          className="w-full h-full p-3.5 bg-cream text-sm text-ink font-mono outline-none resize-none"
                        />
                      ) : (
                        <div className="h-full overflow-y-auto p-4">
                          {reqDescription.trim() ? (
                            <MarkdownContent content={reqDescription} />
                          ) : (
                            <p className="text-xs text-mute">Nothing to preview yet — write a draft first.</p>
                          )}
                        </div>
                      )}
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
                      {reqBodyType !== "NONE" && (
                        <div className="ml-auto flex items-center gap-1.5">
                          {reqBodyType === "JSON" && (
                            <>
                              <button
                                onClick={() => formatBody(false)}
                                title="Pretty print"
                                className="h-[30px] px-2.5 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors"
                              >
                                <AlignLeft className="h-3.5 w-3.5" /> Pretty
                              </button>
                              <button
                                onClick={() => formatBody(true)}
                                title="Minify"
                                className="h-[30px] px-2.5 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors"
                              >
                                <Minimize2 className="h-3.5 w-3.5" /> Minify
                              </button>
                            </>
                          )}
                          <InsertValueMenu onInsert={insertBodyToken} />
                          <button
                            onClick={() => copyToClipboard(reqBody, setBodyCopied)}
                            title="Copy body"
                            className="h-[30px] px-2.5 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors"
                          >
                            {bodyCopied ? <Check className="h-3.5 w-3.5 text-sage" /> : <Copy className="h-3.5 w-3.5" />} Copy
                          </button>
                        </div>
                      )}
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
                          onMount={(editor) => { bodyEditorRef.current = editor; }}
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

            {/* Draggable divider */}
            <div
              onMouseDown={handleSplitDragStart}
              className="h-1 bg-line hover:bg-clay cursor-row-resize transition-colors flex-shrink-0 w-full z-10 select-none"
            />

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
                      {tab === "last" ? "Last Response" : tab}
                    </button>
                  );
                })}
                <div className="flex-1" />
                {(() => {
                  const d = responseTab === "last" ? activeRequest?.lastResponse : apiResponse;
                  if (!d) return null;
                  return (
                    <div className="flex items-center gap-2 px-4">
                      <span
                        className="font-mono text-xs font-medium px-2.5 py-0.5 rounded-full"
                        style={
                          d.status < 400
                            ? { background: "#e3f5e9", color: "#276749" }
                            : { background: "#fde8e8", color: "#c64545" }
                        }
                      >
                        {d.status} {d.statusText}
                      </span>
                      <span className="font-mono text-xs text-stone">{d.executionTimeMs} ms</span>
                      <button
                        onClick={() => copyToClipboard(getResponseText(), setResponseCopied)}
                        title="Copy response"
                        className="h-7 px-2.5 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors"
                      >
                        {responseCopied ? <Check className="h-3.5 w-3.5 text-sage" /> : <Copy className="h-3.5 w-3.5" />} Copy
                      </button>
                    </div>
                  );
                })()}
              </div>

              {responseTab === "last" ? (
                <pre className="flex-1 m-0 p-4 bg-ink-900 text-sage font-mono text-xs leading-relaxed overflow-auto whitespace-pre-wrap">
                  {activeRequest?.lastResponse
                    ? (typeof activeRequest.lastResponse.body === "object"
                        ? JSON.stringify(activeRequest.lastResponse.body, null, 2)
                        : String(activeRequest.lastResponse.body))
                    : "No successful response recorded yet."}
                </pre>
              ) : !apiResponse ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
                  <Send className="h-7 w-7 text-mute" />
                  <div className="text-sm font-medium text-mute">Send a request to see the response</div>
                  <div className="text-[13px] text-mute text-center max-w-[300px] leading-relaxed">
                    Pretty, Headers, Raw and Extracted outputs appear here.
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
                      {apiResponse.parserError && (
                        <div className="flex items-start gap-2.5 px-3.5 py-2.5 mb-3 bg-red-50 border border-red-300 rounded-lg">
                          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                          <span className="text-[12px] text-red-700 font-mono break-all">{apiResponse.parserError}</span>
                        </div>
                      )}
                      {reqOutputs.length ? (
                        <div className="flex flex-col gap-1.5">
                          {(apiResponse.missingOutputs?.length ?? 0) > 0 && (
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 mb-1 bg-amber-50 border border-amber-300 rounded-lg">
                              <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0" />
                              <span className="text-[12px] text-amber-800 flex-1">
                                {apiResponse.missingOutputs.length} declared output{apiResponse.missingOutputs.length === 1 ? "" : "s"} not set by the parser script
                              </span>
                              <button
                                onClick={handleFixMissingOutputs}
                                disabled={isGeneratingAiParser}
                                className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-amber-300 rounded-md text-[11px] font-medium text-amber-800 hover:bg-amber-100 transition-colors disabled:opacity-50 flex-shrink-0"
                              >
                                <Sparkles className="h-3 w-3" /> Fix missing outputs
                              </button>
                            </div>
                          )}
                          {reqOutputs.map((name) => {
                            const outputs = apiResponse.outputs || {};
                            const isMissing = (apiResponse.missingOutputs || []).includes(name);
                            if (!isMissing) {
                              const v = outputs[name];
                              const inEnv = !!(apiResponse.parsedVariables && name in apiResponse.parsedVariables);
                              return (
                                <div
                                  key={name}
                                  className="flex flex-col gap-1 px-3.5 py-2.5 bg-panel border border-line rounded-lg"
                                >
                                  <div className="flex items-center gap-2.5">
                                    <span className="font-mono text-xs font-medium text-clay min-w-[120px]">{name}</span>
                                    <span className="text-[11px] text-stone">=</span>
                                    <span className="font-mono text-[11px] text-graphite flex-1 truncate">
                                      {typeof v === "object" ? JSON.stringify(v) : String(v)}
                                    </span>
                                  </div>
                                  {!inEnv && (
                                    <span className="text-[11px] text-amber-700 pl-[132px]">not written to an env var</span>
                                  )}
                                </div>
                              );
                            }
                            return (
                              <div
                                key={name}
                                className="flex items-center gap-2.5 px-3.5 py-2.5 bg-amber-50 border border-amber-300 rounded-lg"
                              >
                                <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0" />
                                <span className="font-mono text-xs font-medium text-amber-800 min-w-[120px]">{name}</span>
                                <span className="text-[12px] text-amber-800 flex-1">not set by the parser script</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-2.5 min-h-[100px]">
                          <Code2 className="h-6 w-6 text-mute" />
                          <p className="text-[13px] text-mute text-center">
                            No outputs declared. Declare outputs in the Output tab to extract values from the response.
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

      {showNewSubColModal && (
        <Modal title="Create sub-collection" onClose={() => setShowNewSubColModal(false)}>
          <form onSubmit={onCreateSubCollectionSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">Name</label>
              <input
                type="text"
                placeholder="e.g. Users folder"
                value={newSubColName}
                onChange={(e) => setNewSubColName(e.target.value)}
                autoFocus
                required
                className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
              />
            </div>
            <ModalFooter onCancel={() => setShowNewSubColModal(false)} submitLabel="Create" />
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

      {showPythonModal && (() => {
        const code = buildPython(resolvedPreview);
        return (
          <Modal title="Python client" onClose={() => { setShowPythonModal(false); setPythonCopied(false); }} width={680}>
            <div className="flex flex-col gap-4">
              <p className="text-[13px] text-stone leading-relaxed">
                Generated from the current request and last successful response. Uses{" "}
                <code className="font-mono text-[12px] bg-panel px-1 py-0.5 rounded">requests</code> and{" "}
                <code className="font-mono text-[12px] bg-panel px-1 py-0.5 rounded">pydantic</code>.
              </p>
              {previewError && (
                <div className="px-3.5 py-2 bg-amber-50 border border-amber-300 rounded-lg text-[12px] text-amber-800">
                  Tokens could not be resolved — showing raw template values. ({previewError})
                </div>
              )}
              <div className="relative">
                <pre className="m-0 p-4 bg-ink-900 text-sage font-mono text-xs leading-relaxed overflow-auto whitespace-pre rounded-xl max-h-[420px]">
                  {code}
                </pre>
                <button
                  onClick={() => { copyToClipboard(code, setPythonCopied); showToast("Python code copied", { type: "success" }); }}
                  title="Copy code"
                  className="absolute top-3 right-3 h-7 px-2.5 flex items-center gap-1.5 bg-ink-800/80 border border-white/10 rounded-md text-xs font-medium text-cream/70 hover:text-cream hover:bg-ink-700 transition-colors"
                >
                  {pythonCopied ? <Check className="h-3.5 w-3.5 text-sage" /> : <Copy className="h-3.5 w-3.5" />}
                  {pythonCopied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="flex justify-end pt-1 border-t border-line">
                <button
                  onClick={() => { setShowPythonModal(false); setPythonCopied(false); }}
                  className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {showCurlModal && (
        <Modal title="cURL command" onClose={() => setShowCurlModal(false)} width={680}>
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-stone leading-relaxed">
              {curlError
                ? "Failed to resolve variables and dynamic values."
                : "Environment variables and dynamic value tokens (dates, random values) resolved to their real values."}
            </p>
            {isBuildingCurl ? (
              <div className="flex items-center justify-center h-24 text-xs text-mute">Resolving tokens…</div>
            ) : curlError ? (
              <p className="m-0 p-4 bg-ink-900 text-red-400 font-mono text-xs leading-relaxed rounded-xl">{curlError}</p>
            ) : (
              <div className="relative">
                <pre className="m-0 p-4 bg-ink-900 text-sage font-mono text-xs leading-relaxed overflow-auto whitespace-pre rounded-xl max-h-[420px]">
                  {resolvedCurl}
                </pre>
                <button
                  onClick={() => copyToClipboard(resolvedCurl, setCurlCopied)}
                  title="Copy command"
                  className="absolute top-3 right-3 h-7 px-2.5 flex items-center gap-1.5 bg-ink-800/80 border border-white/10 rounded-md text-xs font-medium text-cream/70 hover:text-cream hover:bg-ink-700 transition-colors"
                >
                  {curlCopied ? <Check className="h-3.5 w-3.5 text-sage" /> : <Copy className="h-3.5 w-3.5" />}
                  {curlCopied ? "Copied" : "Copy"}
                </button>
              </div>
            )}
            <div className="flex justify-end pt-1 border-t border-line">
              <button
                onClick={() => setShowCurlModal(false)}
                className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
              >
                Close
              </button>
            </div>
          </div>
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

      {showImproveModal && (
        <Modal title="Review AI-improved description" onClose={() => setShowImproveModal(false)} width={720}>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-md border border-line overflow-hidden">
                {(["preview", "edit"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setImproveMode(mode)}
                    className="h-[30px] px-3 text-xs font-medium transition-colors"
                    style={{
                      background: improveMode === mode ? "var(--color-panel)" : "var(--color-cream)",
                      color: improveMode === mode ? "var(--color-ink)" : "var(--color-stone)",
                    }}
                  >
                    {mode === "preview" ? "Preview" : "Edit"}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-mute">
                Review the AI version — tweak it directly before accepting.
              </span>
            </div>
            {improveMode === "preview" ? (
              <div className="max-h-[420px] overflow-y-auto border border-line rounded-lg p-4 bg-cream">
                <MarkdownContent content={improvedDraft} />
              </div>
            ) : (
              <textarea
                rows={16}
                value={improvedDraft}
                onChange={(e) => setImprovedDraft(e.target.value)}
                className="bg-cream border border-line rounded-lg p-3.5 text-sm text-ink font-mono outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)] resize-none"
              />
            )}
            <div className="flex justify-end gap-2 pt-1 border-t border-line">
              <button
                onClick={() => setShowImproveModal(false)}
                className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
              >
                Keep my draft
              </button>
              <button
                onClick={() => {
                  setReqDescription(improvedDraft);
                  setShowImproveModal(false);
                  showToast("Description updated — review and Save", { type: "success" });
                }}
                className="h-10 px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white transition-colors"
              >
                Use this version
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

const DATE_OFFSET_UNITS = [
  { value: "d", label: "Days" },
  { value: "h", label: "Hours" },
  { value: "m", label: "Minutes" },
  { value: "s", label: "Seconds" },
];

// Token bodies without braces — braces are added by the Body-editor wrapper;
// input bindings store the bare body (matches backend resolve_input_bindings).
const INSERT_VALUE_ROWS = [
  { label: "Random email", token: "$randomEmail" },
  { label: "Random first name", token: "$randomFirstName" },
  { label: "Random last name", token: "$randomLastName" },
  { label: "Random full name", token: "$randomFullName" },
];

// Shared generator picker panel — emits brace-less token bodies like
// "$date:+1d:YYYY-MM-DD" or "$randomInt:4" via onPick.
function GeneratorMenuPanel({ onPick }: { onPick: (tokenBody: string) => void }) {
  const [dateOffset, setDateOffset] = useState("0");
  const [dateUnit, setDateUnit] = useState("d");
  const [dateFormat, setDateFormat] = useState("YYYY-MM-DD");
  const [digits, setDigits] = useState("4");

  const handleUnitChange = (unit: string) => {
    setDateUnit(unit);
    setDateFormat((prev) => {
      if (prev !== "YYYY-MM-DD" && prev !== "YYYY-MM-DD HH:mm:ss") return prev; // user customized it, leave alone
      return unit === "d" ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm:ss";
    });
  };

  const pickDate = () => {
    const n = parseInt(dateOffset, 10) || 0;
    const offsetPart = n !== 0 ? `${n > 0 ? "+" : ""}${n}${dateUnit}:` : "";
    onPick(`$date:${offsetPart}${dateFormat || "YYYY-MM-DD"}`);
  };

  const pickRandomInt = () => {
    const n = Math.max(1, parseInt(digits, 10) || 4);
    onPick(`$randomInt:${n}`);
  };

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-stone uppercase tracking-wide">Date</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            value={dateOffset}
            onChange={(e) => setDateOffset(e.target.value)}
            title="Offset (e.g. 3, -2)"
            className="w-16 h-8 bg-panel border border-line rounded-md px-2 text-xs text-ink outline-none focus:border-clay"
          />
          <Dropdown
            value={dateUnit}
            onChange={handleUnitChange}
            className="h-8 px-2 rounded-md text-xs text-ink flex-1"
            options={DATE_OFFSET_UNITS}
          />
        </div>
        <input
          type="text"
          value={dateFormat}
          onChange={(e) => setDateFormat(e.target.value)}
          placeholder="YYYY-MM-DD"
          className="h-8 bg-panel border border-line rounded-md px-2 font-mono text-xs text-ink outline-none focus:border-clay"
        />
        <button
          onClick={pickDate}
          className="h-8 bg-clay hover:bg-clay-dark rounded-md text-xs font-medium text-white transition-colors"
        >
          Use date
        </button>
      </div>

      <div className="flex flex-col gap-1.5 pt-2 border-t border-line">
        <span className="text-[11px] font-medium text-stone uppercase tracking-wide">Random number</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            value={digits}
            onChange={(e) => setDigits(e.target.value)}
            className="w-16 h-8 bg-panel border border-line rounded-md px-2 text-xs text-ink outline-none focus:border-clay"
          />
          <span className="text-xs text-mute">digits</span>
          <button
            onClick={pickRandomInt}
            className="ml-auto h-8 px-3 bg-clay hover:bg-clay-dark rounded-md text-xs font-medium text-white transition-colors"
          >
            Use
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-0.5 pt-2 border-t border-line">
        {INSERT_VALUE_ROWS.map((row) => (
          <button
            key={row.token}
            onClick={() => onPick(row.token)}
            className="h-8 px-2 text-left rounded-md text-xs text-ink hover:bg-hover transition-colors"
          >
            {row.label}
          </button>
        ))}
      </div>
    </>
  );
}

// Trigger button + positioned portal around GeneratorMenuPanel.
function GeneratorMenuButton({
  buttonContent,
  buttonClassName,
  onPick,
}: {
  buttonContent: React.ReactNode;
  buttonClassName: string;
  onPick: (tokenBody: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateCoords = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ top: r.bottom + 4, left: r.right - 288 });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
    const handle = () => updateCoords();
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);
    return () => {
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={buttonClassName}
      >
        {buttonContent}
      </button>

      {open && coords &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, width: 288 }}
            className="z-[100] rounded-lg border border-line bg-cream p-3 shadow-lg shadow-ink/5 flex flex-col gap-3 animate-[fadeUp_0.12s_ease-out]"
          >
            <GeneratorMenuPanel
              onPick={(tokenBody) => {
                onPick(tokenBody);
                setOpen(false);
              }}
            />
          </div>,
          document.body
        )}
    </>
  );
}

// Body-editor variant: inserts a full {{$...}} token at the cursor.
function InsertValueMenu({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <GeneratorMenuButton
      buttonContent={<><Wand2 className="h-3.5 w-3.5" /> Insert value</>}
      buttonClassName="h-[30px] px-2.5 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors"
      onPick={(tokenBody) => onInsert(`{{${tokenBody}}}`)}
    />
  );
}

// Input-tab variant: binds an input to a generator token body.
function GeneratorBindingButton({ value, onChange }: { value: string; onChange: (tokenBody: string) => void }) {
  return (
    <GeneratorMenuButton
      buttonContent={
        <>
          <Wand2 className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="font-mono truncate">{value || "Choose generator…"}</span>
          <ChevronDown className="h-3.5 w-3.5 ml-auto flex-shrink-0" />
        </>
      }
      buttonClassName="h-[30px] px-2.5 flex-1 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs text-graphite hover:bg-panel transition-colors min-w-0 text-left"
      onPick={onChange}
    />
  );
}
