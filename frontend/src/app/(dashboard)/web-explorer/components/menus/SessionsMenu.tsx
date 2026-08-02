"use client";

import { useRef, useState } from "react";
import { ChevronDown, Loader2, X } from "lucide-react";
import { useWebExplorer } from "../../../../context/WebExplorerContext";
import { useOutsideDismiss } from "../../hooks/useOutsideDismiss";

/** Sessions popover: list, reconnect, and close actions per session. */
export default function SessionsMenu({
  onCloseSession,
  closingSessionId,
}: {
  onCloseSession: (sessionId: string) => void;
  closingSessionId: string | null;
}) {
  const { userSessions, fetchUserSessions, handleReconnectSession } = useWebExplorer();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useOutsideDismiss(menuRef, () => setOpen(false), open);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => { setOpen((v) => !v); fetchUserSessions(); }}
        className="h-[34px] px-3 bg-cream border border-line rounded-lg text-[13px] text-graphite hover:bg-panel transition-colors flex items-center gap-1.5"
      >
        Sessions <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-[320px] bg-cream border border-line rounded-xl shadow-[0_8px_24px_rgba(20,20,19,0.12)] z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-line flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone">Your sessions</span>
            <button onClick={() => setOpen(false)} className="text-mute hover:text-graphite">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-[240px] overflow-y-auto">
            {userSessions.length === 0 && (
              <p className="text-xs text-mute text-center py-4">No sessions found.</p>
            )}
            {userSessions.map((s) => (
              <div key={s.session_id} className="flex items-center gap-2 px-3 py-2 border-b border-line last:border-0 hover:bg-panel transition-colors">
                <span className={`h-2 w-2 rounded-full flex-shrink-0 ${s.status === "active" ? "bg-sage" : s.status === "disconnected" ? "bg-stone" : "bg-danger"}`} />
                <span className="font-mono text-[11px] text-graphite flex-1 truncate" title={s.session_id}>{s.session_id}</span>
                <span className="text-[10px] text-mute capitalize">{s.status}</span>
                {s.status === "disconnected" && (
                  <button
                    onClick={() => { handleReconnectSession(s.session_id); setOpen(false); }}
                    className="text-[11px] font-medium text-clay hover:text-clay-dark"
                  >Reconnect</button>
                )}
                <button
                  onClick={() => onCloseSession(s.session_id)}
                  disabled={closingSessionId === s.session_id}
                  className="text-mute hover:text-danger transition-colors disabled:opacity-40"
                  title="Close session"
                >
                  {closingSessionId === s.session_id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
