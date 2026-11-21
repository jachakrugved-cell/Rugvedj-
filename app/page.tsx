"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConnectView from "@/components/ConnectView";
import LibraryView from "@/components/LibraryView";
import LiveView from "@/components/LiveView";
import StudioView from "@/components/StudioView";
import { Chip } from "@/components/ui";
import type {
  AspectRatio,
  CaptionStyleName,
  ClipRecord,
  Health,
  SourceInfo,
  Task,
} from "@/lib/types";

type Tab = "studio" | "live" | "library" | "connect";

const EMPTY_RANGE = { start: 0, end: 0 };

export default function App() {
  const [tab, setTab] = useState<Tab>("studio");
  const [url, setUrl] = useState("");
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [range, setRange] = useState(EMPTY_RANGE);
  const [seekTo, setSeekTo] = useState<number | undefined>(undefined);

  const [aspect, setAspect] = useState<AspectRatio>("9:16");
  const [style, setStyle] = useState<CaptionStyleName>("clean");
  const [captionsOn, setCaptionsOn] = useState(false);
  const [captionText, setCaptionText] = useState("");
  const [title, setTitle] = useState("");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [clips, setClips] = useState<ClipRecord[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [clipping, setClipping] = useState(false);
  const [recording, setRecording] = useState(false);
  const [liveSecs, setLiveSecs] = useState(60);
  const [lastResult, setLastResult] = useState<ClipRecord | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6500);
  }, []);

  const refreshClips = useCallback(async () => {
    try {
      const r = await fetch("/api/clips", { cache: "no-store" });
      const j = (await r.json()) as { clips: ClipRecord[] };
      setClips(j.clips ?? []);
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
    refreshClips();
  }, [refreshClips]);

  // live task feed
  useEffect(() => {
    const es = new EventSource("/api/tasks?stream=1");
    es.addEventListener("snapshot", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { tasks: Task[] };
      setTasks(d.tasks ?? []);
    });
    es.addEventListener("task", (e) => {
      const t = JSON.parse((e as MessageEvent).data) as Task;
      setTasks((prev) => {
        const idx = prev.findIndex((p) => p.id === t.id);
        if (idx < 0) return [t, ...prev].slice(0, 40);
        const next = [...prev];
        next[idx] = t;
        return next;
      });
      if (t.state === "done" && t.kind !== "download") refreshClips();
      if (t.state === "error") notify("err", t.message);
    });
    return () => es.close();
  }, [refreshClips, notify]);

  const probe = useCallback(
    async (raw: string) => {
      const target = raw.trim();
      if (!target) return;
      setUrl(target);
      setTab("studio");
      setLoading(true);
      setProbeError(null);
      setSource(null);
      setLastResult(null);
      try {
        const r = await fetch("/api/probe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: target }),
        });
        const j = (await r.json()) as SourceInfo & { ok?: boolean; error?: string };
        if (!r.ok || j.ok === false) throw new Error(j.error ?? "Could not read that link.");
        setSource(j);
        setTitle(j.title ?? "");
        const d = j.durationSec ?? 0;
        setDuration(d);
        setCurrent(0);
        setSeekTo(0);
        if (j.isLive) {
          setRange(EMPTY_RANGE);
        } else if (d > 0) {
          const start = Math.min(15, Math.max(0, Math.round(d * 0.05)));
          const end = Math.min(d, Math.max(start + 30, Math.round(d * 0.35)));
          setRange({ start, end });
        }
      } catch (err) {
        setProbeError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const previewSrc = useMemo(() => {
    if (!source?.previewUrl) return "";
    if (source.previewType === "hls" && source.needsProxy) {
      return `/api/media-proxy?u=${encodeURIComponent(source.previewUrl)}${
        source.headers?.Referer ? `&ref=${encodeURIComponent(source.headers.Referer)}` : ""
      }`;
    }
    return source.previewUrl;
  }, [source]);

  const deleteClip = useCallback(
    async (id: string) => {
      await fetch(`/api/clips/${id}`, { method: "DELETE" });
      await refreshClips();
      if (lastResult?.id === id) setLastResult(null);
    },
    [refreshClips, lastResult],
  );

  const reclip = useCallback(
    (clip: ClipRecord) => {
      probe(clip.sourceUrl);
    },
    [probe],
  );

  const clipNow = useCallback(async () => {
    if (!source) return;
    if (!(range.end > range.start)) {
      notify("err", "Set a valid in/out range first.");
      return;
    }
    setClipping(true);
    setLastResult(null);
    try {
      const r = await fetch("/api/clips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: source.inputUrl,
          start: range.start,
          end: range.end,
          title: title || undefined,
          aspect,
          captions: captionsOn ? captionText : undefined,
          captionStyle: style,
        }),
      });
      const j = (await r.json()) as { ok?: boolean; clip?: ClipRecord; error?: string };
      if (!r.ok || j.ok === false || !j.clip) throw new Error(j.error ?? "Clip failed.");
      setLastResult(j.clip);
      notify("ok", `Clip ready — ${j.clip.fileName}`);
      await refreshClips();
    } catch (err) {
      notify("err", err instanceof Error ? err.message : String(err));
    } finally {
      setClipping(false);
    }
  }, [source, range, title, aspect, captionsOn, captionText, style, notify, refreshClips]);

  const recordNow = useCallback(async () => {
    if (!source) return;
    setRecording(true);
    try {
      const r = await fetch("/api/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: source.inputUrl, durationSec: liveSecs, title: title || undefined }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; fileName?: string };
      if (!r.ok || j.ok === false) throw new Error(j.error ?? "Recording failed.");
      notify("ok", `Recorded live buffer → ${j.fileName}. Clip it from the Library.`);
      await refreshClips();
    } catch (err) {
      notify("err", err instanceof Error ? err.message : String(err));
    } finally {
      setRecording(false);
    }
  }, [source, liveSecs, title, notify, refreshClips]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1480px] flex-col px-4 pb-16 pt-5 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand via-[#6f8cff] to-brand-2 text-lg font-black text-[#0a0a12] shadow-[0_10px_30px_-10px_rgba(139,108,255,0.8)]">
            ✂
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-bold leading-none tracking-tight">
              ClipForge
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted">
                free · local · claude-ready
              </span>
            </h1>
            <p className="mt-1 text-[11.5px] text-muted">Any link → any moment → a clean clip</p>
          </div>
        </div>
        <nav className="flex items-center gap-1 rounded-full border border-line bg-black/30 p-1">
          {(
            [
              ["studio", "Studio"],
              ["live", "Live"],
              ["library", `Library${clips.length ? ` · ${clips.length}` : ""}`],
              ["connect", "Connect"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className="pill-tab" data-active={tab === k} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      {tab === "studio" && (
        <StudioView
          url={url}
          setUrl={setUrl}
          onProbe={probe}
          loading={loading}
          probeError={probeError}
          source={source}
          previewSrc={previewSrc}
          duration={duration}
          current={current}
          range={range}
          setRange={setRange}
          seekTo={seekTo}
          onSeek={(t) => {
            setCurrent(t);
            if (seekTo !== undefined && Math.abs(t - seekTo) < 0.05) return;
            setSeekTo(t);
          }}
          aspect={aspect}
          setAspect={setAspect}
          style={style}
          setStyle={setStyle}
          captionText={captionText}
          setCaptionText={setCaptionText}
          captionsOn={captionsOn}
          setCaptionsOn={setCaptionsOn}
          title={title}
          setTitle={setTitle}
          clipping={clipping}
          onClip={clipNow}
          lastResult={lastResult}
          onDeleteClip={deleteClip}
          onReclip={reclip}
          clips={clips}
          tasks={tasks}
          health={health}
          onOpenLibrary={() => setTab("library")}
          onRecordLive={recordNow}
          recording={recording}
          liveSecs={liveSecs}
          setLiveSecs={setLiveSecs}
        />
      )}

      {tab === "live" && (
        <LiveView
          tasks={tasks}
          clips={clips}
          onClipRecorded={(fileName) => {
            probe(`/api/media/${encodeURIComponent(fileName)}`);
          }}
        />
      )}

      {tab === "library" && (
        <LibraryView
          clips={clips}
          tasks={tasks}
          onDeleteClip={deleteClip}
          onReclip={reclip}
          onRefresh={refreshClips}
        />
      )}

      {tab === "connect" && <ConnectView health={health} />}

      <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[10.5px] text-[#5d6479]">
        <span>
          ClipForge · MIT · powered by ffmpeg{health?.ytdlp.ok ? " + yt-dlp" : ""} · runs entirely on
          your machine
        </span>
        <span className="flex items-center gap-2">
          <Chip tone={health?.ok ? "ok" : "live"}>{health?.ok ? "engine online" : "engine check"}</Chip>
          <span className="mono">v1.0.0</span>
        </span>
      </footer>

      {toast && (
        <div
          className={`fixed bottom-5 left-1/2 z-50 w-[min(92vw,540px)] -translate-x-1/2 rounded-xl border px-4 py-2.5 text-xs font-medium shadow-2xl fade-in ${
            toast.kind === "ok"
              ? "border-emerald-500/40 bg-[#0b1a15] text-emerald-100"
              : "border-rose-500/40 bg-[#1b0b10] text-rose-100"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
