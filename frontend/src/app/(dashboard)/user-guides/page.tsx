"use client";

import React from "react";
import Link from "next/link";
import { BookOpen, Layers, ChevronRight } from "lucide-react";
import { useAppContext } from "../../context/AppContext";

export default function UserGuidesPage() {
  const { user, userGuides } = useAppContext();

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6">
        {userGuides.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <BookOpen className="h-8 w-8 text-mute" />
            <div className="text-base font-medium text-graphite">No user guides yet</div>
            <div className="text-[13px] text-mute max-w-sm leading-relaxed">
              {user?.role === "admin"
                ? "Create the first guide from the User guide studio under Administration."
                : "Ask an administrator to publish guides for the modules you use."}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 content-start">
            {userGuides.map((guide) => (
              <Link
                key={guide.id}
                href={`/user-guides/${guide.id}`}
                className="group bg-cream border border-line rounded-xl px-5 py-4 flex items-start gap-3 hover:border-clay/50 hover:bg-panel/40 transition-colors"
              >
                <div className="h-9 w-9 rounded-lg bg-panel border border-line flex items-center justify-center flex-shrink-0">
                  <BookOpen className="h-4 w-4 text-clay" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-serif text-lg font-medium text-ink truncate">{guide.title}</div>
                  <div className="text-xs text-stone leading-relaxed mt-0.5">
                    {guide.description || "No description provided."}
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <Layers className="h-3 w-3 text-mute" />
                    <span className="text-[11px] text-mute">
                      {guide.blockCount} {guide.blockCount === 1 ? "section" : "sections"}
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-mute group-hover:text-clay transition-colors flex-shrink-0 self-center" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
