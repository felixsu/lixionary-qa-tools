"use client";

import { Copy, Mail } from "lucide-react";
import { Modal } from "../../../../components/Modal";

/**
 * Shown when the backend rejects a new session with resource_depleted —
 * lists teammates' active sessions so someone can be nudged to close theirs.
 */
export default function SessionLimitModal({
  activeSessions,
  onClose,
}: {
  activeSessions: any[];
  onClose: () => void;
}) {
  return (
    <Modal title="Server Resource Limit Reached" onClose={onClose} width={640}>
      <div className="flex flex-col gap-4">
        <div className="text-[13px] text-mute leading-relaxed">
          The global limit of <strong>12 active browser sessions</strong> has been reached to prevent host Out of Memory (OOM) crashes.
          Please ask a teammate to close their idle session:
        </div>

        <div className="border border-line rounded-xl overflow-hidden max-h-[300px] overflow-y-auto bg-panel">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="bg-panel border-b border-line text-mute font-semibold">
                <th className="p-3">Teammate</th>
                <th className="p-3">Session ID</th>
                <th className="p-3">Status</th>
                <th className="p-3">Started</th>
              </tr>
            </thead>
            <tbody>
              {activeSessions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-mute">
                    No active sessions found (or data is unavailable).
                  </td>
                </tr>
              ) : (
                activeSessions.map((sess) => (
                  <tr key={sess.session_id} className="border-b border-line last:border-0 hover:bg-cream/40">
                    <td className="p-3">
                      <div className="font-medium text-ink">{sess.owner_name}</div>
                      <div className="text-[11px] text-mute flex items-center gap-1.5 mt-0.5">
                        {sess.owner_email}
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(sess.owner_email);
                          }}
                          className="text-clay hover:text-clay-dark inline-flex items-center"
                          title="Copy Email Address"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <a
                          href={`mailto:${sess.owner_email}?subject=Nudge: Close your idle Web Explorer session&body=Hi ${sess.owner_name},%0D%0A%0D%0ACould you please close your active browser session (${sess.session_id}) in Web Explorer so that I can start a session? Thanks!`}
                          className="text-clay hover:text-clay-dark inline-flex items-center"
                          title="Email Teammate"
                        >
                          <Mail className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </td>
                    <td className="p-3 font-mono text-[11px] text-graphite">{sess.session_id}</td>
                    <td className="p-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${
                        sess.status === "active"
                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                          : sess.status === "disconnected"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                          : "bg-panel text-mute"
                      }`}>
                        {sess.status}
                      </span>
                    </td>
                    <td className="p-3 text-[11px] text-mute">
                      {sess.created_at ? new Date(sess.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "N/A"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end pt-2 border-t border-line">
          <button
            onClick={onClose}
            className="h-10 px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </Modal>
  );
}
