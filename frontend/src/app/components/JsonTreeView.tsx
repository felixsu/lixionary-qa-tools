"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

// Expandable JSON tree for the dark (ink-900) response panels. Children are
// rendered lazily — only while their parent node is expanded — so large
// payloads stay cheap. Colors per type: keys clay, strings sage, numbers
// blue, booleans purple, null muted.

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="text-mute italic">null</span>;
  switch (typeof value) {
    case "string":
      return <span className="text-sage break-all">&quot;{value}&quot;</span>;
    case "number":
      return <span className="text-[#7cacf8]">{String(value)}</span>;
    case "boolean":
      return <span className="text-[#c792ea]">{String(value)}</span>;
    default:
      return <span className="text-mute break-all">{String(value)}</span>;
  }
}

function isComposite(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

function TreeNode({
  nodeKey,
  value,
  depth,
  defaultExpandDepth,
}: {
  nodeKey: string | null;
  value: unknown;
  depth: number;
  defaultExpandDepth: number;
}) {
  const [expanded, setExpanded] = useState(depth < defaultExpandDepth);

  const keyLabel =
    nodeKey !== null && (
      <>
        <span className="text-clay">{nodeKey}</span>
        <span className="text-stone">: </span>
      </>
    );

  if (!isComposite(value)) {
    return (
      <div className="pl-[18px]">
        {keyLabel}
        <Primitive value={value} />
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value);
  const [openBrace, closeBrace] = isArray ? ["[", "]"] : ["{", "}"];

  if (entries.length === 0) {
    return (
      <div className="pl-[18px]">
        {keyLabel}
        <span className="text-stone">{openBrace}{closeBrace}</span>
      </div>
    );
  }

  const summary = isArray
    ? `${entries.length} item${entries.length === 1 ? "" : "s"}`
    : `${entries.length} key${entries.length === 1 ? "" : "s"}`;

  return (
    <div>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center text-left w-full rounded hover:bg-white/5 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-stone flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-stone flex-shrink-0" />
        )}
        <span className="pl-[3px]">
          {keyLabel}
          <span className="text-stone">{openBrace}</span>
          {!expanded && (
            <>
              <span className="text-mute">… {summary} </span>
              <span className="text-stone">{closeBrace}</span>
            </>
          )}
        </span>
      </button>
      {expanded && (
        <>
          <div className="ml-[6px] pl-2.5 border-l border-white/10">
            {entries.map(([k, v]) => (
              <TreeNode
                key={k}
                nodeKey={k}
                value={v}
                depth={depth + 1}
                defaultExpandDepth={defaultExpandDepth}
              />
            ))}
          </div>
          <span className="pl-[18px] text-stone">{closeBrace}</span>
        </>
      )}
    </div>
  );
}

export default function JsonTreeView({
  data,
  defaultExpandDepth = 2,
}: {
  data: unknown;
  defaultExpandDepth?: number;
}) {
  // Remounting with a new key + depth is the cheapest way to force every
  // node's local expanded state to a chosen level.
  const [treeState, setTreeState] = useState({ bump: 0, depth: defaultExpandDepth });

  return (
    <div className="font-mono text-xs leading-relaxed text-cream/90 select-text">
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => setTreeState((s) => ({ bump: s.bump + 1, depth: Infinity }))}
          className="px-2 py-0.5 rounded border border-white/10 text-[11px] text-cream/60 hover:text-cream hover:bg-white/5 transition-colors"
        >
          Expand all
        </button>
        <button
          onClick={() => setTreeState((s) => ({ bump: s.bump + 1, depth: 0 }))}
          className="px-2 py-0.5 rounded border border-white/10 text-[11px] text-cream/60 hover:text-cream hover:bg-white/5 transition-colors"
        >
          Collapse all
        </button>
      </div>
      <TreeNode
        key={treeState.bump}
        nodeKey={null}
        value={data}
        depth={0}
        defaultExpandDepth={treeState.depth}
      />
    </div>
  );
}
