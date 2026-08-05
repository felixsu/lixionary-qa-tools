"use client";

// API Studio entry: owns flow selection and branches by flow format.
// Flows with schemaVersion 2 open in the ComfyUI-style V2 editor
// (editorV2/); older flows open in the frozen view/run-only legacy editor
// (legacy/). New flows are always created as V2.

import { useEffect, useState } from "react";
import { useAppContext } from "../../context/AppContext";
import { isFlowV2, type FlowV2 } from "../../utils/flowTypesV2";
import LegacyEditor from "./legacy/LegacyEditor";
import EditorV2 from "./editorV2/EditorV2";

// Persisted so leaving the page (or restarting the app) doesn't snap the
// editor back to the first flow.
const SELECTED_FLOW_KEY = "lixionary_selected_flow";

export default function ApiStudioPage() {
  const { flows } = useAppContext();
  const [selectedFlowId, setSelectedFlowId] = useState<string>("");

  // Initial selection + fallback when the selected flow disappears
  // (deletion, sync pull). "" from a child means "pick a default again".
  useEffect(() => {
    if (!flows.length) {
      if (selectedFlowId) setSelectedFlowId("");
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
    }
  }, [flows, selectedFlowId]);

  useEffect(() => {
    if (!selectedFlowId) return;
    try { localStorage.setItem(SELECTED_FLOW_KEY, selectedFlowId); } catch { /* non-fatal */ }
  }, [selectedFlowId]);

  const selectedFlow = flows.find((f) => f.id === selectedFlowId) || null;

  if (selectedFlow && !isFlowV2(selectedFlow)) {
    return <LegacyEditor selectedFlow={selectedFlow} onSelectFlow={setSelectedFlowId} />;
  }
  // V2 flows share the Flow record shape; nodes/edges hold V2 node/edge objects.
  return (
    <EditorV2
      selectedFlow={selectedFlow ? (selectedFlow as unknown as FlowV2) : null}
      onSelectFlow={setSelectedFlowId}
    />
  );
}
