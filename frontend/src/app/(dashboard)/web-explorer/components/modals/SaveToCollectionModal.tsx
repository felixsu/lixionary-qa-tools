"use client";

import React, { useState } from "react";
import { useAppContext } from "../../../../context/AppContext";
import { useToast } from "../../../../context/ToastContext";
import type { NetworkLog, NetworkDetails } from "../../../../context/WebExplorerContext";
import { Modal, ModalFooter } from "../../../../components/Modal";
import { methodStyle } from "../../../../utils/methodStyle";
import { logBaseUrl, parseLogQueryParams, suggestRequestName } from "../../lib/networkLog";

/**
 * Saves a captured network request into an API Explorer collection (existing
 * or new), warning once about same-method/same-base-URL duplicates. Mounted
 * fresh per open, so form state initializes from the log.
 */
export default function SaveToCollectionModal({
  log,
  details,
  onClose,
}: {
  log: NetworkLog;
  details: NetworkDetails | null;
  onClose: () => void;
}) {
  const { collections, handleSaveNetworkRequestToCollection, handleSaveNetworkRequestToNewCollection } = useAppContext();
  const { showToast } = useToast();

  const [saveCollectionId, setSaveCollectionId] = useState(collections.length ? collections[0].id : "__new__");
  const [saveRequestName, setSaveRequestName] = useState(() => suggestRequestName(log.url));
  const [newCollectionName, setNewCollectionName] = useState("");
  const [saveDuplicates, setSaveDuplicates] = useState<{ collectionName: string; requestName: string }[]>([]);
  const [saveShowDuplicateWarning, setSaveShowDuplicateWarning] = useState(false);
  const [isSavingToCollection, setIsSavingToCollection] = useState(false);

  const findCollectionDuplicates = (method: string, url: string): { collectionName: string; requestName: string }[] => {
    const base = logBaseUrl(url);
    return collections.flatMap(col =>
      col.requests
        .filter(req => req.method === method && logBaseUrl(req.url) === base)
        .map(req => ({ collectionName: col.name, requestName: req.name }))
    );
  };

  const handleConfirmSaveToCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    const isNewCollection = saveCollectionId === "__new__";
    if (!saveCollectionId || !saveRequestName) return;
    if (isNewCollection && !newCollectionName.trim()) return;

    if (!saveShowDuplicateWarning) {
      const dupes = findCollectionDuplicates(log.method, log.url);
      if (dupes.length) {
        setSaveDuplicates(dupes);
        setSaveShowDuplicateWarning(true);
        return;
      }
    }

    const req = details?.request;
    const rawHeaders = req?.headers ?? log.headers;
    const headers = Object.entries(rawHeaders || {}).map(([key, value]) => ({ key, value }));
    const postData = req?.postData || "";
    let bodyType = "NONE";
    let body = "";
    if (postData) {
      try { JSON.parse(postData); bodyType = "JSON"; } catch { bodyType = "TEXT"; }
      body = postData;
    }
    const fullUrl = req?.url ?? log.url;
    const queryParams = parseLogQueryParams(fullUrl);
    const urlWithoutQuery = logBaseUrl(fullUrl);

    setIsSavingToCollection(true);
    try {
      if (isNewCollection) {
        await handleSaveNetworkRequestToNewCollection(newCollectionName.trim(), saveRequestName, {
          method: log.method,
          url: urlWithoutQuery,
          headers,
          queryParams,
          bodyType,
          body,
        });
      } else {
        await handleSaveNetworkRequestToCollection(saveCollectionId, saveCollectionId, saveRequestName, {
          method: log.method,
          url: urlWithoutQuery,
          headers,
          queryParams,
          bodyType,
          body,
        });
      }
      onClose();
    } catch (err: any) {
      showToast(err.message, { type: "error" });
    } finally {
      setIsSavingToCollection(false);
    }
  };

  return (
    <Modal title="Save to collection" onClose={onClose} width={460}>
      <form onSubmit={handleConfirmSaveToCollection} className="flex flex-col gap-5">
        {saveShowDuplicateWarning && saveDuplicates.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-amber-800">Duplicate request detected</span>
            <ul className="text-[12px] text-amber-700 list-disc pl-4">
              {saveDuplicates.map((d, i) => (
                <li key={i}>
                  <span className="font-mono">{d.requestName}</span>{" "}
                  in <span className="font-medium">{d.collectionName}</span>
                </li>
              ))}
            </ul>
            <span className="text-[12px] text-amber-700 mt-0.5">Submit again to save anyway.</span>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-graphite">Collection</label>
          {saveCollectionId === "__new__" ? (
            <>
              <input
                type="text"
                placeholder="e.g. Authentication Suite"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                autoFocus
                required
                className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
              />
              {collections.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setSaveCollectionId(collections[0].id); setNewCollectionName(""); }}
                  className="self-start text-[12px] text-clay hover:underline"
                >
                  ← Choose existing collection
                </button>
              )}
            </>
          ) : (
            <select
              value={saveCollectionId}
              onChange={(e) => setSaveCollectionId(e.target.value)}
              required
              className="h-10 bg-cream border border-line rounded-lg px-3 text-sm text-ink outline-none focus:border-clay"
            >
              {collections.map(col => (
                <option key={col.id} value={col.id}>{col.name}</option>
              ))}
              <option value="__new__">+ Create new collection…</option>
            </select>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-graphite">Request name</label>
          <input
            type="text"
            value={saveRequestName}
            onChange={(e) => setSaveRequestName(e.target.value)}
            autoFocus={saveCollectionId !== "__new__"}
            required
            className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
          />
        </div>

        <div className="flex items-center gap-2 px-3 py-2 bg-panel rounded-lg border border-line">
          <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={methodStyle(log.method)}>
            {log.method}
          </span>
          <span className="font-mono text-[11px] text-graphite truncate">{logBaseUrl(log.url)}</span>
        </div>

        <ModalFooter
          onCancel={onClose}
          submitLabel={isSavingToCollection ? "Saving…" : saveShowDuplicateWarning ? "Save anyway" : "Save"}
        />
      </form>
    </Modal>
  );
}
