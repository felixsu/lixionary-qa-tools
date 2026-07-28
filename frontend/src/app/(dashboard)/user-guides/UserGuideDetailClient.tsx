"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, BookOpen, ChevronRight } from "lucide-react";
import { useAppContext, UserGuideSummary } from "../../context/AppContext";
import GuideBlockRenderer, { GuideBlock } from "../../components/guide/GuideBlockRenderer";
import { buildGuideTree, flattenGuideTree } from "../../utils/guideTree";

interface UserGuideDetail {
  id: string;
  title: string;
  description: string;
  blocks: GuideBlock[];
  createdByName?: string;
  updatedAt?: string;
}

export default function UserGuideDetailPage() {
  const searchParams = useSearchParams();
  const guideId = searchParams.get("id");
  const { token, apiCall, userGuides } = useAppContext();

  const [guide, setGuide] = useState<UserGuideDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Ancestor chain (root first) and direct children, from the summaries the
  // sidebar already fetched. Both are empty until userGuides loads — fine.
  const { ancestors, childPages } = useMemo(() => {
    const byId = new Map(userGuides.map((g) => [g.id, g]));
    const ancestors: UserGuideSummary[] = [];
    const seen = new Set<string>();
    let parentId = guideId ? byId.get(guideId)?.parentId : null;
    while (parentId && byId.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      ancestors.unshift(byId.get(parentId)!);
      parentId = byId.get(parentId)!.parentId;
    }
    const node = flattenGuideTree(buildGuideTree(userGuides)).find((n) => n.id === guideId);
    return { ancestors, childPages: node?.children ?? [] };
  }, [userGuides, guideId]);

  useEffect(() => {
    if (!token || !guideId) return;
    let cancelled = false;
    setIsLoading(true);
    setNotFound(false);
    setGuide(null);
    apiCall(`/api/user-guides/${guideId}`)
      .then((data) => {
        if (!cancelled) setGuide(data);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, guideId]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div
          className="h-8 w-8 rounded-full border-2 border-line border-t-clay"
          style={{ animation: "spin 0.8s linear infinite" }}
        />
      </div>
    );
  }

  if (notFound || !guide) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center p-6">
        <BookOpen className="h-8 w-8 text-mute" />
        <div className="text-base font-medium text-graphite">Guide not found</div>
        <div className="text-[13px] text-mute max-w-sm leading-relaxed">
          This guide may have been removed or the link is incorrect.
        </div>
        <Link
          href="/user-guides"
          className="mt-2 h-[34px] px-4 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white flex items-center gap-2 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to user guides
        </Link>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8" style={{ animation: "fadeUp 0.3s ease" }}>
        <div className="flex items-center gap-1.5 flex-wrap text-xs mb-5">
          <Link
            href="/user-guides"
            className="inline-flex items-center gap-1.5 text-stone hover:text-clay transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All guides
          </Link>
          {ancestors.map((a) => (
            <React.Fragment key={a.id}>
              <ChevronRight className="h-3 w-3 text-mute" />
              <Link
                href={`/user-guides/detail?id=${a.id}`}
                className="text-stone hover:text-clay transition-colors truncate max-w-[180px]"
              >
                {a.title}
              </Link>
            </React.Fragment>
          ))}
        </div>

        <h1 className="m-0 font-serif text-3xl font-medium text-ink">{guide.title}</h1>
        {guide.description && (
          <p className="mt-2 text-sm text-stone leading-relaxed">{guide.description}</p>
        )}
        <div className="mt-3 mb-6 pb-5 border-b border-line text-[11px] text-mute">
          {guide.updatedAt && <>Last updated {new Date(guide.updatedAt).toLocaleDateString()}</>}
          {guide.updatedAt && guide.createdByName && <> · </>}
          {guide.createdByName && <>Written by {guide.createdByName}</>}
        </div>

        <GuideBlockRenderer blocks={guide.blocks || []} />

        {childPages.length > 0 && (
          <div className="mt-8 pt-5 border-t border-line">
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone mb-3">
              In this section
            </div>
            <div className="flex flex-col gap-1.5">
              {childPages.map((child) => (
                <Link
                  key={child.id}
                  href={`/user-guides/detail?id=${child.id}`}
                  className="group flex items-center gap-2.5 bg-cream border border-line rounded-xl px-4 py-2.5 hover:border-clay/50 hover:bg-panel/40 transition-colors"
                >
                  <BookOpen className="h-3.5 w-3.5 text-clay flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{child.title}</div>
                    {child.description && (
                      <div className="text-[11px] text-mute truncate">{child.description}</div>
                    )}
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-mute group-hover:text-clay transition-colors flex-shrink-0" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
