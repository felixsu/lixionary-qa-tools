"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  SelectionMode,
  type Connection,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Plus, Play, Square, Save, Download, Trash2, Pencil, Copy, Send, Repeat2, Timer,
  ShieldCheck, AlertCircle, X, RotateCcw, Sparkles,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { useAppContext, findRequestInTree } from "../../context/AppContext";
import type { Collection } from "../../context/AppContext";
import { useToast } from "../../context/ToastContext";
import Dropdown from "../../components/Dropdown";
import { Modal, ModalFooter } from "../../components/Modal";
import { confirmDialog } from "../../utils/confirmDialog";
import { scanInputNames, scanEnvNames } from "../../utils/requestTokens";
import { generateDuplicateName } from "../../utils/uniqueName";
import {
  type Flow, type FlowNode, type FlowEdge, type FlowNodeType,
  type RequestNodeConfig, type LooperNodeConfig, type DelayNodeConfig, type VerifierNodeConfig,
  type FlowInputMapping, type VerifierComparison, type ComparisonOperator,
  validateNodeName, autoNodeName, defaultConfigForType,
} from "../../utils/flowTypes";
import {
  runFlow, topoSort, publishedOutputs, ancestorNodeIds, lookupRequest,
  structuralSignature, mergeRetrySummary,
  type NodeRunStatus, type RunRecord, type FlowRunSummary, type RunHandle,
} from "../../utils/flowRunner";
import { buildRunCsv, downloadCsv, runCsvFilename, persistLastRun, loadLastRun } from "../../utils/flowReport";
import {
  uniqueCopyName, renameNodeConfig,
  buildCatalog, toWireCatalog, buildCanvasContext, validateAndPlan,
  loadChat, persistChat, clearChat, migrateChat, NEW_FLOW_CHAT_KEY,
  type ChatEntry, type Proposal,
} from "../../utils/studioAssistant";
import { studioNodeTypes, type StudioNode, type StudioNodeData } from "./components/nodes";
import RequestPicker from "./RequestPicker";
import AssistantPanel from "./AssistantPanel";

const PALETTE: { type: FlowNodeType; label: string; icon: typeof Send; hint: string }[] = [
  { type: "request", label: "Request", icon: Send, hint: "Run a saved API Explorer request" },
  { type: "looper", label: "Looper", icon: Repeat2, hint: "Repeat a request per array item" },
  { type: "delay", label: "Delay", icon: Timer, hint: "Wait a fixed number of ms" },
  { type: "verifier", label: "Verifier", icon: ShieldCheck, hint: "Assert on a response, retry n times" },
];

const inputCls =
  "h-[30px] bg-cream border border-line rounded-md px-2.5 font-mono text-xs text-graphite outline-none focus:border-clay";

// Persisted so leaving the page (or restarting the app) doesn't snap the
// editor back to the first flow.
const SELECTED_FLOW_KEY = "lixionary_selected_flow";

// ---- helpers ----------------------------------------------------------------

const requestNodeConfigOf = (node: FlowNode): RequestNodeConfig | null => {
  if (node.type === "request") return node.config as RequestNodeConfig;
  if (node.type === "looper") return (node.config as LooperNodeConfig).request;
  if (node.type === "verifier") return (node.config as VerifierNodeConfig).request;
  return null;
};

const decorate = (fn: FlowNode, status: NodeRunStatus, collections: Collection[]): StudioNodeData => {
  const cfg = requestNodeConfigOf(fn);
  if (!cfg) return { flowNode: fn, status, requestLabel: null, requestMissing: false };
  if (!cfg.requestId) return { flowNode: fn, status, requestLabel: "No request selected", requestMissing: true };
  const req = lookupRequest(collections, cfg.requestId);
  if (!req) return { flowNode: fn, status, requestLabel: "Linked request not found", requestMissing: true };
  return { flowNode: fn, status, requestLabel: `${req.method} ${req.name}`, requestMissing: false };
};

const toStudioNode = (fn: FlowNode, status: NodeRunStatus, collections: Collection[]): StudioNode => ({
  id: fn.id,
  type: fn.type,
  position: fn.position,
  data: decorate(fn, status, collections),
});

const serializeNodes = (nodes: StudioNode[]): FlowNode[] =>
  nodes.map((n) => ({ ...n.data.flowNode, position: { x: n.position.x, y: n.position.y } }));

const serializeEdges = (edges: Edge[]): FlowEdge[] =>
  edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));

const flowSignature = (nodes: FlowNode[], edges: FlowEdge[]) =>
  JSON.stringify({ nodes: nodes.map((n) => ({ ...n, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } })), edges });

// Declared input names of a request: live token scan ∪ stored bindings.
const requestInputNames = (collections: Collection[], requestId: string): string[] => {
  const req = lookupRequest(collections, requestId);
  if (!req) return [];
  const scanned = scanInputNames({
    url: req.url,
    headers: req.headers || [],
    queryParams: req.queryParams || [],
    body: req.body || "",
    authType: req.authType,
    authConfig: req.authConfig || {},
  });
  const names = [...scanned];
  for (const b of req.inputs || []) if (!names.includes(b.name)) names.push(b.name);
  return names;
};

// ---- page -------------------------------------------------------------------

export default function ApiStudioPage() {
  return (
    <ReactFlowProvider>
      <StudioEditor />
    </ReactFlowProvider>
  );
}

function StudioEditor() {
  const {
    flows, createFlow, updateFlow, deleteFlow,
    collections,
    apiCall,
    environments, selectedEnvId,
    llmSettings,
  } = useAppContext();

  const [selectedFlowId, setSelectedFlowId] = useState<string>("");
  const [nodes, setNodes, onNodesChange] = useNodesState<StudioNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [savedSignature, setSavedSignature] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [lastSummary, setLastSummary] = useState<FlowRunSummary | null>(null);
  const runHandleRef = useRef<RunHandle | null>(null);
  const clipboardRef = useRef<{ nodes: FlowNode[]; edges: FlowEdge[] } | null>(null);
  const pasteCountRef = useRef(0);
  const undoStackRef = useRef<{ nodes: FlowNode[]; edges: FlowEdge[] }[]>([]);
  // Cmd/Ctrl+S below is registered before `onSave` is defined (it's declared
  // further down, alongside the other flow-canvas handlers) — kept fresh via
  // this ref every render instead of reordering the file.
  const onSaveRef = useRef<() => void>(() => {});

  // ---- AI assistant state ----
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  // Current transcript key; also used to drop in-flight replies after a flow switch.
  const chatKeyRef = useRef<string>(NEW_FLOW_CHAT_KEY);

  const [showNewFlowModal, setShowNewFlowModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [flowNameDraft, setFlowNameDraft] = useState("");
  const { showToast } = useToast();

  const { screenToFlowPosition } = useReactFlow();

  const selectedFlow = flows.find((f) => f.id === selectedFlowId) || null;

  // Per-flow chat transcript (device-local). "__new__" holds the conversation
  // started before any flow exists; it moves onto the flow created by Apply.
  const chatKey = selectedFlowId || NEW_FLOW_CHAT_KEY;
  useEffect(() => {
    chatKeyRef.current = chatKey;
    setChatEntries(loadChat(chatKey));
    setAssistantError(null);
  }, [chatKey]);

  const dirty = useMemo(() => {
    if (!selectedFlow) return false;
    return flowSignature(serializeNodes(nodes), serializeEdges(edges)) !== savedSignature;
  }, [nodes, edges, savedSignature, selectedFlow]);

  // Load a flow into the canvas (statuses from its stored last run, dimmed as "idle").
  const loadFlow = useCallback((flow: Flow) => {
    const lastRun = loadLastRun(flow.id);
    const statusByNode = new Map<string, NodeRunStatus>();
    if (lastRun?.nodeStatuses) {
      for (const [nodeId, status] of Object.entries(lastRun.nodeStatuses)) statusByNode.set(nodeId, status);
    } else if (lastRun) {
      // Pre-Retry blobs: derive per-node status from records, last one wins.
      for (const r of lastRun.records) statusByNode.set(r.nodeId, r.status);
    }
    setNodes(flow.nodes.map((fn) => toStudioNode(fn, statusByNode.get(fn.id) || "idle", collections)));
    setEdges(flow.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
    setSavedSignature(flowSignature(flow.nodes, flow.edges));
    setSelectedNodeId(null);
    undoStackRef.current = [];
    setRecords(lastRun?.records || []);
    setLastSummary(lastRun);
  }, [collections, setNodes, setEdges]);

  // Initial selection + reload when the selected flow record changes (sync pull).
  useEffect(() => {
    if (!flows.length) {
      setSelectedFlowId("");
      setNodes([]);
      setEdges([]);
      return;
    }
    if (!selectedFlowId || !flows.some((f) => f.id === selectedFlowId)) {
      let target = flows[0];
      try {
        const persistedId = localStorage.getItem(SELECTED_FLOW_KEY);
        const persisted = persistedId ? flows.find((f) => f.id === persistedId) : undefined;
        if (persisted) target = persisted;
      } catch { /* non-fatal */ }
      setSelectedFlowId(target.id);
      loadFlow(target);
    }
  }, [flows]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedFlowId) return;
    try { localStorage.setItem(SELECTED_FLOW_KEY, selectedFlowId); } catch { /* non-fatal */ }
  }, [selectedFlowId]);

  // Refresh request labels when collections change (e.g. a request was renamed).
  useEffect(() => {
    setNodes((prev) => prev.map((n) => ({ ...n, data: decorate(n.data.flowNode, n.data.status, collections) })));
  }, [collections, setNodes]);

  const switchFlow = async (flowId: string) => {
    if (flowId === selectedFlowId) return;
    if (dirty) {
      const ok = await confirmDialog("You have unsaved changes on this flow. Discard them?");
      if (!ok) return;
    }
    const flow = flows.find((f) => f.id === flowId);
    if (!flow) return;
    setSelectedFlowId(flowId);
    loadFlow(flow);
  };

  // ---- node/edge editing ----

  const updateFlowNode = useCallback((nodeId: string, patch: Partial<FlowNode>) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId) return n;
        const updated = { ...n.data.flowNode, ...patch };
        return { ...n, data: decorate(updated, n.data.status, collections) };
      })
    );
  }, [collections, setNodes]);

  const setNodeStatus = useCallback((nodeId: string, status: NodeRunStatus) => {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n)));
  }, [setNodes]);

  const resetStatuses = useCallback(() => {
    setNodes((prev) => prev.map((n) => ({ ...n, data: { ...n.data, status: "idle" as NodeRunStatus } })));
  }, [setNodes]);

  const addNode = (type: FlowNodeType, position: { x: number; y: number }) => {
    const existing = serializeNodes(nodes);
    const fn: FlowNode = {
      id: crypto.randomUUID(),
      name: autoNodeName(type, existing),
      type,
      position,
      config: defaultConfigForType(type),
    };
    setNodes((prev) => [...prev, toStudioNode(fn, "idle", collections)]);
    setSelectedNodeId(fn.id);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-studio-node") as FlowNodeType;
    if (!type) return;
    addNode(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  // Reject self-edges, duplicates, and cycles.
  const isValidConnection = useCallback((conn: Connection | Edge) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return false;
    if (edges.some((e) => e.source === conn.source && e.target === conn.target)) return false;
    // Would adding source->target create a cycle? Only if source is reachable from target.
    const reachable = ancestorNodeIds(conn.source, serializeEdges(edges));
    return !reachable.has(conn.target);
  }, [edges]);

  const onConnect = useCallback((conn: Connection) => {
    setEdges((prev) => addEdge({ ...conn, id: crypto.randomUUID() }, prev));
  }, [setEdges]);

  // Every deletion (canvas Backspace/Delete or the inspector trash button)
  // lands here so Cmd/Ctrl+Z can restore it. Cleared on flow switch.
  const pushUndo = useCallback((deletedNodes: FlowNode[], deletedEdges: FlowEdge[]) => {
    if (!deletedNodes.length && !deletedEdges.length) return;
    undoStackRef.current.push({ nodes: deletedNodes, edges: deletedEdges });
    if (undoStackRef.current.length > 20) undoStackRef.current.shift();
  }, []);

  // Copy/paste selected blocks (Cmd/Ctrl+C / V) and undo deletion (Cmd/Ctrl+Z).
  // Skipped while a text field has focus so normal text editing keeps working.
  useEffect(() => {
    const isTypingTarget = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "v" && key !== "z" && key !== "s") return;

      if (key === "s") {
        // Unlike copy/paste/undo, Save must fire even while a text field on
        // the canvas has focus — that's the whole point of the shortcut —
        // so it's handled before the isTypingTarget bail-out below.
        e.preventDefault();
        if (showNewFlowModal || showRenameModal) return;
        if (selectedFlow && dirty && !isSaving) onSaveRef.current();
        return;
      }

      if (isTypingTarget(document.activeElement) || showNewFlowModal || showRenameModal) return;

      if (key === "z") {
        const entry = undoStackRef.current.pop();
        if (!entry) return;
        e.preventDefault();
        const existingNodeIds = new Set(nodes.map((n) => n.id));
        const restoredNodes = entry.nodes.filter((fn) => !existingNodeIds.has(fn.id));
        const allNodeIds = new Set([...existingNodeIds, ...restoredNodes.map((fn) => fn.id)]);
        const existingEdgeIds = new Set(edges.map((ed) => ed.id));
        const restoredEdges = entry.edges.filter(
          (ed) => !existingEdgeIds.has(ed.id) && allNodeIds.has(ed.source) && allNodeIds.has(ed.target)
        );
        if (!restoredNodes.length && !restoredEdges.length) return;
        if (restoredNodes.length) {
          setNodes((prev) => [...prev, ...restoredNodes.map((fn) => toStudioNode(fn, "idle", collections))]);
        }
        if (restoredEdges.length) {
          setEdges((prev) => [...prev, ...restoredEdges.map((ed) => ({ id: ed.id, source: ed.source, target: ed.target }))]);
        }
        showToast(
          restoredNodes.length
            ? `Restored ${restoredNodes.length} block${restoredNodes.length === 1 ? "" : "s"}`
            : "Restored connection",
          { type: "success" }
        );
        return;
      }

      if (key === "c") {
        const selected = nodes.filter((n) => n.selected);
        if (!selected.length) return;
        const ids = new Set(selected.map((n) => n.id));
        clipboardRef.current = {
          nodes: serializeNodes(selected),
          edges: serializeEdges(edges.filter((ed) => ids.has(ed.source) && ids.has(ed.target))),
        };
        pasteCountRef.current = 0;
        showToast(`Copied ${selected.length} block${selected.length === 1 ? "" : "s"}`, { type: "success" });
        return;
      }

      const clip = clipboardRef.current;
      if (!clip?.nodes.length || !selectedFlow) return;
      e.preventDefault();

      pasteCountRef.current += 1;
      const offset = 40 * pasteCountRef.current;
      const taken = new Set(nodes.map((n) => n.data.flowNode.name));
      const renames = new Map<string, string>();
      const idMap = new Map<string, string>();
      for (const fn of clip.nodes) {
        const newName = uniqueCopyName(fn.name, taken);
        taken.add(newName);
        renames.set(fn.name, newName);
        idMap.set(fn.id, crypto.randomUUID());
      }
      const pasted: FlowNode[] = clip.nodes.map((fn) => {
        const copy: FlowNode = {
          ...(JSON.parse(JSON.stringify(fn)) as FlowNode),
          id: idMap.get(fn.id)!,
          name: renames.get(fn.name)!,
          position: { x: fn.position.x + offset, y: fn.position.y + offset },
        };
        copy.config = renameNodeConfig(copy, renames);
        return copy;
      });

      setNodes((prev) => [
        ...prev.map((n) => ({ ...n, selected: false })),
        ...pasted.map((fn) => ({ ...toStudioNode(fn, "idle", collections), selected: true })),
      ]);
      setEdges((prev) => [
        ...prev.map((ed) => ({ ...ed, selected: false })),
        ...clip.edges.map((ed) => ({
          id: crypto.randomUUID(),
          source: idMap.get(ed.source)!,
          target: idMap.get(ed.target)!,
          selected: true,
        })),
      ]);
      setSelectedNodeId(pasted.length === 1 ? pasted[0].id : null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nodes, edges, selectedFlow, showNewFlowModal, showRenameModal, collections, setNodes, setEdges, dirty, isSaving]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- validation ----

  const validationError = useMemo((): string | null => {
    const flowNodes = serializeNodes(nodes);
    const flowEdges = serializeEdges(edges);
    for (const n of flowNodes) {
      const nameError = validateNodeName(n.name, flowNodes, n.id);
      if (nameError) return `Node "${n.name || "(unnamed)"}": ${nameError}`;
      const cfg = requestNodeConfigOf(n);
      if (cfg && !cfg.requestId) return `Node "${n.name}": no request selected`;
      if (cfg && !lookupRequest(collections, cfg.requestId)) return `Node "${n.name}": linked request not found`;
    }
    const sorted = topoSort(flowNodes, flowEdges);
    if ("cycle" in sorted) return `Flow contains a cycle involving: ${sorted.cycle.join(", ")}`;
    // Dangling references: mapping/comparison references must point at upstream node names (or item in loopers).
    const nodeById = new Map(flowNodes.map((n) => [n.id, n]));
    for (const n of flowNodes) {
      const upstreamNames = new Set(
        Array.from(ancestorNodeIds(n.id, flowEdges)).map((id) => nodeById.get(id)?.name).filter(Boolean)
      );
      const checkRef = (ref: string, allowItem: boolean, what: string): string | null => {
        const head = ref.split(".")[0]?.trim();
        if (!head) return `Node "${n.name}": empty reference for ${what}`;
        if (head === "item") return allowItem ? null : `Node "${n.name}": "item" is only available inside a looper`;
        if (!upstreamNames.has(head)) return `Node "${n.name}": reference "${ref}" does not match any upstream node`;
        return null;
      };
      const cfg = requestNodeConfigOf(n);
      if (cfg) {
        const allowItem = n.type === "looper";
        for (const m of cfg.mappings || []) {
          if (m.source === "reference") {
            const err = checkRef(m.value, allowItem, `input "${m.inputName}"`);
            if (err) return err;
          }
        }
      }
      if (n.type === "looper") {
        const lc = n.config as LooperNodeConfig;
        if (lc.itemsSource === "reference") {
          const err = checkRef(lc.itemsValue, false, "looper items");
          if (err) return err;
        }
      }
      if (n.type === "verifier") {
        const vc = n.config as VerifierNodeConfig;
        for (const c of vc.comparisons || []) {
          if (c.expectedSource === "reference") {
            const err = checkRef(c.expected, false, `comparison on "${c.field}"`);
            if (err) return err;
          }
        }
      }
    }
    return null;
  }, [nodes, edges, collections]);

  // Non-blocking: {{env.X}} vars referenced by linked requests but absent from
  // the active environment. Not an error — a parser script earlier in the flow
  // may env.set() them at runtime — but the most common cause is running with
  // the wrong environment selected.
  const envWarning = useMemo((): string | null => {
    const activeEnv = environments.find((e) => e.id === selectedEnvId);
    const defined = new Set((activeEnv?.variables || []).map((v) => v.key));
    const missing = new Set<string>();
    for (const n of nodes) {
      const cfg = requestNodeConfigOf(n.data.flowNode);
      if (!cfg?.requestId) continue;
      const req = lookupRequest(collections, cfg.requestId);
      if (!req) continue;
      const referenced = scanEnvNames({
        url: req.url,
        headers: req.headers || [],
        queryParams: req.queryParams || [],
        body: req.body || "",
        authType: req.authType,
        authConfig: req.authConfig || {},
      });
      for (const name of referenced) {
        if (!defined.has(name)) missing.add(name);
      }
    }
    if (!missing.size) return null;
    const list = Array.from(missing).join(", ");
    return activeEnv
      ? `Env vars not defined in "${activeEnv.name}": ${list}`
      : `No active environment — {{env.*}} vars unresolved: ${list}`;
  }, [nodes, collections, environments, selectedEnvId]);

  // Retry is offered after a failed or cancelled run; whether it can actually
  // start is a separate check so the button can explain why it's disabled.
  const retryable =
    !isRunning && !!lastSummary && (lastSummary.status === "failed" || lastSummary.status === "cancelled");

  const retryBlockedReason = useMemo((): string | null => {
    if (!lastSummary) return null;
    // contextTruncated blobs also lack context — check the flag first for the
    // more specific message. A legitimately empty context is {} (truthy).
    if (lastSummary.contextTruncated) return "Run data was truncated when saved — run the full flow again";
    if (!lastSummary.context || !lastSummary.nodeStatuses || !lastSummary.runSignature)
      return "This run was saved before Retry existed — run the flow again";
    if (lastSummary.runSignature !== structuralSignature(serializeNodes(nodes), serializeEdges(edges)))
      return "Flow changed since the last run";
    if (validationError) return validationError;
    return null;
  }, [lastSummary, nodes, edges, validationError]);

  // Memoized so the assistant panel's per-render proposal re-validation only
  // recomputes when the canvas or collections actually change.
  const assistantCanvas = useMemo(
    () => ({ nodes: serializeNodes(nodes), edges: serializeEdges(edges) }),
    [nodes, edges]
  );
  const assistantCatalog = useMemo(() => buildCatalog(collections).rows, [collections]);

  // ---- toolbar actions ----

  const onSave = async () => {
    if (!selectedFlow) return;
    setIsSaving(true);
    try {
      const flowNodes = serializeNodes(nodes);
      const flowEdges = serializeEdges(edges);
      await updateFlow(selectedFlow.id, { nodes: flowNodes, edges: flowEdges });
      setSavedSignature(flowSignature(flowNodes, flowEdges));
      showToast(
        validationError ? `Saved (warning: ${validationError})` : "Flow saved",
        { type: validationError ? "info" : "success" }
      );
    } catch (e: any) {
      showToast(`Save failed: ${e.message}`, { type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    onSaveRef.current = onSave;
  });

  const onRun = async () => {
    if (!selectedFlow || isRunning) return;
    if (validationError) {
      showToast(`Cannot run: ${validationError}`, { type: "error" });
      return;
    }
    const flow: Flow = {
      ...selectedFlow,
      nodes: serializeNodes(nodes),
      edges: serializeEdges(edges),
    };
    setIsRunning(true);
    resetStatuses();
    setRecords([]);
    setLastSummary(null);

    const handle = runFlow(
      flow,
      { apiCall, collections, environmentId: selectedEnvId || null },
      {
        onNodeStatus: setNodeStatus,
        onRecord: (record) => setRecords((prev) => [...prev, record]),
      }
    );
    runHandleRef.current = handle;
    try {
      const summary = await handle.done;
      setLastSummary(summary);
      persistLastRun(flow.id, summary);
      showToast(
        summary.status === "success"
          ? `Run finished — ${summary.records.length} steps in ${summary.durationMs} ms`
          : summary.status === "cancelled"
            ? "Run cancelled"
            : "Run failed — see node statuses",
        { type: summary.status === "success" ? "success" : summary.status === "cancelled" ? "info" : "error" }
      );
    } catch (e: any) {
      showToast(`Run error: ${e.message}`, { type: "error" });
    } finally {
      setIsRunning(false);
      runHandleRef.current = null;
    }
  };

  const onStop = () => runHandleRef.current?.cancel();

  // Re-run only the failed/skipped nodes of the last run, reusing successful
  // nodes' outputs, then persist one merged summary for the whole flow.
  const onRetry = async () => {
    if (!selectedFlow || !retryable) return;
    if (retryBlockedReason) {
      showToast(`Cannot retry: ${retryBlockedReason}`, { type: "error" });
      return;
    }
    const prior = lastSummary!;
    const completedNodeIds = Object.entries(prior.nodeStatuses!)
      .filter(([, status]) => status === "success")
      .map(([nodeId]) => nodeId);
    const completedSet = new Set(completedNodeIds);
    const flow: Flow = {
      ...selectedFlow,
      nodes: serializeNodes(nodes),
      edges: serializeEdges(edges),
    };
    setIsRunning(true);
    // No resetStatuses(): the runner immediately re-emits "success" for
    // completed nodes and "pending" for everything that will re-run. Seed the
    // record list with the retained prior records so the inspector and Report
    // show the merged view while the retry is in flight.
    setRecords(prior.records.filter((r) => completedSet.has(r.nodeId)));

    const handle = runFlow(
      flow,
      { apiCall, collections, environmentId: selectedEnvId || null },
      {
        onNodeStatus: setNodeStatus,
        onRecord: (record) => setRecords((prev) => [...prev, record]),
      },
      { context: prior.context!, completedNodeIds }
    );
    runHandleRef.current = handle;
    try {
      const next = await handle.done;
      const merged = mergeRetrySummary(prior, next);
      setLastSummary(merged);
      persistLastRun(flow.id, merged);
      showToast(
        next.status === "success"
          ? `Retry finished — ${next.records.length} steps re-run in ${next.durationMs} ms`
          : next.status === "cancelled"
            ? "Retry cancelled"
            : "Retry failed — see node statuses",
        { type: next.status === "success" ? "success" : next.status === "cancelled" ? "info" : "error" }
      );
    } catch (e: any) {
      showToast(`Retry error: ${e.message}`, { type: "error" });
    } finally {
      setIsRunning(false);
      runHandleRef.current = null;
    }
  };

  const onDownloadReport = () => {
    if (!records.length || !selectedFlow) return;
    downloadCsv(buildRunCsv(records), runCsvFilename(selectedFlow.name));
  };

  // ---- AI assistant handlers ----

  // Backend also 400s when unconfigured — this is just the friendlier path.
  const ensureLlmConfigured = (): boolean => {
    if (llmSettings?.activeProvider && llmSettings.hasKey) return true;
    showToast("No AI provider configured — add an API key in Settings (Configuration → Settings).", { type: "error" });
    return false;
  };

  const updateChat = (key: string, entries: ChatEntry[]) => {
    setChatEntries(entries);
    persistChat(key, entries);
  };

  // Core send. `entries` must already end with the newest user turn; the
  // request catalog and live canvas ride along as context on every call
  // (stateless backend).
  const sendAssistantTranscript = async (entries: ChatEntry[]) => {
    const keyAtSend = chatKeyRef.current;
    setAssistantBusy(true);
    setAssistantError(null);
    try {
      const catalog = buildCatalog(collections);
      const context = {
        catalog: toWireCatalog(catalog.rows),
        catalogTruncated: catalog.truncated,
        canvas: buildCanvasContext(
          selectedFlow?.name || "(no flow yet)",
          serializeNodes(nodes),
          serializeEdges(edges),
          collections
        ),
      };
      const res = await apiCall("/api/ai/studio-assistant", {
        method: "POST",
        body: JSON.stringify({
          messages: entries.slice(-16).map(({ role, content }) => ({ role, content })),
          context,
        }),
      });
      if (keyAtSend !== chatKeyRef.current) return; // flow switched mid-flight — drop the reply
      const proposal: Proposal = {
        message: typeof res?.message === "string" ? res.message : "",
        actions: Array.isArray(res?.actions) ? res.actions : [],
        parseError: !!res?.parseError,
      };
      const assistantEntry: ChatEntry = {
        role: "assistant",
        // Raw JSON string — the model sees its own prior proposals verbatim.
        content: JSON.stringify({ message: proposal.message, actions: proposal.actions }),
        proposal,
        proposalState: proposal.actions.length ? "pending" : undefined,
      };
      updateChat(keyAtSend, [...entries, assistantEntry]);
    } catch (e: any) {
      if (keyAtSend === chatKeyRef.current) setAssistantError(e.message || "Assistant request failed");
    } finally {
      setAssistantBusy(false);
    }
  };

  const onAssistantSend = (text: string) => {
    if (assistantBusy || !ensureLlmConfigured()) return;
    const next: ChatEntry[] = [...chatEntries, { role: "user", content: text }];
    updateChat(chatKeyRef.current, next);
    void sendAssistantTranscript(next);
  };

  // The failed turn's user message is already in the transcript — resend as-is.
  const onAssistantRetry = () => {
    if (assistantBusy || !ensureLlmConfigured()) return;
    if (!chatEntries.length || chatEntries[chatEntries.length - 1].role !== "user") return;
    void sendAssistantTranscript(chatEntries);
  };

  const onDismissProposal = (index: number) => {
    updateChat(
      chatKeyRef.current,
      chatEntries.map((e, i) => (i === index ? { ...e, proposalState: "dismissed" as const } : e))
    );
  };

  const onApplyProposal = async (index: number) => {
    const entry = chatEntries[index];
    const proposal = entry?.proposal;
    if (!proposal || entry.proposalState !== "pending" || isRunning || assistantBusy) return;
    // Re-validate at click time — the canvas may have changed since the
    // proposal was made. Atomic: any error applies nothing.
    const plan = validateAndPlan(
      proposal.actions,
      { nodes: serializeNodes(nodes), edges: serializeEdges(edges) },
      buildCatalog(collections).rows
    );
    if (!plan.ok || !plan.result) {
      showToast("This proposal can't be applied — see the errors on its card.", { type: "error" });
      return;
    }
    const appliedCount = plan.steps.length;
    const updated: ChatEntry[] = [
      ...chatEntries.map((e, i) => (i === index ? { ...e, proposalState: "applied" as const } : e)),
      { role: "user", content: `[Applied all ${appliedCount} proposed actions to the canvas.]`, synthetic: true },
    ];

    if (plan.createFlowName) {
      if (dirty) {
        const ok = await confirmDialog("You have unsaved changes on this flow. Discard them and create the new flow?");
        if (!ok) return;
      }
      let created: Flow;
      try {
        created = await createFlow(plan.createFlowName);
      } catch (e: any) {
        showToast(e.message, { type: "error" });
        return;
      }
      // Move the transcript (with its applied marker) onto the new flow BEFORE
      // selecting it, so the chatKey effect reloads the right history.
      persistChat(created.id, updated);
      clearChat(chatKeyRef.current);
      setSelectedFlowId(created.id);
      loadFlow(created);
    } else {
      updateChat(chatKeyRef.current, updated);
    }
    // The canvas becomes dirty/unsaved deliberately — the user reviews the
    // result, then Saves and Runs themself.
    setNodes(plan.result.nodes.map((fn) => toStudioNode(fn, "idle", collections)));
    setEdges(plan.result.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
    showToast(`Applied ${appliedCount} actions — review the canvas, then Save`, { type: "success" });
  };

  const onCreateFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flowNameDraft.trim()) return;
    try {
      const flow = await createFlow(flowNameDraft.trim());
      setShowNewFlowModal(false);
      setFlowNameDraft("");
      setSelectedFlowId(flow.id);
      loadFlow(flow);
      showToast("Flow created", { type: "success" });
    } catch (err: any) {
      showToast(err.message, { type: "error" });
    }
  };

  const onRenameFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFlow || !flowNameDraft.trim()) return;
    try {
      await updateFlow(selectedFlow.id, { name: flowNameDraft.trim() });
      setShowRenameModal(false);
      showToast("Flow renamed", { type: "success" });
    } catch (err: any) {
      showToast(err.message, { type: "error" });
    }
  };

  const onDeleteFlow = async () => {
    if (!selectedFlow) return;
    const ok = await confirmDialog(`Delete flow "${selectedFlow.name}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await deleteFlow(selectedFlow.id);
      setSelectedFlowId("");
      showToast("Flow deleted", { type: "success" });
    } catch (err: any) {
      showToast(err.message, { type: "error" });
    }
  };

  const onDuplicateFlow = async () => {
    if (!selectedFlow) return;
    try {
      // Clone the live canvas state (including unsaved edits), not the
      // last-persisted selectedFlow.nodes/edges.
      const flowNodes = serializeNodes(nodes);
      const flowEdges = serializeEdges(edges);
      const newName = generateDuplicateName(selectedFlow.name, flows.map((f) => f.name));

      const created = await createFlow(newName);
      // Pass `created` as baseFlow — `flows` state doesn't contain `created`
      // yet at this point (see updateFlow's baseFlow param).
      await updateFlow(created.id, { description: selectedFlow.description, nodes: flowNodes, edges: flowEdges }, created);

      setSelectedFlowId(created.id);
      loadFlow({ ...created, description: selectedFlow.description, nodes: flowNodes, edges: flowEdges });
      showToast("Flow duplicated", { type: "success" });
    } catch (err: any) {
      showToast(err.message, { type: "error" });
    }
  };

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;
  const selectedNodeRecords = useMemo(
    () => (selectedNode ? records.filter((r) => r.nodeId === selectedNode.id) : []),
    [records, selectedNode]
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="h-14 px-4 border-b border-line bg-cream flex items-center gap-2 flex-shrink-0">
        <Dropdown
          value={selectedFlowId}
          onChange={switchFlow}
          placeholder={flows.length ? "Select flow…" : "No flows yet"}
          widthClass="w-[240px]"
          options={flows.map((f) => ({ value: f.id, label: f.name }))}
        />
        {dirty && <span className="h-2 w-2 rounded-full bg-clay flex-shrink-0" title="Unsaved changes" />}
        <button
          onClick={() => { setFlowNameDraft(""); setShowNewFlowModal(true); }}
          className="h-8 px-2.5 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>
        {selectedFlow && (
          <>
            <button
              onClick={() => { setFlowNameDraft(selectedFlow.name); setShowRenameModal(true); }}
              title="Rename flow"
              className="h-8 w-8 flex items-center justify-center bg-cream border border-line rounded-md text-graphite hover:bg-panel transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDuplicateFlow}
              title="Duplicate flow"
              className="h-8 w-8 flex items-center justify-center bg-cream border border-line rounded-md text-graphite hover:bg-panel transition-colors"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDeleteFlow}
              title="Delete flow"
              className="h-8 w-8 flex items-center justify-center bg-cream border border-line rounded-md text-stone hover:bg-danger-soft hover:text-danger transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        <div className="flex-1" />

        {validationError ? (
          <span className="flex items-center gap-1.5 text-[11px] text-amber-700 max-w-[320px] truncate" title={validationError}>
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" /> {validationError}
          </span>
        ) : envWarning ? (
          <span className="flex items-center gap-1.5 text-[11px] text-amber-700 max-w-[320px] truncate" title={`${envWarning} — they may still be set at runtime via env.set()`}>
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" /> {envWarning}
          </span>
        ) : null}
        <button
          onClick={() => {
            setSelectedNodeId(null);
            setAssistantOpen((v) => !v);
          }}
          title="AI assistant — build this flow by chatting"
          className={`h-8 px-3 flex items-center gap-1.5 border rounded-md text-xs font-medium transition-colors ${
            assistantOpen
              ? "bg-clay/10 border-clay text-clay"
              : "bg-cream border-line text-graphite hover:bg-panel"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" /> Assistant
        </button>
        <button
          onClick={onDownloadReport}
          disabled={!records.length}
          className="h-8 px-3 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> Report
        </button>
        <button
          onClick={onSave}
          disabled={!selectedFlow || !dirty || isSaving}
          className="h-8 px-3 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" /> {isSaving ? "Saving…" : "Save"}
        </button>
        {retryable && (
          <button
            onClick={onRetry}
            disabled={!!retryBlockedReason}
            title={retryBlockedReason || "Re-run only the failed and skipped nodes, reusing successful outputs"}
            className="h-8 px-3 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Retry
          </button>
        )}
        {isRunning ? (
          <button
            onClick={onStop}
            className="h-8 px-4 flex items-center gap-1.5 bg-red-600 hover:bg-red-700 rounded-md text-xs font-medium text-white transition-colors"
          >
            <Square className="h-3.5 w-3.5" /> Stop
          </button>
        ) : (
          <button
            onClick={onRun}
            disabled={!selectedFlow || !nodes.length || !!validationError}
            className="h-8 px-4 flex items-center gap-1.5 bg-clay hover:bg-clay-dark rounded-md text-xs font-medium text-white transition-colors disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" /> Run
          </button>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Palette */}
        <div className="w-[220px] flex-shrink-0 bg-panel border-r border-line p-3 flex flex-col gap-2 overflow-y-auto">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-stone px-1">Building blocks</span>
          {PALETTE.map((item) => (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-studio-node", item.type);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDoubleClick={() => addNode(item.type, { x: 120 + Math.random() * 120, y: 120 + Math.random() * 120 })}
              className="p-3 bg-cream border border-line rounded-lg cursor-grab hover:border-clay transition-colors"
              title="Drag onto the canvas (or double-click)"
            >
              <div className="flex items-center gap-2">
                <item.icon className="h-4 w-4 text-clay" />
                <span className="text-xs font-medium text-ink">{item.label}</span>
              </div>
              <p className="m-0 mt-1 text-[11px] text-mute leading-snug">{item.hint}</p>
            </div>
          ))}
          <p className="text-[11px] text-mute px-1 mt-2 leading-relaxed">
            Connect nodes to define execution order. A node can reference any upstream node&apos;s outputs as{" "}
            <code className="font-mono">nodeName.output</code>. Use a <code className="font-mono">*</code> segment
            to flatten arrays, e.g. <code className="font-mono">loop.results.*.uuid</code>.
          </p>
        </div>

        {/* Canvas */}
        {selectedFlow ? (
          <div
            className="flex-1 min-w-0 min-h-0 relative"
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={studioNodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              deleteKeyCode={["Backspace", "Delete"]}
              onDelete={({ nodes: deletedNodes, edges: deletedEdges }) =>
                pushUndo(serializeNodes(deletedNodes as StudioNode[]), serializeEdges(deletedEdges))
              }
              panOnDrag={[1, 2]}
              selectionOnDrag
              selectionMode={SelectionMode.Partial}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
            {!nodes.length && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-sm text-mute">Drag a building block from the left to start this flow.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-mute">
            {flows.length ? "Select a flow to edit." : "Create your first flow with the New button."}
          </div>
        )}

        {/* Inspector */}
        {selectedFlow && selectedNode && (
          <NodeInspector
            key={selectedNode.id}
            node={selectedNode}
            allNodes={nodes}
            edges={edges}
            collections={collections}
            records={selectedNodeRecords}
            onChange={(patch) => updateFlowNode(selectedNode.id, patch)}
            onClose={() => setSelectedNodeId(null)}
            onDelete={() => {
              pushUndo(
                serializeNodes([selectedNode]),
                serializeEdges(edges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id))
              );
              setNodes((prev) => prev.filter((n) => n.id !== selectedNode.id));
              setEdges((prev) => prev.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
              setSelectedNodeId(null);
            }}
          />
        )}

        {/* AI assistant — shares the right-panel slot with the inspector; the
            inspector wins while a node is selected. */}
        {assistantOpen && !(selectedFlow && selectedNode) && (
          <AssistantPanel
            entries={chatEntries}
            busy={assistantBusy}
            error={assistantError}
            canvas={assistantCanvas}
            catalog={assistantCatalog}
            onSend={onAssistantSend}
            onRetrySend={onAssistantRetry}
            onApply={(i) => void onApplyProposal(i)}
            onDismiss={onDismissProposal}
            onClear={() => {
              clearChat(chatKeyRef.current);
              setChatEntries([]);
            }}
            onClose={() => setAssistantOpen(false)}
          />
        )}
      </div>

      {/* Modals */}
      {showNewFlowModal && (
        <Modal title="New flow" onClose={() => setShowNewFlowModal(false)}>
          <form onSubmit={onCreateFlow} className="flex flex-col gap-4">
            <input
              autoFocus
              value={flowNameDraft}
              onChange={(e) => setFlowNameDraft(e.target.value)}
              placeholder="Flow name"
              className="h-[38px] bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay"
            />
            <ModalFooter onCancel={() => setShowNewFlowModal(false)} submitLabel="Create" />
          </form>
        </Modal>
      )}
      {showRenameModal && (
        <Modal title="Rename flow" onClose={() => setShowRenameModal(false)}>
          <form onSubmit={onRenameFlow} className="flex flex-col gap-4">
            <input
              autoFocus
              value={flowNameDraft}
              onChange={(e) => setFlowNameDraft(e.target.value)}
              className="h-[38px] bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay"
            />
            <ModalFooter onCancel={() => setShowRenameModal(false)} submitLabel="Rename" />
          </form>
        </Modal>
      )}
    </div>
  );
}

// ---- inspector ----------------------------------------------------------------

function NodeInspector({
  node,
  allNodes,
  edges,
  collections,
  records,
  onChange,
  onClose,
  onDelete,
}: {
  node: StudioNode;
  allNodes: StudioNode[];
  edges: Edge[];
  collections: Collection[];
  records: RunRecord[];
  onChange: (patch: Partial<FlowNode>) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const fn = node.data.flowNode;
  const flowNodes = allNodes.map((n) => n.data.flowNode);
  const nameError = validateNodeName(fn.name, flowNodes, fn.id);
  const [detailRecord, setDetailRecord] = useState<RunRecord | null>(null);

  // Reference options: only edge-ancestors' published outputs.
  const referenceOptions = useMemo(() => {
    const ancestors = ancestorNodeIds(node.id, edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
    const options: string[] = [];
    for (const n of allNodes) {
      if (!ancestors.has(n.id)) continue;
      for (const out of publishedOutputs(n.data.flowNode, collections)) {
        options.push(`${n.data.flowNode.name}.${out}`);
      }
    }
    return options;
  }, [node.id, allNodes, edges, collections]);

  const updateConfig = (config: FlowNode["config"]) => onChange({ config });

  return (
    <div className="w-[380px] flex-shrink-0 bg-panel border-l border-line flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between flex-shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-stone">
          {fn.type} node
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onDelete}
            title="Delete node"
            className="h-7 w-7 rounded-md border border-line flex items-center justify-center text-stone hover:bg-danger-soft hover:text-danger transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-md border border-line flex items-center justify-center text-graphite hover:bg-hover transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-stone">Name (identifier — namespaces this node&apos;s outputs)</label>
          <input
            value={fn.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className={`${inputCls} ${nameError ? "!border-red-400" : ""}`}
          />
          {nameError && <span className="text-[11px] text-red-600">{nameError}</span>}
        </div>

        {fn.type === "delay" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone">Delay (ms)</label>
            <input
              type="number"
              min={0}
              value={(fn.config as DelayNodeConfig).ms}
              onChange={(e) => updateConfig({ ms: Math.max(0, parseInt(e.target.value, 10) || 0) })}
              className={inputCls}
            />
          </div>
        )}

        {fn.type === "request" && (
          <RequestConfigEditor
            cfg={fn.config as RequestNodeConfig}
            onChange={updateConfig}
            collections={collections}
            referenceOptions={referenceOptions}
            allowItem={false}
          />
        )}

        {fn.type === "looper" && (() => {
          const cfg = fn.config as LooperNodeConfig;
          return (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-stone">Items (array to iterate)</label>
                <Dropdown
                  value={cfg.itemsSource}
                  onChange={(v) => updateConfig({ ...cfg, itemsSource: v as "reference" | "static", itemsValue: v === "static" ? "[]" : "" })}
                  widthClass="w-full"
                  options={[
                    { value: "static", label: "Static JSON array" },
                    { value: "reference", label: "Reference an upstream output" },
                  ]}
                />
                {cfg.itemsSource === "reference" ? (
                  <ReferenceInput
                    value={cfg.itemsValue}
                    onChange={(v) => updateConfig({ ...cfg, itemsValue: v })}
                    options={referenceOptions}
                    placeholder="nodeName.output (must be an array)"
                  />
                ) : (
                  <div className="h-[140px] rounded-lg overflow-hidden border border-line">
                    <Editor
                      height="100%"
                      language="json"
                      theme="vs-dark"
                      value={cfg.itemsValue}
                      onChange={(val) => updateConfig({ ...cfg, itemsValue: val || "[]" })}
                      options={{ minimap: { enabled: false }, fontSize: 12, lineNumbers: "off", scrollbar: { vertical: "auto", horizontal: "hidden" } }}
                    />
                  </div>
                )}
                <span className="text-[11px] text-mute">
                  The inner request runs once per item; reference the current item as{" "}
                  <code className="font-mono">item</code> or <code className="font-mono">item.field</code>.
                </span>
              </div>
              <RequestConfigEditor
                cfg={cfg.request}
                onChange={(request) => updateConfig({ ...cfg, request: request as RequestNodeConfig })}
                collections={collections}
                referenceOptions={referenceOptions}
                allowItem
              />
            </>
          );
        })()}

        {fn.type === "verifier" && (() => {
          const cfg = fn.config as VerifierNodeConfig;
          return (
            <>
              <RequestConfigEditor
                cfg={cfg.request}
                onChange={(request) => updateConfig({ ...cfg, request: request as RequestNodeConfig })}
                collections={collections}
                referenceOptions={referenceOptions}
                allowItem={false}
              />
              <ComparisonEditor
                comparisons={cfg.comparisons}
                onChange={(comparisons) => updateConfig({ ...cfg, comparisons })}
                referenceOptions={referenceOptions}
              />
              <div className="flex gap-2">
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-xs font-medium text-stone">Max attempts</label>
                  <input
                    type="number"
                    min={1}
                    value={cfg.maxAttempts}
                    onChange={(e) => updateConfig({ ...cfg, maxAttempts: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className={inputCls}
                  />
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-xs font-medium text-stone">Retry interval (ms)</label>
                  <input
                    type="number"
                    min={0}
                    value={cfg.intervalMs}
                    onChange={(e) => updateConfig({ ...cfg, intervalMs: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    className={inputCls}
                  />
                </div>
              </div>
            </>
          );
        })()}

        {/* Last run records for this node */}
        {records.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-3 border-t border-line">
            <label className="text-xs font-medium text-stone">Last run</label>
            {records.map((r, i) => (
              <div key={i} className={`px-3 py-2 rounded-lg border text-[11px] ${r.status === "success" ? "bg-cream border-line" : r.status === "failed" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">
                    {r.status}
                    {r.iteration !== undefined ? ` · iteration ${r.iteration}` : ""}
                    {r.attempt !== undefined ? ` · attempt ${r.attempt}` : ""}
                  </span>
                  <span className="ml-auto text-mute">{r.durationMs} ms</span>
                  {(r.requestPayload || r.response) && (
                    <button
                      onClick={() => setDetailRecord(r)}
                      title="View the exact request and response"
                      className="font-medium text-clay hover:text-clay-dark transition-colors"
                    >
                      Details
                    </button>
                  )}
                </div>
                {r.error && <p className="m-0 mt-1 text-red-700 break-words">{r.error}</p>}
                {r.outputs && Object.keys(r.outputs).length > 0 && (
                  <pre className="m-0 mt-1 font-mono text-[10px] text-graphite whitespace-pre-wrap break-all">
                    {JSON.stringify(r.outputs, null, 1)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {detailRecord && (
        <RunRecordDetailModal record={detailRecord} onClose={() => setDetailRecord(null)} />
      )}
    </div>
  );
}

// ---- run record detail modal -------------------------------------------------

const prettyJson = (value: any): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const preCls =
  "m-0 p-3 rounded-lg bg-ink-900 text-[#e8e6e1] font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all overflow-y-auto max-h-[280px]";

function RunRecordDetailModal({ record, onClose }: { record: RunRecord; onClose: () => void }) {
  const req = record.requestPayload;
  const res = record.response;
  const meta = [
    record.nodeName,
    record.iteration !== undefined ? `iteration ${record.iteration}` : null,
    record.attempt !== undefined ? `attempt ${record.attempt}` : null,
    record.status,
    `${record.durationMs} ms`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Modal title="Request & response" onClose={onClose} width={720}>
      <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto -mr-3 pr-3">
        <span className="text-xs text-stone">{meta}</span>

        {record.error && (
          <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-700 break-words">
            {record.error}
          </div>
        )}

        {Object.keys(record.resolvedInputs || {}).length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone">Resolved inputs</label>
            <pre className={preCls}>{prettyJson(record.resolvedInputs)}</pre>
          </div>
        )}

        {req ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone">Request (exact executor payload)</label>
            <span className="font-mono text-[11px] text-graphite break-all">
              {req.method} {req.url}
            </span>
            <pre className={preCls}>{prettyJson(req)}</pre>
          </div>
        ) : (
          <span className="text-[11px] text-mute">No request was sent — the node failed before executing.</span>
        )}

        {res && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone">
              Response — {res.status} {res.statusText || ""}
            </label>
            {Object.keys(res.headers || {}).length > 0 && (
              <details>
                <summary className="text-[11px] text-mute cursor-pointer select-none">Headers</summary>
                <pre className={`${preCls} mt-1.5`}>{prettyJson(res.headers)}</pre>
              </details>
            )}
            <pre className={preCls}>{prettyJson(res.body)}</pre>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---- config sub-editors ----------------------------------------------------

// Text input with a styled suggestion popup. Replaces the native <datalist>,
// whose popup the Tauri webview renders with unreadable (white-on-white) text.
function ReferenceInput({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [value, options]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setCoords({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (inputRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const commit = (opt: string) => {
    onChange(opt);
    setOpen(false);
    setActiveIdx(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" && filtered.length) {
        e.preventDefault();
        setOpen(true);
        setActiveIdx(0);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        if (activeIdx >= 0 && filtered[activeIdx]) {
          e.preventDefault();
          commit(filtered[activeIdx]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIdx(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder || "nodeName.output"}
        className={`${inputCls} w-full`}
      />
      {open && coords && filtered.length > 0 &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, minWidth: coords.width }}
            className="z-[100] max-h-56 overflow-y-auto rounded-lg border border-line bg-cream py-1 shadow-lg shadow-ink/5 animate-[fadeUp_0.12s_ease-out]"
          >
            {filtered.map((opt, idx) => (
              <div
                key={opt}
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(opt)}
                className={`mx-1 px-2.5 py-1.5 rounded-md font-mono text-[11px] cursor-pointer transition-colors ${
                  idx === activeIdx ? "bg-hover" : ""
                } ${opt === value ? "text-clay font-medium" : "text-ink"}`}
              >
                {opt}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

function RequestConfigEditor({
  cfg,
  onChange,
  collections,
  referenceOptions,
  allowItem,
}: {
  cfg: RequestNodeConfig;
  onChange: (cfg: RequestNodeConfig) => void;
  collections: Collection[];
  referenceOptions: string[];
  allowItem: boolean;
}) {
  const inputNames = useMemo(
    () => (cfg.requestId ? requestInputNames(collections, cfg.requestId) : []),
    [collections, cfg.requestId]
  );
  const refOptions = allowItem ? ["item", ...referenceOptions] : referenceOptions;

  const setMapping = (inputName: string, patch: Partial<FlowInputMapping>) => {
    const mappings = [...(cfg.mappings || [])];
    const idx = mappings.findIndex((m) => m.inputName === inputName);
    if (idx === -1) {
      mappings.push({ inputName, source: "static", value: "", ...patch });
    } else {
      mappings[idx] = { ...mappings[idx], ...patch };
    }
    onChange({ ...cfg, mappings });
  };

  const clearMapping = (inputName: string) => {
    onChange({ ...cfg, mappings: (cfg.mappings || []).filter((m) => m.inputName !== inputName) });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-stone">Request</label>
        <RequestPicker
          value={cfg.requestId}
          onChange={(v) => onChange({ ...cfg, requestId: v, mappings: [] })}
          collections={collections}
          placeholder="Select a request…"
        />
      </div>

      {cfg.requestId && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-stone">Input mappings</label>
          {inputNames.length === 0 && (
            <span className="text-[11px] text-mute">This request declares no {"{{inputs}}"}.</span>
          )}
          {inputNames.map((inputName) => {
            const mapping = (cfg.mappings || []).find((m) => m.inputName === inputName);
            return (
              <div key={inputName} className="flex flex-col gap-1 p-2 bg-cream border border-line rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-medium text-clay flex-1 truncate" title={`{{${inputName}}}`}>
                    {inputName}
                  </span>
                  <Dropdown
                    value={mapping ? mapping.source : "default"}
                    onChange={(v) => {
                      if (v === "default") clearMapping(inputName);
                      else setMapping(inputName, { source: v as "static" | "reference", value: "" });
                    }}
                    widthClass="w-[130px]"
                    className="h-[26px] px-2 rounded-md text-[11px] text-ink"
                    options={[
                      { value: "default", label: "Request default" },
                      { value: "static", label: "Static" },
                      { value: "reference", label: "Reference" },
                    ]}
                  />
                </div>
                {mapping?.source === "static" && (
                  <input
                    value={mapping.value}
                    onChange={(e) => setMapping(inputName, { value: e.target.value })}
                    placeholder="Value ({{node.out}}, {{env.X}}, {{$date}} allowed)"
                    className={`${inputCls} w-full`}
                  />
                )}
                {mapping?.source === "reference" && (
                  <ReferenceInput
                    value={mapping.value}
                    onChange={(v) => setMapping(inputName, { value: v })}
                    options={refOptions}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const OPERATOR_OPTIONS: { value: ComparisonOperator; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "exists", label: "exists" },
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
];

function ComparisonEditor({
  comparisons,
  onChange,
  referenceOptions,
}: {
  comparisons: VerifierComparison[];
  onChange: (comparisons: VerifierComparison[]) => void;
  referenceOptions: string[];
}) {
  const update = (idx: number, patch: Partial<VerifierComparison>) => {
    const next = [...comparisons];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-stone">Verifications (all must pass)</label>
      {comparisons.length === 0 && (
        <span className="text-[11px] text-amber-700">Add at least one verification — a verifier with none always fails.</span>
      )}
      {comparisons.map((c, idx) => (
        <div key={idx} className="flex flex-col gap-1 p-2 bg-cream border border-line rounded-lg">
          <div className="flex items-center gap-1.5">
            <input
              value={c.field}
              onChange={(e) => update(idx, { field: e.target.value })}
              placeholder="status | body.path | outputs.name"
              className={`${inputCls} flex-1 min-w-0`}
            />
            <button
              onClick={() => onChange(comparisons.filter((_, i) => i !== idx))}
              className="h-7 w-7 rounded-md border border-line flex items-center justify-center text-stone hover:bg-danger-soft hover:text-danger transition-colors flex-shrink-0"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <Dropdown
              value={c.operator}
              onChange={(v) => update(idx, { operator: v as ComparisonOperator })}
              widthClass="w-[120px]"
              className="h-[26px] px-2 rounded-md text-[11px] text-ink"
              options={OPERATOR_OPTIONS}
            />
            {c.operator !== "exists" && (
              <>
                <Dropdown
                  value={c.expectedSource}
                  onChange={(v) => update(idx, { expectedSource: v as "static" | "reference", expected: "" })}
                  widthClass="w-[100px]"
                  className="h-[26px] px-2 rounded-md text-[11px] text-ink"
                  options={[
                    { value: "static", label: "Static" },
                    { value: "reference", label: "Reference" },
                  ]}
                />
                {c.expectedSource === "reference" ? (
                  <div className="flex-1 min-w-0">
                    <ReferenceInput value={c.expected} onChange={(v) => update(idx, { expected: v })} options={referenceOptions} />
                  </div>
                ) : (
                  <input
                    value={c.expected}
                    onChange={(e) => update(idx, { expected: e.target.value })}
                    placeholder="Expected"
                    className={`${inputCls} flex-1 min-w-0`}
                  />
                )}
              </>
            )}
          </div>
        </div>
      ))}
      <button
        onClick={() => onChange([...comparisons, { field: "", operator: "equals", expectedSource: "static", expected: "" }])}
        className="flex items-center gap-1.5 px-3 py-1.5 w-fit border border-dashed border-line rounded-md text-xs text-mute hover:border-clay hover:text-clay transition-colors"
      >
        <Plus className="h-3.5 w-3.5" /> Add verification
      </button>
    </div>
  );
}
