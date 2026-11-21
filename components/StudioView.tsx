"use client";

import { useEffect, useMemo, useState } from "react";
import ClipCard from "@/components/ClipCard";
import HlsPlayer from "@/components/HlsPlayer";
import Timeline from "@/components/Timeline";
import { Chip, Env, PlayGlyph, QuickAction, Spinner, TaskRow, TimeInput, Toggle } from "@/components/ui";
import { fmtTime } from "@/lib/time";
import type {
  AspectRatio,
  CaptionStyleName,
  ClipRecord,
  Health,
  SourceInfo,
  Task,
} from "@/lib/types";
import ConnectPanel from "@/components/ConnectPanel";

export const ASPECTS: { key: AspectRatio; label: string; hint: string }[] = [
  { key: "original", label: "Original", hint: "Keep source framing" },
  { key: "9:16", label: "9:16", hint: "Reels · Shorts · TikTok" },
  { key: "1:1", label: "1:1", hint: "Square posts" },
  { key: "4:5", label: "4:5", hint: "Instagram feed" },
  { key: "16:9", label: "16:9", hint: "YouTube" },
  { key: "4:3", label: "4:3", hint: "Classic" },
];

export const STYLES: { key: CaptionStyleName; label: string }[] = [
  { key: "clean", label: "Clean" },
  { key: "bold", label: "Bold" },
  { key: "karaoke", label: "Karaoke" },
  { key: "highlight", label: "Highlight" },
  { key: "neon", label: "Neon" },
  { key: "minimal", label: "Minimal" },
];

export type StudioProps = {
  url: string;
  setUrl: (v: string) => void;
  onProbe: (url: string) => void;
  loading: boolean;
  probeError: string | null;
  source: SourceInfo | null;
  previewSrc: string;
  duration: number;
  current: number;
  range: { start: number; end: number };
  setRange: (r: { start: number; end: number }) => void;
  seekTo?: number;
  onSeek: (t: number) => void;
  aspect: AspectRatio;
  setAspect: (a: AspectRatio) => void;
  style: CaptionStyleName;
  setStyle: (s: CaptionStyleName) => void;
  captionText: string;
  setCaptionText: (v: string) => void;
  captionsOn: boolean;
  setCaptionsOn: (v: boolean) => void;
  title: string;
  setTitle: (v: string) => void;
  motion: string;
  setMotion: (v: string) => void;
  template: string;
  setTemplate: (v: string) => void;
  clipping: boolean;
  onClip: () => void;
  lastResult: ClipRecord | null;
  onDeleteClip: (id: string) => Promise<void>;
  onReclip: (clip: ClipRecord) => void;
  clips: ClipRecord[];
  tasks: Task[];
  health: Health | null;
  onOpenLibrary: () => void;
  onRecordLive: () => void;
  recording: boolean;
  liveSecs: number;
  setLiveSecs: (n: number) => void;
};

export default function StudioView(props: StudioProps) {
  const {
    url, setUrl, onProbe, loading, probeError, source, previewSrc, duration, current,
    range, setRange, seekTo, onSeek, aspect, setAspect, style, setStyle, captionText,
    setCaptionText, captionsOn, setCaptionsOn, title, setTitle, clipping, onClip,
    lastResult, onDeleteClip, onReclip, clips, tasks, health, onOpenLibrary,
    motion, setMotion, template, setTemplate,
  } = props;

  const [thumbnail] = useState(true);
  const thumbUrl = useMemo(
    () => (thumbnail && source ? `/api/frame?url=${encodeURIComponent(source.inputUrl)}` : undefined),
    [thumbnail, source],
  );
  const activeTask = tasks.find(
    (t) => (t.state === "running" || t.state === "queued") && t.kind !== "download",
  );
  const downloadTask = tasks.find(
    (t) => (t.state === "running" || t.state === "queued") && t.kind === "download",
  );

  return (
    <main className="mt-5 grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
      {/* ───────────────────────── left column ───────────────────────── */}
      <section className="min-w-0 space-y-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onProbe(url);
          }}
          className="glass relative overflow-hidden rounded-2xl p-4 sm:p-5"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight">
              Paste any video link
              <span className="ml-2 text-xs font-normal text-muted">
                YouTube · Vimeo · Twitch · MP4 · HLS/DASH · live streams
              </span>
            </h2>
            <Chip tone="ok">100% local · free</Chip>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">🔗</span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=… or https://example.com/live.m3u8"
                className="input !pl-9"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <button className="btn btn-primary" disabled={loading || !url.trim()} type="submit">
              {loading ? <Spinner /> : "Load video"}
            </button>
          </div>
          <YoutubeBanner />

          {probeError && (
            <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {probeError}
            </p>
          )}
        </form>

        {/* player */}
        <div className="glass overflow-hidden rounded-2xl">
          <div className="relative aspect-video w-full bg-black">
            {!source && !loading && (
              <div className="grid-lines absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(600px_300px_at_50%_30%,rgba(139,108,255,0.16),transparent)]">
                <PlayGlyph />
                <p className="text-sm font-medium text-muted">Drop a link above to start clipping</p>
                <div className="flex flex-wrap justify-center gap-2 text-[11px]">
                  {["youtube.com/watch?v=…", "twitch.tv/<channel>", "…/live.m3u8", "…/video.mp4"].map((s) => (
                    <span key={s} className="chip mono">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <Spinner size={26} />
                <p className="text-xs text-muted">
                  {health?.ytdlp.ok === false
                    ? "Resolving link with the built-in fetcher…"
                    : "Resolving source with yt-dlp…"}
                </p>
              </div>
            )}
            {source && previewSrc && (
              <HlsPlayer
                src={previewSrc}
                live={source.isLive}
                seekRequest={seekTo}
                onTime={(t) => props.onSeek(t)}
                onDuration={(d) => {
                  if (d > 0 && Math.abs(d - duration) > 1) props.setRange({ ...range, end: Math.min(range.end, d) });
                }}
              />
            )}
            {source && !previewSrc && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                <p className="text-sm font-semibold">Preview unavailable</p>
                <p className="max-w-sm text-xs text-muted">
                  The link is readable by the clip engine, but this stream can&apos;t be played in a
                  browser. You can still cut it — set in/out with the inputs below.
                </p>
              </div>
            )}
          </div>

          {source && (
            <div className="space-y-3 border-t border-line p-4">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <Chip tone="brand">{source.kind.toUpperCase()}</Chip>
                {source.isLive && (
                  <Chip tone="live">
                    <span className="live-dot" /> LIVE
                  </Chip>
                )}
                {source.width && source.height && <Chip><span className="mono">{source.width}×{source.height}</span></Chip>}
                {source.fps && <Chip><span className="mono">{source.fps} fps</span></Chip>}
                {source.vcodec && <Chip><span className="mono">{source.vcodec}</span></Chip>}
                {source.acodec && <Chip><span className="mono">{source.acodec}</span></Chip>}
                {source.durationSec !== null && <Chip><span className="mono">{fmtTime(source.durationSec)}</span></Chip>}
                {source.uploader && <Chip>{source.uploader}</Chip>}
              </div>

              {!source.isLive && duration > 0 && (
                <Timeline
                  duration={duration}
                  current={current}
                  start={range.start}
                  end={range.end}
                  thumbUrl={thumbUrl}
                  onChange={setRange}
                  onSeek={onSeek}
                />
              )}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <TimeInput
                  label="In"
                  value={range.start}
                  max={duration}
                  onCommit={(v) => setRange({ ...range, start: Math.min(v, range.end - 0.2) })}
                  onSeek={onSeek}
                />
                <TimeInput
                  label="Out"
                  value={range.end}
                  max={duration}
                  onCommit={(v) => setRange({ ...range, end: Math.max(v, range.start + 0.2) })}
                />
                <div className="col-span-2 flex items-end gap-2">
                  <QuickAction label="+15s" onClick={() => setRange({ ...range, end: Math.min(duration || Infinity, range.start + 15) })} />
                  <QuickAction label="Whole video" onClick={() => setRange({ start: 0, end: duration })} />
                  <QuickAction label="From playhead" onClick={() => setRange({ start: current, end: Math.min(duration || Infinity, current + 30) })} />
                </div>
              </div>

              {source.isLive && (
                <div className="rounded-xl border border-live/25 bg-live/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-rose-200">Live stream detected</p>
                      <p className="text-[11px] text-muted">
                        Record from the live edge, then clip the saved buffer.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={props.liveSecs}
                        onChange={(e) => props.setLiveSecs(Number(e.target.value))}
                        className="input !w-auto !py-1.5 !text-xs"
                      >
                        {[30, 60, 120, 300, 600].map((s) => (
                          <option key={s} value={s}>{fmtTime(s)}</option>
                        ))}
                      </select>
                      <button className="btn btn-live" onClick={props.onRecordLive} disabled={props.recording}>
                        {props.recording ? <Spinner /> : "● Record now"}
                      </button>
                    </div>
                  </div>
                  {props.recording && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="shimmer h-full w-full" />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {(activeTask || downloadTask) && (
          <div className="card space-y-3 p-4">
            {activeTask && <TaskRow t={activeTask} />}
            {downloadTask && <TaskRow t={downloadTask} />}
          </div>
        )}

        {clips.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Recent clips</h3>
              <button className="pill-tab" data-active onClick={onOpenLibrary}>
                View library →
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {clips.slice(0, 2).map((c) => (
                <ClipCard key={c.id} clip={c} onDelete={onDeleteClip} onReclip={onReclip} />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ───────────────────────── right column ───────────────────────── */}
      <aside className="min-w-0 space-y-5">
        <div className="glass rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Make a clip</h3>
            <span className="mono text-[11px] text-muted">
              {fmtTime(Math.max(0, range.end - range.start), true)}
            </span>
          </div>

          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">Title (optional)</label>
          <input
            className="input mb-4"
            placeholder="auto from the video"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted">Aspect ratio</label>
          <div className="mb-4 grid grid-cols-3 gap-1.5">
            {ASPECTS.map((a) => (
              <button
                key={a.key}
                onClick={() => setAspect(a.key)}
                title={a.hint}
                className={`rounded-xl border px-2 py-2 text-xs font-semibold transition ${
                  aspect === a.key
                    ? "border-brand/70 bg-brand/15 text-ink"
                    : "border-line bg-white/[0.02] text-muted hover:text-ink"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>

          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted">Motion &amp; template</label>
          <select
            className="input mb-2 !py-1.5 !text-xs"
            value={template}
            onChange={(e) => {
              const t = e.target.value;
              setTemplate(t);
              if (t === "shorts-hook") { setAspect("9:16"); setMotion("zoom-in"); setStyle("bold"); }
              if (t === "tiktok-karaoke") { setAspect("9:16"); setMotion("pulse"); setStyle("karaoke"); }
              if (t === "reels-clean") { setAspect("9:16"); setMotion("pan-right"); setStyle("clean"); }
              if (t === "podcast-clip") { setAspect("9:16"); setMotion("zoom-out"); setStyle("highlight"); }
              if (t === "cinematic") { setAspect("16:9"); setMotion("pan-left"); setStyle("minimal"); }
              if (t === "square-proof") { setAspect("1:1"); setMotion("zoom-in"); setStyle("clean"); }
              if (t === "raw") { setAspect("original"); setMotion("none"); }
            }}
          >
            <option value="custom">Custom (choose below)</option>
            <option value="shorts-hook">Shorts hook — 9:16 · zoom · bold</option>
            <option value="tiktok-karaoke">TikTok karaoke — 9:16 · pulse · karaoke</option>
            <option value="reels-clean">Reels clean — 9:16 · pan · clean</option>
            <option value="podcast-clip">Podcast clip — 9:16 · zoom-out · highlight</option>
            <option value="cinematic">Cinematic — 16:9 · pan · minimal</option>
            <option value="square-proof">Square proof — 1:1 · zoom</option>
            <option value="raw">Raw cut — original · no motion</option>
          </select>
          <div className="mb-4 flex flex-wrap gap-1">
            {[
              ["none", "Static"],
              ["zoom-in", "Zoom in"],
              ["zoom-out", "Zoom out"],
              ["pan-left", "Pan L"],
              ["pan-right", "Pan R"],
              ["shake", "Shake"],
              ["pulse", "Pulse"],
              ["whip", "Whip"],
            ].map(([k, l]) => (
              <button
                key={k}
                onClick={() => { setMotion(k); setTemplate("custom"); }}
                className={`rounded-lg border px-1.5 py-1 text-[10.5px] font-medium transition ${
                  motion === k ? "border-brand/60 bg-brand/15 text-ink" : "border-line text-muted hover:text-ink"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          <div className="mb-2 flex items-center justify-between">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted">Captions</label>
            <Toggle on={captionsOn} onChange={setCaptionsOn} label={captionsOn ? "On" : "Off"} />
          </div>
          {captionsOn && (
            <div className="mb-3 space-y-2 fade-in">
              <textarea
                className="input min-h-[96px] resize-y !text-xs"
                placeholder={"Paste SRT/VTT for perfect sync…\n\nor just type lines — they'll be timed across the clip, one line at a time."}
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value)}
              />
              <div className="flex flex-wrap gap-1.5">
                {STYLES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setStyle(s.key)}
                    className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                      style === s.key
                        ? "border-brand-2/60 bg-brand-2/10 text-brand-2"
                        : "border-line text-muted hover:text-ink"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            className="btn btn-primary mt-1 w-full !py-3 text-sm"
            disabled={!source || clipping || !(range.end > range.start)}
            onClick={onClip}
          >
            {clipping ? (
              <>
                <Spinner /> Cutting clip…
              </>
            ) : (
              <>✂ Cut {fmtTime(Math.max(0, range.end - range.start))} clip</>
            )}
          </button>
          <p className="mt-2 text-center text-[10.5px] text-muted">
            Nothing uploads. ffmpeg runs on this machine.
          </p>
        </div>

        {lastResult && (
          <div className="card fade-in p-4">
            <h3 className="mb-2 text-sm font-semibold">Last clip</h3>
            <ClipCard
              clip={lastResult}
              onDelete={async (id) => {
                await onDeleteClip(id);
              }}
              onReclip={onReclip}
            />
          </div>
        )}

        <ConnectPanel />

        <div className="card p-4 text-[11px] leading-relaxed text-muted">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Environment</h3>
            <Chip tone={health?.ok ? "ok" : "live"}>{health?.ok ? "ready" : "check"}</Chip>
          </div>
          <ul className="space-y-1.5">
            <Env ok={health?.ffmpeg.ok} label="ffmpeg" detail={health?.ffmpeg.version} />
            <Env ok={health?.ffprobe.ok} label="ffprobe" detail={health?.ffprobe.version} />
            <Env ok={health?.ytdlp.ok} label="yt-dlp" detail={health?.ytdlp.ok ? health?.ytdlp.version : "optional — run npm run setup"} />
          </ul>
          {health?.hint && <p className="mt-2 rounded-lg bg-amber-500/10 p-2 text-amber-200/90">{health.hint}</p>}
          <p className="mono mt-2 break-all text-[10px] text-[#5d6479]">data → {health?.dataDir}</p>
        </div>
      </aside>
    </main>
  );
}

/**
 * YouTube reachability banner. Yes, it is blunt on purpose: when the network
 * drops YouTube at the firewall there is nothing ClipForge can do, and the
 * user deserves to know that instead of a mystery spinner.
 */
function YoutubeBanner() {
  const [state, setState] = useState<{
    reachable: boolean;
    hint: string;
    cookies: string;
    version?: string;
  } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/youtube")
      .then((r) => r.json())
      .then((d) => alive && setState(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!state || state.reachable) return null;

  return (
    <div className="mb-3 rounded-xl border border-amber-400/35 bg-amber-400/10 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-semibold text-amber-200">⚠ YouTube unreachable from this machine</span>
        <span className="mono text-[10.5px] text-amber-200/70">yt-dlp {state.version ?? "?"} · cookies: {state.cookies}</span>
        <button
          type="button"
          className="ml-auto text-[11px] font-medium text-amber-200 underline underline-offset-2"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "hide" : "why + fix"}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-amber-100/80">
          <p>{state.hint}</p>
          <p className="text-amber-100/60">
            Distinct from a network block: &ldquo;Sign in to confirm you&rsquo;re not a bot&rdquo;. That one is a YouTube
            session check — fix it with cookies (<span className="mono">YTDLP_COOKIES_FROM_BROWSER=chrome</span>, or a
            <span className="mono"> cookies.txt </span> in <span className="mono">.data/</span>). ClipForge already
            retries 8 player clients automatically.
          </p>
          <p className="text-amber-100/50">Everything else still works: direct MP4, HLS/live links, and local uploads.</p>
        </div>
      )}
    </div>
  );
}
