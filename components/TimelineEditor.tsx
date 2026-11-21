"use client";

import { useMemo } from "react";
import { fmtTime } from "@/lib/time";

export type EditClip = {
  uid: string;
  source: string;
  label: string;
  start: number;
  end: number;
  speed: number;
  look: string;
  motion: string;
  transition: string;
  transitionSec: number;
  mute: boolean;
  volume: number;
  zoom: number;
  reverse: boolean;
};

export type EditText = {
  uid: string;
  text: string;
  at: number;
  duration: number;
  position: string;
  animation: string;
  color: string;
  size?: number;
  box: boolean;
};

export type EditAudio = {
  uid: string;
  source: string;
  label: string;
  at: number;
  volume: number;
  loop: boolean;
  duck: boolean;
};

export type EditOverlay = {
  uid: string;
  source: string;
  label: string;
  at: number;
  duration: number;
  x: number;
  y: number;
  width: number;
  opacity: number;
  rotate: number;
};

export const clipLen = (c: EditClip) => Math.max(0.2, (c.end - c.start) / Math.max(0.25, c.speed));

/** Total timeline length = video track, ignoring overlapping transitions. */
export function timelineLen(clips: EditClip[], texts: EditText[], overlays: EditOverlay[], audios: EditAudio[]) {
  const video = clips.reduce((sum, c) => sum + clipLen(c), 0);
  const textEnd = texts.reduce((m, t) => Math.max(m, t.at + t.duration), 0);
  const ovEnd = overlays.reduce((m, o) => Math.max(m, o.at + o.duration), 0);
  const audioEnd = audios.reduce((m, a) => Math.max(m, a.at + 20), 0);
  return Math.max(video, textEnd, ovEnd, audioEnd, 1);
}

const TRACK_COLORS = [
  "from-cyan-400/80 to-blue-500/80",
  "from-fuchsia-400/80 to-purple-500/80",
  "from-amber-300/80 to-orange-500/80",
  "from-emerald-400/80 to-teal-500/80",
  "from-rose-400/80 to-pink-500/80",
  "from-indigo-400/80 to-violet-500/80",
];

/**
 * Multi-track timeline: video / text / sticker / audio lanes on one ruler.
 * Clicking a block selects it; the inspector edits the selection.
 */
export default function TimelineEditor({
  clips,
  texts,
  overlays,
  audios,
  total,
  playhead,
  selectedUid,
  onSelect,
  onSeek,
  onMoveClip,
}: {
  clips: EditClip[];
  texts: EditText[];
  overlays: EditOverlay[];
  audios: EditAudio[];
  total: number;
  playhead: number;
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  onSeek: (sec: number) => void;
  onMoveClip: (uid: string, dir: -1 | 1) => void;
}) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / total) * 100))}%`;

  // Video segments with cumulative offsets (transitions overlap slightly, so
  // this bar is a straight sum — the ruler below is the accurate timebase).
  const segments = useMemo(
    () =>
      clips.reduce<{ uid: string; left: number; width: number; label: string; look: string }[]>((acc, c) => {
        const prev = acc[acc.length - 1];
        const left = prev ? prev.left + prev.width : 0;
        return [...acc, { uid: c.uid, left, width: clipLen(c), label: c.label, look: c.look }];
      }, []),
    [clips],
  );

  const ticks = useMemo(() => {
    const step = total <= 15 ? 1 : total <= 60 ? 5 : total <= 180 ? 15 : 60;
    const out: number[] = [];
    for (let t = 0; t <= total; t += step) out.push(t);
    return out;
  }, [total]);

  return (
    <div className="rounded-xl border border-line bg-black/30 p-3">
      {/* ruler */}
      <div className="relative mb-2 h-5 select-none">
        {ticks.map((t) => (
          <div key={t} className="absolute top-0 -translate-x-1/2 text-[10px] text-muted" style={{ left: pct(t) }}>
            {fmtTime(t)}
          </div>
        ))}
      </div>

      <div
        className="relative space-y-1.5"
        onDoubleClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onSeek(((e.clientX - rect.left) / rect.width) * total);
        }}
      >
        {/* playhead */}
        <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-brand" style={{ left: pct(playhead) }}>
          <div className="-ml-1 h-1.5 w-2.5 rounded-sm bg-brand" />
        </div>

        {/* video track */}
        <Lane label="Video" hint={`${clips.length} clip${clips.length === 1 ? "" : "s"}`}>
          {segments.map((s, i) => (
            <button
              key={s.uid}
              onClick={() => onSelect(s.uid)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onMoveClip(s.uid, -1);
              }}
              title={`${s.label} — ${clipLen(clips[i]).toFixed(1)}s · ${s.look}`}
              className={`absolute top-0 h-full overflow-hidden rounded-md bg-gradient-to-r ${TRACK_COLORS[i % TRACK_COLORS.length]} px-1.5 text-left text-[10px] font-semibold text-black/85 transition ${
                selectedUid === s.uid ? "ring-2 ring-white" : "ring-1 ring-black/30 hover:ring-white/60"
              }`}
              style={{ left: pct(s.left), width: pct(s.width), minWidth: 8 }}
            >
              <span className="block truncate">{s.label}</span>
            </button>
          ))}
          {!clips.length && <Empty>Add a clip to start</Empty>}
        </Lane>

        {/* text track */}
        <Lane label="Text" hint={`${texts.length}`}>
          {texts.map((t) => (
            <button
              key={t.uid}
              onClick={() => onSelect(t.uid)}
              title={`${t.text} — ${t.animation}`}
              className={`absolute top-0 h-full overflow-hidden rounded-md border px-1.5 text-left text-[10px] font-medium ${
                selectedUid === t.uid
                  ? "border-white bg-white/15 text-white ring-2 ring-white"
                  : "border-amber-300/40 bg-amber-300/15 text-amber-200 hover:bg-amber-300/25"
              }`}
              style={{ left: pct(t.at), width: pct(Math.max(0.4, t.duration)), minWidth: 10 }}
            >
              <span className="block truncate">T {t.text}</span>
            </button>
          ))}
          {!texts.length && <Empty>No titles yet</Empty>}
        </Lane>

        {/* sticker track */}
        <Lane label="Sticker" hint={`${overlays.length}`}>
          {overlays.map((o) => (
            <button
              key={o.uid}
              onClick={() => onSelect(o.uid)}
              title={o.label}
              className={`absolute top-0 h-full overflow-hidden rounded-md border px-1.5 text-left text-[10px] ${
                selectedUid === o.uid
                  ? "border-white bg-white/15 text-white ring-2 ring-white"
                  : "border-sky-300/40 bg-sky-300/15 text-sky-200 hover:bg-sky-300/25"
              }`}
              style={{ left: pct(o.at), width: pct(Math.max(0.4, o.duration)), minWidth: 10 }}
            >
              <span className="block truncate">✦ {o.label}</span>
            </button>
          ))}
          {!overlays.length && <Empty>No stickers yet</Empty>}
        </Lane>

        {/* audio track */}
        <Lane label="Audio" hint={`${audios.length}`}>
          {audios.map((a) => (
            <button
              key={a.uid}
              onClick={() => onSelect(a.uid)}
              title={`${a.label} — ${Math.round(a.volume * 100)}%`}
              className={`absolute top-0 h-full overflow-hidden rounded-md border px-1.5 text-left text-[10px] ${
                selectedUid === a.uid
                  ? "border-white bg-white/15 text-white ring-2 ring-white"
                  : "border-emerald-300/40 bg-emerald-300/15 text-emerald-200 hover:bg-emerald-300/25"
              }`}
              style={{ left: pct(a.at), width: pct(Math.max(1, total - a.at)), minWidth: 10 }}
            >
              <span className="block truncate">♪ {a.label}{a.duck ? " · duck" : ""}</span>
            </button>
          ))}
          {!audios.length && <Empty>No music</Empty>}
        </Lane>
      </div>
    </div>
  );
}

function Lane({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-14 shrink-0 text-right">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
        <div className="text-[9px] text-muted/60">{hint}</div>
      </div>
      <div className="relative h-8 flex-1 overflow-hidden rounded-md bg-white/[0.03] ring-1 ring-inset ring-white/5">
        {children}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <span className="absolute inset-0 grid place-items-center text-[10px] text-muted/50">{children}</span>;
}
