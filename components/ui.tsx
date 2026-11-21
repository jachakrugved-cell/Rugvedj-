"use client";

import { useState } from "react";
import { fmtTime, parseTimecode } from "@/lib/time";
import type { Task } from "@/lib/types";

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function PlayGlyph() {
  return (
    <div className="grid h-14 w-14 place-items-center rounded-2xl border border-brand/40 bg-brand/10">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 text-brand">
        <path d="M8 5v14l11-7z" />
      </svg>
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`flex items-center gap-2 text-[11px] font-medium ${on ? "text-brand-2" : "text-muted"}`}
      type="button"
    >
      {label}
      <span
        className={`relative h-4 w-7 rounded-full border transition ${
          on ? "border-brand/60 bg-brand/30" : "border-line bg-white/5"
        }`}
      >
        <span
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${
            on ? "left-[14px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

export function TimeInput({
  label,
  value,
  max,
  onCommit,
  onSeek,
}: {
  label: string;
  value: number;
  max: number;
  onCommit: (v: number) => void;
  onSeek?: (v: number) => void;
}) {
  const [text, setText] = useState(() => fmtTime(value, true));
  const [editing, setEditing] = useState(false);
  // Keep the field in sync with the timeline unless the user is typing.
  // (Adjusted during render — React's recommended alternative to an effect.)
  const [lastValue, setLastValue] = useState(value);
  if (!editing && value !== lastValue) {
    setLastValue(value);
    setText(fmtTime(value, true));
  }
  const commit = () => {
    const parsed = parseTimecode(text);
    if (parsed === null) {
      setText(fmtTime(value, true));
      return;
    }
    const v = Math.max(0, max ? Math.min(parsed, max) : parsed);
    onCommit(v);
    onSeek?.(v);
  };
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <input
        className="input mono !py-1.5 !text-xs"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        spellCheck={false}
      />
    </label>
  );
}

export function QuickAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-line bg-white/[0.02] px-2 py-1.5 text-[10.5px] font-medium text-muted transition hover:border-brand/40 hover:text-ink"
    >
      {label}
    </button>
  );
}

export function TaskRow({ t }: { t: Task }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-medium">
          {t.kind === "record" ? "● " : "✂ "}
          {t.title}
        </span>
        <span className="mono shrink-0 text-muted">
          {t.state === "running" ? `${t.progress}%` : t.state}
          {t.speed ? ` · ${t.speed}` : ""}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            t.state === "error"
              ? "bg-rose-500"
              : "bg-gradient-to-r from-brand to-brand-2"
          }`}
          style={{ width: `${Math.max(2, t.progress)}%` }}
        />
      </div>
      <p className={`mt-1 text-[11px] ${t.state === "error" ? "text-rose-300" : "text-muted"}`}>
        {t.message}
      </p>
    </div>
  );
}

export function Env({ ok, label, detail }: { ok?: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`} />
      <div className="min-w-0">
        <span className="font-semibold text-ink">{label}</span>
        {detail && <span className="mono ml-1.5 block truncate text-[10px] text-[#5d6479]">{detail}</span>}
      </div>
    </li>
  );
}

export function Chip({ children, tone }: { children: React.ReactNode; tone?: "brand" | "live" | "ok" }) {
  const cls =
    tone === "brand"
      ? "!border-brand/40 !text-brand"
      : tone === "live"
        ? "!border-live/50 !text-rose-300"
        : tone === "ok"
          ? "!border-emerald-500/40 !text-emerald-300"
          : "";
  return <span className={`chip ${cls}`}>{children}</span>;
}
