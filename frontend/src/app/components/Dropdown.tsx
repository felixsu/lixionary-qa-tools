"use client";

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";

export type DropdownOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

interface DropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  className?: string;
  widthClass?: string;
  align?: "left" | "right";
  disabled?: boolean;
  openUpward?: boolean;
  renderTrigger?: (selected: DropdownOption | undefined, open: boolean) => React.ReactNode;
}

// Base styles that never conflict with caller overrides (no height / padding / rounding / text-size / text-color).
const TRIGGER_BASE =
  "flex items-center justify-between gap-2 bg-cream border border-line outline-none cursor-pointer transition-colors hover:bg-panel focus:border-clay disabled:opacity-50 disabled:cursor-not-allowed";
// Default sizing bucket — replaced wholesale when the caller passes `className`.
const TRIGGER_SIZE_DEFAULT = "h-[38px] px-3.5 rounded-lg text-[13px] text-ink";

export default function Dropdown({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className,
  widthClass,
  align = "left",
  disabled,
  openUpward,
  renderTrigger,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selected = options.find((o) => o.value === value);

  const updateCoords = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (openUpward) {
      setCoords({ bottom: window.innerHeight - r.top + 4, left: r.left, width: r.width });
    } else {
      setCoords({ top: r.bottom + 4, left: r.left, width: r.width });
    }
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

  const openMenu = () => {
    if (disabled) return;
    setActiveIdx(options.findIndex((o) => o.value === value));
    setOpen(true);
  };

  const commit = (idx: number) => {
    const opt = options[idx];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveActive = (dir: 1 | -1) => {
    setActiveIdx((prev) => {
      let next = prev;
      for (let i = 0; i < options.length; i++) {
        next = (next + dir + options.length) % options.length;
        if (!options[next]?.disabled) return next;
      }
      return prev;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveActive(-1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (activeIdx >= 0) commit(activeIdx);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={
          renderTrigger
            ? `${widthClass ?? ""} ${className ?? ""}`.trim() || undefined
            : `${TRIGGER_BASE} ${className ?? TRIGGER_SIZE_DEFAULT} ${widthClass ?? ""}`.trim()
        }
      >
        {renderTrigger ? (
          renderTrigger(selected, open)
        ) : (
          <>
            <span className={`truncate ${selected ? "" : "text-mute"}`}>
              {selected ? selected.label : placeholder}
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 flex-shrink-0 text-stone transition-transform ${open ? "rotate-180" : ""}`}
            />
          </>
        )}
      </button>

      {open && coords &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            id={listboxId}
            tabIndex={-1}
            style={{
              position: "fixed",
              top: openUpward ? undefined : coords.top,
              bottom: openUpward ? coords.bottom : undefined,
              left: align === "right" ? undefined : coords.left,
              right: align === "right" ? window.innerWidth - (coords.left + coords.width) : undefined,
              minWidth: coords.width,
            }}
            className="z-[100] max-h-72 overflow-y-auto rounded-lg border border-line bg-cream py-1 shadow-lg shadow-ink/5 animate-[fadeUp_0.12s_ease-out]"
          >
            {options.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isActive = idx === activeIdx;
              return (
                <div
                  key={`${opt.value}-${idx}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => commit(idx)}
                  className={`flex items-center justify-between gap-2 mx-1 px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
                    opt.disabled
                      ? "text-mute cursor-not-allowed"
                      : "cursor-pointer " +
                        (isActive ? "bg-hover " : "") +
                        (isSelected ? "text-clay font-medium" : "text-ink")
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 flex-shrink-0 text-clay" />}
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
