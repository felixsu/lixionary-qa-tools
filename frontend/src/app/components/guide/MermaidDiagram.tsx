"use client";

import React, { useEffect, useId, useState } from "react";

let mermaidInitialized = false;

export default function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const reactId = useId();
  const renderId = `mermaid-${reactId.replace(/[^a-zA-Z0-9-]/g, "")}`;

  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      if (!code.trim()) {
        setSvg("");
        setError("");
        return;
      }
      try {
        const mermaid = (await import("mermaid")).default;
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "neutral",
            securityLevel: "strict",
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
          });
          mermaidInitialized = true;
        }
        const { svg: rendered } = await mermaid.render(renderId, code);
        if (!cancelled) {
          setSvg(rendered);
          setError("");
        }
      } catch (e) {
        // Mermaid can leave an orphan error node in the DOM on parse failure.
        document.getElementById(renderId)?.remove();
        document.querySelector(`#d${renderId}`)?.remove();
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to render diagram");
        }
      }
    };

    render();
    return () => {
      cancelled = true;
    };
  }, [code, renderId]);

  if (!code.trim()) {
    return <p className="text-xs text-mute italic">Empty mermaid block</p>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2">
        <p className="text-xs font-medium text-danger">Mermaid syntax error</p>
        <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-danger/80">{error}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="flex items-center justify-center py-6">
        <div
          className="h-5 w-5 rounded-full border-2 border-line border-t-clay"
          style={{ animation: "spin 0.8s linear infinite" }}
        />
      </div>
    );
  }

  return (
    <div
      className="flex justify-center overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
