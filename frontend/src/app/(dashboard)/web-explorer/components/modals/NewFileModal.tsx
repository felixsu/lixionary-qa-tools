"use client";

import React, { useState } from "react";
import { Modal, ModalFooter } from "../../../../components/Modal";

/** Create a new .py module in the workspace. Owns its filename field. */
export default function NewFileModal({
  onCreate,
  onClose,
}: {
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [newFileName, setNewFileName] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName) return;
    await onCreate(newFileName);
  };

  return (
    <Modal title="Create Python module" onClose={onClose} width={420}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-graphite">Filename</label>
          <input
            type="text"
            placeholder="e.g. login_pom.py"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            autoFocus
            required
            className="h-10 bg-cream border border-line rounded-lg px-3.5 font-mono text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
          />
        </div>
        <ModalFooter onCancel={onClose} submitLabel="Create" />
      </form>
    </Modal>
  );
}
