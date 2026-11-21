"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TimelineEditor, {
  clipLen,
  timelineLen,
  type EditAudio,
  type EditClip,
  type EditOverlay,
  type EditText,
} from "@/components/TimelineEditor";
import { Spinner } from "@/components/ui";
import MusicPanel from "@/components/MusicPanel";
import { fmtTime } from "@/lib/time";
import type { ClipRecord } from "@/lib/types";

type Palette = {
  looks: { id: string; label: string }[];
  transitions: string[];
  transitionLabels: Record<string, string>;
  sounds: { id: string; label: string }[];
  fx: { id: string; label: string }[];
  counts: { transitions: number; looks: number; sounds: number; fx: number; recipes: number };
  motions: string[];
  positions: string[];
  titleAnimations: string[];
  recipes: { id: string; label: string; emoji: string; blurb: string }[];
  capabilities: { group: string; items: string[] }[];
};

const ASPECTS = [
  { key: "9:16", label: "9:16", hint: "Reels · Shorts" },
  { key: "1:1", label: "1:1", hint: "Square" },
  { key: "4:5", label: "4:5", hint: "IG feed" },
  { key: "16:9", label: "16:9", hint: "YouTube" },
  { key: "4:3", label: "4:3", hint: "Classic" },
];

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const COLORS = ["#ffffff", "#ffdd00", "#4dd4ff", "#ff5c8a", "#7CFC00", "#ff8a3d", "#c084fc"];

/**
 * The Editor: a CapCut-class multi-track timeline over ClipForge's library.
 * Everything here compiles to one JSON project → POST /api/studio.
 */
export default function EditorView({
  clips,
  onRendered,
}: {
  clips: ClipRecord[];
  onRendered: (clip: ClipRecord) => void;
}) {
  const [palette, setPalette] = useState<Palette | null>(null);
  const [track, setTrack] = useState<EditClip[]>([]);
  const [texts, setTexts] = useState<EditText[]>([]);
  const [overlays, setOverlays] = useState<EditOverlay[]>([]);
  const [audios, setAudios] = useState<EditAudio[]>([]);
  const [aspect, setAspect] = useState("9:16");
  const [sound, setSound] = useState("none");
  const [fx, setFx] = useState("none");
  const [pitch, setPitch] = useState(0);
  const [title, setTitle] = useState("My edit");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetch("/api/studio")
      .then((r) => r.json())
      .then(setPalette)
      .catch(() => setPalette(null));
  }, []);

  const total = useMemo(() => timelineLen(track, texts, overlays, audios), [track, texts, overlays, audios]);

  const addClip = (clip: ClipRecord) => {
    const dur = clip.durationSec || 10;
    setTrack((prev) => [
      ...prev,
      {
        uid: uid("clip"),
        source: `/api/media/${encodeURIComponent(clip.fileName)}`,
        label: clip.title.slice(0, 26),
        start: 0,
        end: Math.min(dur, 12),
        speed: 1,
        look: "none",
        motion: "none",
        transition: "fade",
        transitionSec: 0.4,
        mute: false,
        volume: 1,
        zoom: 1,
        reverse: false,
      },
    ]);
  };

  const addFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      const dur = Number(json.durationSec) || 10;
      setTrack((prev) => [
        ...prev,
        {
          uid: uid("clip"),
          source: `/api/media/${encodeURIComponent(json.fileName)}`,
          label: file.name.slice(0, 26),
          start: 0,
          end: Math.min(dur, 12),
          speed: 1,
          look: "none",
          motion: "none",
          transition: "fade",
          transitionSec: 0.4,
          mute: false,
          volume: 1,
          zoom: 1,
          reverse: false,
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const patchClip = (u: string, patch: Partial<EditClip>) =>
    setTrack((prev) => prev.map((c) => (c.uid === u ? { ...c, ...patch } : c)));
  const patchText = (u: string, patch: Partial<EditText>) =>
    setTexts((prev) => prev.map((t) => (t.uid === u ? { ...t, ...patch } : t)));
  const patchAudio = (u: string, patch: Partial<EditAudio>) =>
    setAudios((prev) => prev.map((a) => (a.uid === u ? { ...a, ...patch } : a)));
  const patchOverlay = (u: string, patch: Partial<EditOverlay>) =>
    setOverlays((prev) => prev.map((o) => (o.uid === u ? { ...o, ...patch } : o)));

  const moveClip = useCallback((u: string, dir: -1 | 1) => {
    setTrack((prev) => {
      const i = prev.findIndex((c) => c.uid === u);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  const splitClip = () => {
    const c = track.find((x) => x.uid === selectedUid);
    if (!c) return setError("Select a video clip to split.");
    const mid = c.start + (c.end - c.start) / 2;
    if (c.end - c.start < 0.6) return setError("Clip is too short to split.");
    setTrack((prev) =>
      prev.flatMap((x) =>
        x.uid === c.uid
          ? [
              { ...x, end: Number(mid.toFixed(2)) },
              { ...x, uid: uid("clip"), start: Number(mid.toFixed(2)) },
            ]
          : [x],
      ),
    );
  };

  const applyRecipe = (id: string) => {
    const r = palette?.recipes.find((x) => x.id === id);
    if (!r) return;
    const sel = track.find((c) => c.uid === selectedUid) ?? track[0];
    if (!sel) return setError("Add a clip first, then apply a recipe.");
    const preset: Record<string, Record<string, unknown>> = {
      "viral-hook": { clip: { look: "vivid", motion: "zoom-in" } },
      "cinematic-open": { clip: { look: "cinematic", motion: "zoom-out", transition: "fade", transitionSec: 0.8 } },
      "podcast-clip": { clip: { look: "crisp" } },
      "retro-vhs": { clip: { look: "vintage", motion: "shake" } },
      "aesthetic-bw": { clip: { look: "bw", motion: "pan-right" } },
      "neon-night": { clip: { look: "neon", motion: "pulse" } },
      tutorial: { clip: { look: "crisp", motion: "none" } },
      "face-zoom": { clip: { look: "vivid", motion: "zoom-in", zoom: 1.35 } },
    };
    const p = preset[id]?.clip ?? {};
    patchClip(sel.uid, p as Partial<EditClip>);
    if (id === "podcast-clip") setAspect("16:9");
  };

  const render = async () => {
    if (!track.length) return setError("Add at least one clip.");
    setBusy(true);
    setError(null);
    try {
      const body = {
        title,
        aspect,
        sound,
        fx,
        pitch,
        clips: track.map((c) => ({
          source: c.source,
          start: c.start,
          end: c.end,
          speed: c.speed,
          reverse: c.reverse,
          zoom: c.zoom,
          motion: c.motion,
          look: c.look,
          volume: c.volume,
          mute: c.mute,
          transition: c.transition,
          transitionSec: c.transitionSec,
        })),
        texts: texts.map((t) => ({
          text: t.text,
          at: t.at,
          duration: t.duration,
          position: t.position,
          animation: t.animation,
          color: t.color,
          size: t.size,
          box: t.box,
        })),
        overlays: overlays.map((o) => ({
          source: o.source,
          at: o.at,
          duration: o.duration,
          x: o.x,
          y: o.y,
          width: o.width,
          opacity: o.opacity,
          rotate: o.rotate,
          fade: 0.2,
        })),
        audios: audios.map((a) => ({
          source: a.source,
          at: a.at,
          volume: a.volume,
          loop: a.loop,
          duckToClips: a.duck,
          end: total,
        })),
      };
      const res = await fetch("/api/studio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? json.details?.join?.("; ") ?? "Render failed");
      onRendered(json.clip as ClipRecord);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const selected =
    track.find((c) => c.uid === selectedUid) ??
    texts.find((t) => t.uid === selectedUid) ??
    overlays.find((o) => o.uid === selectedUid) ??
    audios.find((a) => a.uid === selectedUid) ??
    null;

  const selKind = selected
    ? track.some((c) => c.uid === selectedUid)
      ? "clip"
      : texts.some((t) => t.uid === selectedUid)
        ? "text"
        : overlays.some((o) => o.uid === selectedUid)
          ? "overlay"
          : "audio"
    : null;

  return (
    <div className="space-y-4">
      {/* ── header ── */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-45 flex-1">
            <span className="label">Project name</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My edit" />
          </label>
          <div>
            <span className="label">Aspect</span>
            <div className="flex gap-1">
              {ASPECTS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setAspect(a.key)}
                  title={a.hint}
                  className={`btn-ghost px-2.5 py-1.5 text-xs ${aspect === a.key ? "!border-brand/60 !text-brand-2" : ""}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-40">
              <span className="label">Sound</span>
              <select className="input" value={sound} onChange={(e) => setSound(e.target.value)}>
                {palette?.sounds.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
            <label className="min-w-36">
              <span className="label">Video FX</span>
              <select className="input" value={fx} onChange={(e) => setFx(e.target.value)}>
                {palette?.fx.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </label>
            <div>
              <span className="label">Pitch {pitch > 0 ? `+${pitch}` : pitch}</span>
              <input type="range" min={-12} max={12} step={1} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} className="w-24 accent-[var(--brand)]" />
            </div>
          </div>
          <div className="mono ml-auto text-right text-[11px] text-muted">
            <div>{track.length} clips · {texts.length} titles · {overlays.length} stickers · {audios.length} music</div>
            {palette?.counts && (
              <div className="text-[10px] text-muted/70">
                {palette.counts.transitions} transitions · {palette.counts.sounds} sound presets · {palette.counts.fx} video FX
              </div>
            )}
            <div className="text-brand-2">{fmtTime(total)} timeline</div>
          </div>
        </div>
      </div>

      {/* ── one-tap recipes ── */}
      <div className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">One-tap recipes</h3>
          <span className="text-[11px] text-muted">applies to the selected clip</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {palette?.recipes.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => applyRecipe(r.id)}
              title={r.blurb}
              className="btn-ghost px-2.5 py-1.5 text-xs"
            >
              <span className="mr-1">{r.emoji}</span>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── sources ── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="card p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Timeline</h3>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={splitClip}>
                ✂️ Split
              </button>
              <label className="btn-ghost cursor-pointer px-2.5 py-1.5 text-xs">
                {uploading ? <Spinner /> : "⬆"} Upload
                <input
                  type="file"
                  accept="video/*,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void addFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                className="btn-ghost px-2.5 py-1.5 text-xs"
                onClick={() =>
                  setTexts((prev) => [
                    ...prev,
                    {
                      uid: uid("text"),
                      text: "New title",
                      at: playhead,
                      duration: 3,
                      position: "bottom",
                      animation: "fade",
                      color: "#ffffff",
                      box: true,
                    },
                  ])
                }
              >
                T Title
              </button>
              <button
                type="button"
                className="btn-ghost px-2.5 py-1.5 text-xs"
                onClick={() =>
                  setOverlays((prev) => [
                    ...prev,
                    {
                      uid: uid("ov"),
                      source: "/emoji/star.png",
                      label: "star",
                      at: playhead,
                      duration: 2.5,
                      x: 0.75,
                      y: 0.2,
                      width: 0.22,
                      opacity: 1,
                      rotate: 0,
                    },
                  ])
                }
              >
                ✦ Sticker
              </button>
              <button
                type="button"
                className="btn-primary px-3 py-1.5 text-xs"
                onClick={render}
                disabled={busy || !track.length}
              >
                {busy ? <Spinner /> : "▶"} Export MP4
              </button>
            </div>
          </div>

          <TimelineEditor
            clips={track}
            texts={texts}
            overlays={overlays}
            audios={audios}
            total={total}
            playhead={playhead}
            selectedUid={selectedUid}
            onSelect={setSelectedUid}
            onSeek={setPlayhead}
            onMoveClip={moveClip}
          />

          {error && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          {busy && <p className="mt-3 text-xs text-muted">Rendering every track into one MP4 — this is real ffmpeg work, a 30s edit takes ~15–60s.</p>}

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Library</h4>
              <span className="text-[11px] text-muted">{clips.length} clips</span>
            </div>
            <div className="grid max-h-52 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {clips.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => addClip(c)}
                  className="flex items-center gap-2 rounded-lg border border-line bg-white/[0.02] p-2 text-left transition hover:border-brand/50 hover:bg-white/[0.05]"
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand/15 text-sm">🎞</div>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{c.title}</div>
                    <div className="mono text-[10px] text-muted">{fmtTime(c.durationSec)} · {(c.sizeBytes / 1e6).toFixed(1)} MB</div>
                  </div>
                </button>
              ))}
              {!clips.length && (
                <p className="col-span-2 rounded-lg border border-dashed border-line p-4 text-center text-xs text-muted">
                  No clips yet — make one in the Studio tab, or upload a file above.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── inspector ── */}
        <div className="card space-y-3 p-4">
          <h3 className="text-sm font-semibold">Inspector</h3>
          {!selected && <p className="text-xs text-muted">Select a block on the timeline to edit it.</p>}

          {selected && selKind === "clip" && (
            <ClipInspector
              clip={selected as EditClip}
              palette={palette}
              onPatch={(p) => patchClip((selected as EditClip).uid, p)}
              onRemove={() => {
                setTrack((prev) => prev.filter((c) => c.uid !== selected.uid));
                setSelectedUid(null);
              }}
            />
          )}

          {selected && selKind === "text" && (
            <TextInspector
              text={selected as EditText}
              onPatch={(p) => patchText((selected as EditText).uid, p)}
              onRemove={() => {
                setTexts((prev) => prev.filter((t) => t.uid !== selected.uid));
                setSelectedUid(null);
              }}
            />
          )}

          {selected && selKind === "overlay" && (
            <OverlayInspector
              overlay={selected as EditOverlay}
              onPatch={(p) => patchOverlay((selected as EditOverlay).uid, p)}
              onRemove={() => {
                setOverlays((prev) => prev.filter((o) => o.uid !== selected.uid));
                setSelectedUid(null);
              }}
            />
          )}

          {selected && selKind === "audio" && (
            <AudioInspector
              audio={selected as EditAudio}
              onPatch={(p) => patchAudio((selected as EditAudio).uid, p)}
              onRemove={() => {
                setAudios((prev) => prev.filter((a) => a.uid !== selected.uid));
                setSelectedUid(null);
              }}
            />
          )}

          {/* add music */}
          <div className="border-t border-line pt-3">
            <span className="label">Music / voiceover</span>
            <MusicPanel
              onPick={(src, label) =>
                setAudios((prev) => [
                  ...prev,
                  { uid: uid("audio"), source: src, label, at: 0, volume: 0.3, loop: true, duck: true },
                ])
              }
            />
          </div>

          <div className="border-t border-line pt-3">
            <span className="label">Sticker image URL</span>
            <StickerAdder
              onAdd={(url) =>
                setOverlays((prev) => [
                  ...prev,
                  { uid: uid("ov"), source: url, label: url.split("/").pop()?.slice(0, 12) ?? "sticker", at: playhead, duration: 2.5, x: 0.5, y: 0.25, width: 0.25, opacity: 1, rotate: 0 },
                ])
              }
            />
          </div>
        </div>
      </div>

      {/* ── capability board ── */}
      {palette?.capabilities && (
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">What this editor can do</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {palette.capabilities.map((g) => (
              <div key={g.group} className="rounded-lg border border-line bg-white/[0.02] p-3">
                <div className="mb-1 text-xs font-semibold text-brand-2">{g.group}</div>
                <ul className="space-y-0.5">
                  {g.items.map((i) => (
                    <li key={i} className="text-[11px] leading-relaxed text-muted">· {i}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── inspectors ─────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Slider({ value, min, max, step, onChange, suffix }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-[var(--brand)]" />
      <span className="mono w-12 text-right text-[11px] text-muted">{value.toFixed(step < 1 ? 2 : 0)}{suffix}</span>
    </div>
  );
}

function ClipInspector({ clip, palette, onPatch, onRemove }: { clip: EditClip; palette: Palette | null; onPatch: (p: Partial<EditClip>) => void; onRemove: () => void }) {
  return (
    <div className="space-y-3">
      <div className="mono truncate rounded-md bg-white/5 px-2 py-1 text-[10px] text-muted">{clip.source}</div>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Start (s)">
          <input type="number" step={0.1} min={0} className="input" value={clip.start} onChange={(e) => onPatch({ start: Math.max(0, Number(e.target.value)) })} />
        </Row>
        <Row label="End (s)">
          <input type="number" step={0.1} min={0.1} className="input" value={clip.end} onChange={(e) => onPatch({ end: Math.max(clip.start + 0.2, Number(e.target.value)) })} />
        </Row>
      </div>
      <Row label={`Speed ${clip.speed.toFixed(2)}×`}>
        <Slider value={clip.speed} min={0.25} max={4} step={0.05} onChange={(v) => onPatch({ speed: v })} suffix="×" />
      </Row>
      <Row label={`Zoom ${clip.zoom.toFixed(2)}×`}>
        <Slider value={clip.zoom} min={1} max={3} step={0.05} onChange={(v) => onPatch({ zoom: v })} suffix="×" />
      </Row>
      <Row label={`Volume ${Math.round(clip.volume * 100)}%`}>
        <Slider value={clip.volume} min={0} max={2} step={0.05} onChange={(v) => onPatch({ volume: v })} />
      </Row>
      <Row label="Look">
        <select className="input" value={clip.look} onChange={(e) => onPatch({ look: e.target.value })}>
          {palette?.looks.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
      </Row>
      <Row label="Motion">
        <select className="input" value={clip.motion} onChange={(e) => onPatch({ motion: e.target.value })}>
          {palette?.motions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Transition out">
          <select className="input" value={clip.transition} onChange={(e) => onPatch({ transition: e.target.value })}>
            {palette?.transitions.map((t) => (
              <option key={t} value={t}>{palette.transitionLabels?.[t] ?? t}</option>
            ))}
          </select>
        </Row>
        <Row label="Transition (s)">
          <input type="number" step={0.1} min={0.1} max={2} className="input" value={clip.transitionSec} onChange={(e) => onPatch({ transitionSec: Math.min(2, Math.max(0.1, Number(e.target.value))) })} />
        </Row>
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className={`btn-ghost px-2.5 py-1 text-xs ${clip.mute ? "!border-danger/60 !text-danger" : ""}`} onClick={() => onPatch({ mute: !clip.mute })}>
          {clip.mute ? "🔇 Muted" : "🔊 Audio on"}
        </button>
        <button type="button" className={`btn-ghost px-2.5 py-1 text-xs ${clip.reverse ? "!border-brand/60 !text-brand-2" : ""}`} onClick={() => onPatch({ reverse: !clip.reverse })}>
          ⏪ Reverse
        </button>
        <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={() => onPatch({ look: "none", motion: "none", zoom: 1, speed: 1 })}>
          Reset
        </button>
        <button type="button" className="btn-ghost ml-auto px-2.5 py-1 text-xs !text-danger" onClick={onRemove}>
          Delete
        </button>
      </div>
      <div className="mono text-[10px] text-muted">Segment length: {(clipLen(clip)).toFixed(2)}s</div>
    </div>
  );
}

function TextInspector({ text, onPatch, onRemove }: { text: EditText; onPatch: (p: Partial<EditText>) => void; onRemove: () => void }) {
  return (
    <div className="space-y-3">
      <Row label="Text">
        <textarea className="input min-h-16" value={text.text} onChange={(e) => onPatch({ text: e.target.value })} />
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Row label="At (s)">
          <input type="number" step={0.1} min={0} className="input" value={text.at} onChange={(e) => onPatch({ at: Math.max(0, Number(e.target.value)) })} />
        </Row>
        <Row label="Duration (s)">
          <input type="number" step={0.1} min={0.3} className="input" value={text.duration} onChange={(e) => onPatch({ duration: Math.max(0.3, Number(e.target.value)) })} />
        </Row>
      </div>
      <Row label="Position">
        <select className="input" value={text.position} onChange={(e) => onPatch({ position: e.target.value })}>
          {["top", "center", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </Row>
      <Row label="Animation">
        <select className="input" value={text.animation} onChange={(e) => onPatch({ animation: e.target.value })}>
          {["none", "fade", "slide-up", "pop", "typewriter"].map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </Row>
      <Row label={`Size ${text.size ?? "auto"}`}>
        <Slider value={text.size ?? 64} min={16} max={200} step={1} onChange={(v) => onPatch({ size: v })} />
      </Row>
      <div>
        <span className="label">Colour</span>
        <div className="flex gap-1.5">
          {COLORS.map((c) => (
            <button key={c} type="button" onClick={() => onPatch({ color: c })} className={`h-6 w-6 rounded-full ring-2 ${text.color === c ? "ring-white" : "ring-transparent"}`} style={{ background: c }} />
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" className={`btn-ghost px-2.5 py-1 text-xs ${text.box ? "!border-brand/60 !text-brand-2" : ""}`} onClick={() => onPatch({ box: !text.box })}>
          ▭ Box
        </button>
        <button type="button" className="btn-ghost ml-auto px-2.5 py-1 text-xs !text-danger" onClick={onRemove}>
          Delete
        </button>
      </div>
    </div>
  );
}

function OverlayInspector({ overlay, onPatch, onRemove }: { overlay: EditOverlay; onPatch: (p: Partial<EditOverlay>) => void; onRemove: () => void }) {
  return (
    <div className="space-y-3">
      <div className="mono truncate rounded-md bg-white/5 px-2 py-1 text-[10px] text-muted">{overlay.source}</div>
      <div className="grid grid-cols-2 gap-2">
        <Row label="At (s)">
          <input type="number" step={0.1} min={0} className="input" value={overlay.at} onChange={(e) => onPatch({ at: Math.max(0, Number(e.target.value)) })} />
        </Row>
        <Row label="Duration (s)">
          <input type="number" step={0.1} min={0.3} className="input" value={overlay.duration} onChange={(e) => onPatch({ duration: Math.max(0.3, Number(e.target.value)) })} />
        </Row>
      </div>
      <Row label={`X ${Math.round(overlay.x * 100)}%`}>
        <Slider value={overlay.x} min={0} max={1} step={0.01} onChange={(v) => onPatch({ x: v })} />
      </Row>
      <Row label={`Y ${Math.round(overlay.y * 100)}%`}>
        <Slider value={overlay.y} min={0} max={1} step={0.01} onChange={(v) => onPatch({ y: v })} />
      </Row>
      <Row label={`Size ${Math.round(overlay.width * 100)}%`}>
        <Slider value={overlay.width} min={0.05} max={1} step={0.01} onChange={(v) => onPatch({ width: v })} />
      </Row>
      <Row label={`Opacity ${Math.round(overlay.opacity * 100)}%`}>
        <Slider value={overlay.opacity} min={0} max={1} step={0.01} onChange={(v) => onPatch({ opacity: v })} />
      </Row>
      <Row label={`Rotate ${Math.round(overlay.rotate)}°`}>
        <Slider value={overlay.rotate} min={-180} max={180} step={1} onChange={(v) => onPatch({ rotate: v })} suffix="°" />
      </Row>
      <button type="button" className="btn-ghost px-2.5 py-1 text-xs !text-danger" onClick={onRemove}>
        Delete
      </button>
    </div>
  );
}

function AudioInspector({ audio, onPatch, onRemove }: { audio: EditAudio; onPatch: (p: Partial<EditAudio>) => void; onRemove: () => void }) {
  return (
    <div className="space-y-3">
      <div className="mono truncate rounded-md bg-white/5 px-2 py-1 text-[10px] text-muted">{audio.source}</div>
      <Row label={`Volume ${Math.round(audio.volume * 100)}%`}>
        <Slider value={audio.volume} min={0} max={1.5} step={0.05} onChange={(v) => onPatch({ volume: v })} />
      </Row>
      <Row label="Starts at (s)">
        <input type="number" step={0.1} min={0} className="input" value={audio.at} onChange={(e) => onPatch({ at: Math.max(0, Number(e.target.value)) })} />
      </Row>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`btn-ghost px-2.5 py-1 text-xs ${audio.loop ? "!border-brand/60 !text-brand-2" : ""}`} onClick={() => onPatch({ loop: !audio.loop })}>
          🔁 Loop
        </button>
        <button type="button" className={`btn-ghost px-2.5 py-1 text-xs ${audio.duck ? "!border-brand/60 !text-brand-2" : ""}`} onClick={() => onPatch({ duck: !audio.duck })}>
          ⤵ Duck under voice
        </button>
      </div>
      <button type="button" className="btn-ghost px-2.5 py-1 text-xs !text-danger" onClick={onRemove}>
        Delete
      </button>
    </div>
  );
}

function StickerAdder({ onAdd }: { onAdd: (url: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="flex gap-2">
      <input className="input" placeholder="https://…/sticker.png" value={v} onChange={(e) => setV(e.target.value)} />
      <button
        type="button"
        className="btn-ghost shrink-0 px-2.5 py-1 text-xs"
        onClick={() => {
          if (!v.trim()) return;
          onAdd(v.trim());
          setV("");
        }}
      >
        Add
      </button>
    </div>
  );
}
