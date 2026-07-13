"use client";

import React, { useState } from "react";
import { Plus, Trash2, Pencil, X, Key, Globe } from "lucide-react";
import { useAppContext, BrowserProfile } from "../../context/AppContext";
import Dropdown from "../../components/Dropdown";

const DEFAULT_PROFILE_COOKIES = `[
  {
    "name": "ninja_access_token",
    "value": "YOUR_TOKEN",
    "domain": ".ninjavan.co",
    "path": "/",
    "secure": true,
    "sameSite": "Lax"
  },
  {
    "name": "user",
    "value": "%7B%22thirdPartyId%...",
    "domain": ".ninjavan.co",
    "path": "/",
    "secure": true,
    "sameSite": "Lax"
  }
]`;

const DEFAULT_PROFILE_LOCAL_STORAGE = `{
  "origins": [
    {
      "origin": "https://operatorv2-qa.ninjavan.co",
      "localStorage": [
        {
          "name": "acceptedTnC",
          "value": "true"
        }
      ]
    }
  ]
}`;

export default function BrowserProfilesPage() {
  const { profiles, authFunctions, handleSaveProfile, handleDeleteProfile } = useAppContext();

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileDefaultUrl, setProfileDefaultUrl] = useState("");
  const [profileCookies, setProfileCookies] = useState("");
  const [profileLocalStorage, setProfileLocalStorage] = useState("");
  const [rawLsOrigin, setRawLsOrigin] = useState("");
  const [rawLsKey, setRawLsKey] = useState("");
  const [rawLsValue, setRawLsValue] = useState("");
  const [profileAuthFunctionId, setProfileAuthFunctionId] = useState<string>("");
  const [profileAuthInjectionType, setProfileAuthInjectionType] = useState<"cookie" | "localStorage">("cookie");
  const [profileAuthInjectionKey, setProfileAuthInjectionKey] = useState("");
  const [profileAuthInjectionDomainOrOrigin, setProfileAuthInjectionDomainOrOrigin] = useState("");

  const openCreate = () => {
    setEditingId(null);
    setProfileName("");
    setProfileCookies(DEFAULT_PROFILE_COOKIES);
    setProfileLocalStorage(DEFAULT_PROFILE_LOCAL_STORAGE);
    setProfileAuthFunctionId("");
    setProfileDefaultUrl("");
    setProfileAuthInjectionType("cookie");
    setProfileAuthInjectionKey("");
    setProfileAuthInjectionDomainOrOrigin("");
    setShowModal(true);
  };

  const openEdit = (profile: BrowserProfile) => {
    setEditingId(profile.id);
    setProfileName(profile.name);
    setProfileCookies(profile.cookies || "");
    setProfileLocalStorage(profile.localStorage || "");
    setProfileAuthFunctionId(profile.authFunctionId || "");
    setProfileDefaultUrl(profile.defaultUrl || "");
    if (profile.authInjection) {
      setProfileAuthInjectionType((profile.authInjection.type as "cookie" | "localStorage") || "cookie");
      setProfileAuthInjectionKey(profile.authInjection.key || "");
      setProfileAuthInjectionDomainOrOrigin(profile.authInjection.domainOrOrigin || "");
    } else {
      setProfileAuthInjectionType("cookie");
      setProfileAuthInjectionKey("");
      setProfileAuthInjectionDomainOrOrigin("");
    }
    setShowModal(true);
  };

  // Lets users paste a raw target value (e.g. a transit/JSON blob that already
  // contains literal backslashes) without hand-escaping it. Hand-typing such a
  // value directly into the JSON textarea below is error-prone: JSON.parse
  // (both the validation above and the backend's json.loads) treats `\"` as an
  // escaped quote and silently drops the backslash. JSON.stringify here does
  // the escaping correctly so the raw value round-trips byte-for-byte.
  const handleInsertRawLocalStorageValue = () => {
    if (!rawLsOrigin || !rawLsKey) {
      alert("Origin and key are required.");
      return;
    }
    let parsed: any;
    try {
      parsed = profileLocalStorage ? JSON.parse(profileLocalStorage) : { origins: [] };
    } catch {
      alert("The localStorage JSON above is currently invalid — fix or clear it before inserting.");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = { origins: [] };
    if (!Array.isArray(parsed.origins)) parsed.origins = [];

    const targetOrigin = rawLsOrigin.toLowerCase().replace(/\/$/, "");
    let originEntry = parsed.origins.find(
      (o: any) => (o?.origin || "").toLowerCase().replace(/\/$/, "") === targetOrigin
    );
    if (!originEntry) {
      originEntry = { origin: rawLsOrigin, localStorage: [] };
      parsed.origins.push(originEntry);
    }
    if (!Array.isArray(originEntry.localStorage)) originEntry.localStorage = [];
    originEntry.localStorage = originEntry.localStorage.filter((kv: any) => kv?.name !== rawLsKey);
    originEntry.localStorage.push({ name: rawLsKey, value: rawLsValue });

    setProfileLocalStorage(JSON.stringify(parsed, null, 2));
    setRawLsKey("");
    setRawLsValue("");
  };

  const onSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName) return;
    if (profileCookies) {
      try { JSON.parse(profileCookies); } catch { alert("Cookies must be a valid JSON array or empty."); return; }
    }
    if (profileLocalStorage) {
      try { JSON.parse(profileLocalStorage); } catch { alert("LocalStorage must be a valid JSON object or empty."); return; }
    }
    if (profileDefaultUrl) {
      if (!profileDefaultUrl.startsWith("http://") && !profileDefaultUrl.startsWith("https://")) {
        alert("Default URL must start with http:// or https://");
        return;
      }
      try {
        new URL(profileDefaultUrl);
      } catch {
        alert("Default URL must be a valid URL format.");
        return;
      }
    }
    try {
      const authInjectionVal = profileAuthFunctionId
        ? { type: profileAuthInjectionType, key: profileAuthInjectionKey, domainOrOrigin: profileAuthInjectionDomainOrOrigin }
        : null;
      await handleSaveProfile(profileName, profileCookies, profileLocalStorage, profileAuthFunctionId || null, authInjectionVal, profileDefaultUrl, editingId);
      setShowModal(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Action bar */}
      <div className="h-14 flex items-center justify-end px-6 border-b border-line flex-shrink-0">
        <button
          onClick={openCreate}
          className="h-[38px] px-4 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white flex items-center gap-2 transition-colors"
        >
          <Plus className="h-4 w-4" /> Create browser profile
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <div className="text-base font-medium text-graphite">No browser profiles yet</div>
            <div className="text-[13px] text-mute max-w-sm leading-relaxed">
              Save cookie and localStorage presets to seed authenticated Web Explorer sessions instantly.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 content-start">
            {profiles.map((p) => {
              const linkedAuthFunc = authFunctions.find((f) => f.id === p.authFunctionId);
              return (
                <div key={p.id} className="bg-cream border border-line rounded-xl overflow-hidden flex flex-col">
                  <div className="px-5 pt-4 pb-3 flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink mb-1 truncate">{p.name}</div>
                      <div className="text-xs text-stone leading-relaxed truncate font-mono">ID: {p.id}</div>
                    </div>
                    <button
                      onClick={() => openEdit(p)}
                      className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-panel transition-colors flex-shrink-0"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5 text-graphite" />
                    </button>
                    <button
                      onClick={async () => {
                        if (confirm("Delete this profile?")) await handleDeleteProfile(p.id);
                      }}
                      className="h-7 w-7 rounded-md border border-line flex items-center justify-center hover:bg-danger-soft hover:text-danger transition-colors flex-shrink-0"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-graphite" />
                    </button>
                  </div>

                  <div className="px-5 pb-4 flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-graphite">
                      <Globe className="h-3.5 w-3.5 text-mute flex-shrink-0" />
                      <span className="truncate font-mono text-[11px]">{p.defaultUrl || "No default URL"}</span>
                    </div>
                  </div>

                  <div className="px-5 py-3 border-t border-line flex items-center gap-2">
                    <Key className={`h-3.5 w-3.5 ${linkedAuthFunc ? "text-sage" : "text-mute"}`} />
                    <span
                      className="text-xs font-medium"
                      style={{ color: linkedAuthFunc ? "#276749" : "#8e8b82" }}
                    >
                      {linkedAuthFunc ? `Auth hook: ${linkedAuthFunc.name}` : "No auth hook linked"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(20,20,19,0.5)", backdropFilter: "blur(2px)" }}
        >
          <form
            onSubmit={onSaveSubmit}
            className="bg-cream rounded-2xl p-8 w-[620px] max-h-[85vh] overflow-y-auto shadow-[0_24px_48px_-12px_rgba(20,20,19,0.18)] flex flex-col gap-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="m-0 font-serif text-xl font-medium text-ink">
                {editingId ? "Edit browser profile" : "Create browser profile"}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="h-8 w-8 rounded-lg border border-line flex items-center justify-center hover:bg-panel transition-colors"
              >
                <X className="h-4 w-4 text-graphite" />
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">Profile name</label>
              <input
                type="text"
                placeholder="e.g. Authenticated admin session"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                required
                className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">Default URL</label>
              <input
                type="text"
                placeholder="e.g. https://admin.ninjavan.co/orders"
                value={profileDefaultUrl}
                onChange={(e) => setProfileDefaultUrl(e.target.value)}
                className="h-10 bg-cream border border-line rounded-lg px-3.5 text-sm text-ink outline-none focus:border-clay focus:shadow-[0_0_0_3px_rgba(204,120,92,0.12)]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">Inject cookies (JSON array)</label>
              <textarea
                rows={4}
                value={profileCookies}
                onChange={(e) => setProfileCookies(e.target.value)}
                placeholder='[{"name": "session", "value": "xyz", "domain": "example.com", "path": "/"}]'
                className="bg-cream border border-line rounded-lg p-3 font-mono text-xs text-graphite outline-none focus:border-clay resize-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-graphite">Inject localStorage (JSON)</label>
              <textarea
                rows={5}
                value={profileLocalStorage}
                onChange={(e) => setProfileLocalStorage(e.target.value)}
                placeholder={'{\n  "origins": [\n    { "origin": "https://example.com", "localStorage": [{"name": "k", "value": "v"}] }\n  ]\n}'}
                className="bg-cream border border-line rounded-lg p-3 font-mono text-xs text-graphite outline-none focus:border-clay resize-none"
              />
              <div className="bg-panel p-3 rounded-lg border border-line flex flex-col gap-2">
                <span className="text-[11px] font-medium text-mute">
                  Add a raw value (paste it literally — backslashes and quotes are escaped for you automatically)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Origin, e.g. https://example.com"
                    value={rawLsOrigin}
                    onChange={(e) => setRawLsOrigin(e.target.value)}
                    className="h-8 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay"
                  />
                  <input
                    type="text"
                    placeholder="Key name"
                    value={rawLsKey}
                    onChange={(e) => setRawLsKey(e.target.value)}
                    className="h-8 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay"
                  />
                </div>
                <textarea
                  rows={3}
                  placeholder="Raw value, exactly as it should appear in localStorage"
                  value={rawLsValue}
                  onChange={(e) => setRawLsValue(e.target.value)}
                  className="bg-cream border border-line rounded-md p-2.5 font-mono text-xs text-graphite outline-none focus:border-clay resize-none"
                />
                <button
                  type="button"
                  onClick={handleInsertRawLocalStorageValue}
                  className="self-end h-8 px-3 rounded-md border border-line text-xs font-medium text-graphite hover:border-clay hover:text-ink transition-colors"
                >
                  Insert into JSON above
                </button>
              </div>
            </div>

            <div className="border-t border-line pt-3 flex flex-col gap-4">
              <h4 className="text-[11px] font-semibold text-clay uppercase tracking-[0.08em]">Auth hook integration</h4>
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-medium text-graphite">Link auth hook</label>
                <Dropdown
                  value={profileAuthFunctionId}
                  onChange={setProfileAuthFunctionId}
                  placeholder="— No auth hook linked —"
                  className="h-10 px-3 rounded-lg text-sm text-ink"
                  options={[
                    { value: "", label: "— No auth hook linked —" },
                    ...authFunctions.map((f) => ({
                      value: f.id,
                      label: `${f.name} ${f.expires_in ? `(${f.expires_in}s TTL)` : "(default TTL)"}`,
                    })),
                  ]}
                />
              </div>

              {profileAuthFunctionId && (
                <div className="bg-panel p-3.5 rounded-xl border border-line flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[13px] font-medium text-graphite">Injection type</label>
                      <Dropdown
                        value={profileAuthInjectionType}
                        onChange={(v) => setProfileAuthInjectionType(v as "cookie" | "localStorage")}
                        widthClass="w-full"
                        className="h-9 px-2.5 rounded-md text-xs text-ink"
                        options={[
                          { value: "cookie", label: "Cookie" },
                          { value: "localStorage", label: "Local storage" },
                        ]}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[13px] font-medium text-graphite">Target key / name</label>
                      <input
                        type="text"
                        placeholder="e.g. auth_token"
                        value={profileAuthInjectionKey}
                        onChange={(e) => setProfileAuthInjectionKey(e.target.value)}
                        required={!!profileAuthFunctionId}
                        className="h-9 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[13px] font-medium text-graphite">
                      {profileAuthInjectionType === "cookie" ? "Domain (cookie)" : "Origin (local storage)"}
                    </label>
                    <input
                      type="text"
                      placeholder={profileAuthInjectionType === "cookie" ? "e.g. .example.com" : "e.g. https://example.com"}
                      value={profileAuthInjectionDomainOrOrigin}
                      onChange={(e) => setProfileAuthInjectionDomainOrOrigin(e.target.value)}
                      required={!!profileAuthFunctionId}
                      className="h-9 bg-cream border border-line rounded-md px-2.5 text-xs text-ink outline-none focus:border-clay"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-line">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="h-10 px-4 bg-cream border border-line rounded-lg text-[13px] font-medium text-graphite hover:bg-panel transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-10 px-5 bg-clay hover:bg-clay-dark rounded-lg text-[13px] font-medium text-white transition-colors"
              >
                {editingId ? "Update profile" : "Save profile"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
