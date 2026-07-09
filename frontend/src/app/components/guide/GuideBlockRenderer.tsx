"use client";

import React from "react";
import MarkdownContent from "./MarkdownContent";
import MermaidDiagram from "./MermaidDiagram";

export interface GuideBlock {
  type: "markdown" | "mermaid";
  content: string;
}

export default function GuideBlockRenderer({ blocks }: { blocks: GuideBlock[] }) {
  if (blocks.length === 0) {
    return <p className="text-sm italic text-mute">This guide has no content yet.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {blocks.map((block, i) =>
        block.type === "mermaid" ? (
          <div key={i} className="rounded-xl border border-line bg-panel p-4">
            <MermaidDiagram code={block.content} />
          </div>
        ) : (
          <MarkdownContent key={i} content={block.content} />
        )
      )}
    </div>
  );
}
