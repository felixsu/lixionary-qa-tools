"use client";

import React, { useState } from "react";
import Link from "next/link";
import { CircleHelp, ExternalLink } from "lucide-react";
import { useAppContext } from "../../context/AppContext";
import { Modal } from "../Modal";
import GuideBlockRenderer, { GuideBlock } from "./GuideBlockRenderer";

interface GuideDetail {
  id: string;
  title: string;
  description: string;
  blocks: GuideBlock[];
}

// Guides rarely change mid-session; cache fetches so repeated opens are instant.
const guideCache = new Map<string, GuideDetail>();

// Question-mark help affordance. Drop it beside any menu or button:
//   <GuideHelpButton slug="api-studio-intro" />
// The slug is set by an admin in the User guide studio; guideId works as a
// fallback for pages without one.
export default function GuideHelpButton({
  slug,
  guideId,
  title = "Open guide",
  className,
}: {
  slug?: string;
  guideId?: string;
  title?: string;
  className?: string;
}) {
  const { apiCall } = useAppContext();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [guide, setGuide] = useState<GuideDetail | null>(null);
  const [failed, setFailed] = useState(false);

  const cacheKey = slug ? `slug:${slug}` : `id:${guideId}`;

  const open = async () => {
    setIsOpen(true);
    setFailed(false);
    const cached = guideCache.get(cacheKey);
    if (cached) {
      setGuide(cached);
      return;
    }
    setIsLoading(true);
    try {
      const data = await apiCall(slug ? `/api/user-guides/by-slug/${slug}` : `/api/user-guides/${guideId}`);
      guideCache.set(cacheKey, data);
      setGuide(data);
    } catch {
      setFailed(true);
    } finally {
      setIsLoading(false);
    }
  };

  if (!slug && !guideId) return null;

  return (
    <>
      <button
        type="button"
        onClick={open}
        title={title}
        className={
          className ??
          "h-6 w-6 rounded-md flex items-center justify-center text-mute hover:text-clay hover:bg-panel transition-colors"
        }
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>

      {isOpen && (
        <Modal title={guide?.title || "Guide"} onClose={() => setIsOpen(false)} width={720}>
          <div className="max-h-[70vh] overflow-y-auto -mx-2 px-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div
                  className="h-6 w-6 rounded-full border-2 border-line border-t-clay"
                  style={{ animation: "spin 0.8s linear infinite" }}
                />
              </div>
            ) : failed || !guide ? (
              <div className="py-10 text-center text-[13px] text-mute">
                This guide isn&apos;t available yet.
              </div>
            ) : (
              <GuideBlockRenderer blocks={guide.blocks || []} />
            )}
          </div>
          {guide && !failed && (
            <div className="flex justify-end pt-1 border-t border-line">
              <Link
                href={`/user-guides/detail?id=${guide.id}`}
                onClick={() => setIsOpen(false)}
                className="inline-flex items-center gap-1.5 text-xs text-stone hover:text-clay transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open full page
              </Link>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
