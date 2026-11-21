"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtTime } from "@/lib/time";

type Props = {
  duration: number;
  current: number;
  start: number;
  end: number;
  live?: boolean;
  thumbUrl?: string;
  onChange: (range: { start: number; end: number }) => void;
  onSeek: (t: number) => void;
};

const THUMB_COUNT = 10;

/**
 * Dual-handle range timeline over a thumbnail strip.
 * Drag the body to scrub, drag edges to set in/out, click the strip to seek.
 */
export default function Timeline({
  duration,
  current,
  start,
  end,
  live = false,
  thumbUrl,
  onChange,
  onSeek,
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<null | "start" | "end" | "playhead">(null);
  const pct = (t: number) => (duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0);
  const thumbs = useMemo(
    () =>
      thumbUrl && duration > 0
        ? Array.from({ length: THUMB_COUNT }, (_, i) =>
            `${thumbUrl}${thumbUrl.includes("?") ? "&" : "?"}t=${((duration / THUMB_COUNT) * (i + 0.5)).toFixed(2)}`,
          )
        : [],
    [thumbUrl, duration],
  );

  const timeFromEvent = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration],
  );

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const t = timeFromEvent(e.clientX);
      if (drag === "start") onChange({ start: Math.min(t, end - 0.2), end });
      else if (drag === "end") onChange({ start, end: Math.max(t, start + 0.2) });
      else onSeek(t);
    };
    const up = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, start, end, onChange, onSeek, timeFromEvent]);

  const selected = Math.max(0, end - start);

  return (
    <div className="select-none">
      <div
        ref={trackRef}
        className="relative h-[74px] w-full cursor-crosshair overflow-hidden rounded-xl border border-line bg-[#0a0c12]"
        onPointerDown={(e) => {
          const t = timeFromEvent(e.clientX);
          onSeek(t);
          setDrag("playhead");
        }}
      >
        {/* thumbnails */}
        <div className="pointer-events-none absolute inset-0 flex">
          {thumbs.length ? (
            thumbs.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={src}
                alt=""
                className="h-full w-[10%] flex-1 object-cover opacity-80"
                draggable={false}
                loading="lazy"
              />
            ))
          ) : (
            <div className="grid-lines h-full w-full opacity-40" />
          )}
        </div>

        {/* dim outside selection */}
        <div className="pointer-events-none absolute inset-0 bg-black/55" />
        <div
          className="pointer-events-none absolute inset-y-0 bg-transparent shadow-[inset_0_0_0_2px_rgba(139,108,255,0.9)]"
          style={{ left: `${pct(start)}%`, width: `${Math.max(0.5, pct(end) - pct(start))}%` }}
        />

        {/* playhead */}
        <div
          className="pointer-events-none absolute inset-y-0 w-[2px] bg-white/90"
          style={{ left: `${pct(current)}%` }}
        />

        {/* handles */}
        <Handle
          side="start"
          style={{ left: `${pct(start)}%` }}
          onPointerDown={(e) => {
            e.stopPropagation();
            setDrag("start");
          }}
        />
        <Handle
          side="end"
          style={{ left: `${pct(end)}%` }}
          onPointerDown={(e) => {
            e.stopPropagation();
            setDrag("end");
          }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-3">
          <span className="mono rounded-md border border-line bg-white/5 px-2 py-0.5 text-brand">
            IN {fmtTime(start, true)}
          </span>
          <span className="mono rounded-md border border-line bg-white/5 px-2 py-0.5 text-brand-2">
            OUT {fmtTime(end, true)}
          </span>
          <span className="mono text-muted">· {fmtTime(selected, true)} selected</span>
          {live && <span className="text-[10px] font-bold tracking-wider text-rose-400">LIVE BUFFER</span>}
        </div>
        <span className="mono text-muted">{fmtTime(duration)}</span>
      </div>
    </div>
  );
}

function Handle({
  side,
  style,
  onPointerDown,
}: {
  side: "start" | "end";
  style: React.CSSProperties;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      role="slider"
      aria-label={side === "start" ? "Clip start" : "Clip end"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      tabIndex={0}
      onPointerDown={onPointerDown}
      className="absolute top-0 z-10 flex h-full w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center"
      style={style}
    >
      <div className="h-full w-[6px] rounded-full bg-gradient-to-b from-brand to-brand-2 shadow-[0_0_12px_rgba(139,108,255,0.8)]">
        <div className="mx-auto mt-1 h-1.5 w-1 rounded-[2px] bg-black/60" />
      </div>
    </div>
  );
}
