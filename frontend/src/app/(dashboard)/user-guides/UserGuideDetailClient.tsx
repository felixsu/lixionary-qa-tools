"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";
import { useAppContext } from "../../context/AppContext";
import GuideBlockRenderer, { GuideBlock } from "../../components/guide/GuideBlockRenderer";

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
  const { token, apiCall } = useAppContext();

  const [guide, setGuide] = useState<UserGuideDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
        <Link
          href="/user-guides"
          className="inline-flex items-center gap-1.5 text-xs text-stone hover:text-clay transition-colors mb-5"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All guides
        </Link>

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
      </div>
    </div>
  );
}
