// The generator picker shared by API Explorer and API Studio.
//
// Emits brace-less token bodies ("$date:+1d:YYYY-MM-DD", "$randomInt:4") — the
// form input bindings store, matching backend resolve_input_bindings. Whoever
// consumes a token decides whether to wrap it in {{…}}: request fields do,
// input bindings and Studio's Generator block don't.
//
// The catalog itself lives in backend/services/executor.py
// (_DYNAMIC_TOKEN_HANDLERS) — this file only offers the tokens, it never
// evaluates them.

"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, MapPin, Wand2 } from "lucide-react";
import Dropdown from "./Dropdown";
import MapPickerDialog from "./MapPickerDialog";
import { useAppContext } from "../context/AppContext";

const DATE_OFFSET_UNITS = [
  { value: "d", label: "Days" },
  { value: "h", label: "Hours" },
  { value: "m", label: "Minutes" },
  { value: "s", label: "Seconds" },
];

// Token bodies without braces — braces are added by the Body-editor wrapper;
// input bindings store the bare body (matches backend resolve_input_bindings).
const INSERT_VALUE_ROWS = [
  { label: "Random email", token: "$randomEmail" },
  { label: "Random first name", token: "$randomFirstName" },
  { label: "Random last name", token: "$randomLastName" },
  { label: "Random full name", token: "$randomFullName" },
];

// Shared generator picker panel — emits brace-less token bodies like
// "$date:+1d:YYYY-MM-DD" or "$randomInt:4" via onPick.
export function GeneratorMenuPanel({ onPick, onOpenMap }: { onPick: (tokenBody: string) => void; onOpenMap: () => void }) {
  const { apiCall } = useAppContext();
  const [dateOffset, setDateOffset] = useState("0");
  const [dateUnit, setDateUnit] = useState("d");
  const [dateFormat, setDateFormat] = useState("YYYY-MM-DD");
  const [digits, setDigits] = useState("4");
  const [geoPoint, setGeoPoint] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    apiCall("/api/local-store/pref/geo_point")
      .then((res: unknown) => {
        const value = (res as { value?: string } | null)?.value;
        const parsed = JSON.parse(value ?? "") as { lat?: unknown; lng?: unknown };
        if (typeof parsed?.lat === "number" && typeof parsed?.lng === "number") {
          setGeoPoint({ lat: parsed.lat, lng: parsed.lng });
        }
      })
      .catch(() => { /* no point picked yet */ });
  }, [apiCall]);

  const handleUnitChange = (unit: string) => {
    setDateUnit(unit);
    setDateFormat((prev) => {
      if (prev !== "YYYY-MM-DD" && prev !== "YYYY-MM-DD HH:mm:ss") return prev; // user customized it, leave alone
      return unit === "d" ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm:ss";
    });
  };

  const dateOffsetPart = () => {
    const n = parseInt(dateOffset, 10) || 0;
    return n !== 0 ? `${n > 0 ? "+" : ""}${n}${dateUnit}:` : "";
  };

  const pickDate = () => {
    onPick(`$date:${dateOffsetPart()}${dateFormat || "YYYY-MM-DD"}`);
  };

  const pickEpoch = (ms: boolean) => {
    onPick(`$date:${dateOffsetPart()}${ms ? "epochms" : "epoch"}`);
  };

  const pickRandomInt = () => {
    const n = Math.max(1, parseInt(digits, 10) || 4);
    onPick(`$randomInt:${n}`);
  };

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-stone uppercase tracking-wide">Date</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            value={dateOffset}
            onChange={(e) => setDateOffset(e.target.value)}
            title="Offset (e.g. 3, -2)"
            className="w-16 h-8 bg-panel border border-line rounded-md px-2 text-xs text-ink outline-none focus:border-clay"
          />
          <Dropdown
            value={dateUnit}
            onChange={handleUnitChange}
            className="h-8 px-2 rounded-md text-xs text-ink flex-1"
            options={DATE_OFFSET_UNITS}
          />
        </div>
        <input
          type="text"
          value={dateFormat}
          onChange={(e) => setDateFormat(e.target.value)}
          placeholder="YYYY-MM-DD"
          className="h-8 bg-panel border border-line rounded-md px-2 font-mono text-xs text-ink outline-none focus:border-clay"
        />
        <button
          onClick={pickDate}
          className="h-8 bg-clay hover:bg-clay-dark rounded-md text-xs font-medium text-white transition-colors"
        >
          Use date
        </button>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => pickEpoch(false)}
            title="Epoch time in seconds (offset applies)"
            className="h-8 flex-1 bg-panel border border-line rounded-md text-xs font-medium text-graphite hover:bg-hover transition-colors"
          >
            Epoch (s)
          </button>
          <button
            onClick={() => pickEpoch(true)}
            title="Epoch time in milliseconds (offset applies)"
            className="h-8 flex-1 bg-panel border border-line rounded-md text-xs font-medium text-graphite hover:bg-hover transition-colors"
          >
            Epoch (ms)
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 pt-2 border-t border-line">
        <span className="text-[11px] font-medium text-stone uppercase tracking-wide">Random number</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            value={digits}
            onChange={(e) => setDigits(e.target.value)}
            className="w-16 h-8 bg-panel border border-line rounded-md px-2 text-xs text-ink outline-none focus:border-clay"
          />
          <span className="text-xs text-mute">digits</span>
          <button
            onClick={pickRandomInt}
            className="ml-auto h-8 px-3 bg-clay hover:bg-clay-dark rounded-md text-xs font-medium text-white transition-colors"
          >
            Use
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 pt-2 border-t border-line">
        <span className="text-[11px] font-medium text-stone uppercase tracking-wide">Location</span>
        <button
          onClick={onOpenMap}
          className="h-8 px-2 flex items-center gap-1.5 bg-panel border border-line rounded-md text-xs text-graphite hover:bg-hover transition-colors"
        >
          <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-clay" />
          <span className="truncate font-mono text-[11px]">
            {geoPoint ? `${geoPoint.lat.toFixed(4)}, ${geoPoint.lng.toFixed(4)}` : "Pick on map…"}
          </span>
        </button>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onPick("$latitude")}
            className="h-8 flex-1 bg-clay hover:bg-clay-dark rounded-md text-xs font-medium text-white transition-colors"
          >
            Latitude
          </button>
          <button
            onClick={() => onPick("$longitude")}
            className="h-8 flex-1 bg-clay hover:bg-clay-dark rounded-md text-xs font-medium text-white transition-colors"
          >
            Longitude
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-0.5 pt-2 border-t border-line">
        {INSERT_VALUE_ROWS.map((row) => (
          <button
            key={row.token}
            onClick={() => onPick(row.token)}
            className="h-8 px-2 text-left rounded-md text-xs text-ink hover:bg-hover transition-colors"
          >
            {row.label}
          </button>
        ))}
      </div>
    </>
  );
}

// Trigger button + positioned portal around GeneratorMenuPanel.
export function GeneratorMenuButton({
  buttonContent,
  buttonClassName,
  onPick,
}: {
  buttonContent: React.ReactNode;
  buttonClassName: string;
  onPick: (tokenBody: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateCoords = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ top: r.bottom + 4, left: r.right - 288 });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
    const handle = () => updateCoords();
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);
    return () => {
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={buttonClassName}
      >
        {buttonContent}
      </button>

      {open && coords &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, width: 288 }}
            className="z-[100] rounded-lg border border-line bg-cream p-3 shadow-lg shadow-ink/5 flex flex-col gap-3 animate-[fadeUp_0.12s_ease-out]"
          >
            <GeneratorMenuPanel
              onPick={(tokenBody) => {
                onPick(tokenBody);
                setOpen(false);
              }}
              onOpenMap={() => {
                setOpen(false);
                setShowMapPicker(true);
              }}
            />
          </div>,
          document.body
        )}

      {showMapPicker && <MapPickerDialog onClose={() => setShowMapPicker(false)} />}
    </>
  );
}

// Body-editor variant: inserts a full {{$...}} token at the cursor.
export function InsertValueMenu({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <GeneratorMenuButton
      buttonContent={<><Wand2 className="h-3.5 w-3.5" /> Insert value</>}
      buttonClassName="h-[30px] px-2.5 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs font-medium text-graphite hover:bg-panel transition-colors"
      onPick={(tokenBody) => onInsert(`{{${tokenBody}}}`)}
    />
  );
}

// Input-tab variant: binds an input to a generator token body.
export function GeneratorBindingButton({ value, onChange }: { value: string; onChange: (tokenBody: string) => void }) {
  return (
    <GeneratorMenuButton
      buttonContent={
        <>
          <Wand2 className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="font-mono truncate">{value || "Choose generator…"}</span>
          <ChevronDown className="h-3.5 w-3.5 ml-auto flex-shrink-0" />
        </>
      }
      buttonClassName="h-[30px] px-2.5 flex-1 flex items-center gap-1.5 bg-cream border border-line rounded-md text-xs text-graphite hover:bg-panel transition-colors min-w-0 text-left"
      onPick={onChange}
    />
  );
}
