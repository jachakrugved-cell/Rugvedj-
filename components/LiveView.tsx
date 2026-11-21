"use client";

import { useState } from "react";
import HlsPlayer from "@/components/HlsPlayer";
import { Chip, Spinner, TaskRow } from "@/components/ui";
import { fmtTime } from "@/lib/time";
import type { ClipRecord, Task } from "@/lib/types";

type LiveInfo = {
  ok?: boolean;
  isLive?: boolean;
  previewUrl?: string | null;
  previewType?: "hls" | "file" | "none";
  needsProxy?: boolean;
  title?: string;
  durationSec?: number | null;
  maxRecordSec?: number;
  error?: string;
};

type Recording = {
  fileName?: string;
  previewUrl?: string;
  durationSec?: number;
  error?: string;
};

export default function LiveView({
  tasks,
  clips,
  onClipRecorded,
}: {
  tasks: Task[];
  clips: ClipRecord[];
  onClipRecorded: (fileName: string, title: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<LiveInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [seconds, setSeconds] = useState(60);
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState<Recording | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async (raw: string) => {
    if (!raw.trim()) return;
    setChecking(true);
    setError(null);
    setInfo(null);
    setResult(null);
    try {
      const r = await fetch(`/api/live?url=${encodeURIComponent(raw.trim())}`, { cache: "no-store" });
      const j = (await r.json()) as LiveInfo;
      if (!r.ok || j.ok === false) throw new Error(j.error ?? "Could not read that link.");
      setInfo(j);
      if (typeof j.maxRecordSec === "number") setSeconds((s) => Math.min(s, j.maxRecordSec!));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  const record = async () => {
    if (!url.trim()) return;
    setRecording(true);
    setResult(null);
    setError(null);
    try {
      const r = await fetch("/api/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim(), durationSec: seconds }),
      });
      const j = (await r.json()) as Recording & { ok?: boolean };
      if (!r.ok || j.ok === false) throw new Error(j.error ?? "Recording failed.");
      setResult(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecording(false);
    }
  };

  const preview = info?.previewUrl
    ? info.needsProxy || /\.m3u8/i.test(info.previewUrl)
      ? `/api/media-proxy?u=${encodeURIComponent(info.previewUrl)}`
      : info.previewUrl
    : "";

  const liveTasks = tasks.filter((t) => t.kind === "record").slice(0, 3);
  const recordedCount = clips.filter((c) => c.aspect === "live-buffer").length;

  return (
    <main className="mt-5 grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="min-w-0 space-y-5">
        <div className="glass rounded-2xl p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <span className="live-dot" /> Live recorder
            </h2>
            <Chip tone="live">monitor the live edge → save locally</Chip>
          </div>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              check(url);
            }}
          >
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">📡</span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/live.m3u8 · https://twitch.tv/channel · https://youtube.com/live/…"
                className="input !pl-9"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <button className="btn btn-primary" disabled={checking || !url.trim()} type="submit">
              {checking ? <Spinner /> : "Check stream"}
            </button>
          </form>
          {error && (
            <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>
          )}
          {info?.ok && (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <Chip tone={info.isLive ? "live" : "brand"}>
                {info.isLive ? "LIVE" : "VOD / recorded"}
              </Chip>
              {info.previewType && info.previewType !== "none" && <Chip>{info.previewType.toUpperCase()}</Chip>}
              {info.durationSec ? <Chip><span className="mono">{fmtTime(info.durationSec)}</span></Chip> : null}
              {info.title && <Chip>{info.title}</Chip>}
              {!info.isLive && <Chip tone="ok">Tip: use the Studio tab for VOD links</Chip>}
            </div>
          )}
        </div>

        <div className="glass overflow-hidden rounded-2xl">
          <div className="relative aspect-video bg-black">
            {!preview && (
              <div className="grid-lines absolute inset-0 flex flex-col items-center justify-center gap-2">
                <p className="text-sm text-muted">Check a stream to preview it here</p>
                <p className="max-w-md px-6 text-center text-[11px] text-[#5d6479]">
                  HLS manifests, .mp4 live feeds, and page links (Twitch / YouTube live / Kick) are
                  resolved automatically through the local proxy.
                </p>
              </div>
            )}
            {preview && <HlsPlayer src={preview} live={!!info?.isLive} />}
          </div>
          {info?.previewUrl && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4">
              <div className="text-xs">
                <p className="font-semibold">Record {fmtTime(seconds)} from the live edge</p>
                <p className="text-[11px] text-muted">
                  Saved into your library as an MP4 you can clip again.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value))}
                  className="input !w-auto !py-2 !text-xs"
                >
                  {[15, 30, 60, 120, 300, 600, 900].map((s) => (
                    <option key={s} value={s}>{fmtTime(s)}</option>
                  ))}
                </select>
                <button className="btn btn-live" onClick={record} disabled={recording}>
                  {recording ? (
                    <>
                      <Spinner /> Recording…
                    </>
                  ) : (
                    "● Start recording"
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {recording && (
          <div className="card space-y-2 p-4">
            <p className="text-xs font-semibold text-rose-200">Recording live stream…</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="shimmer h-full w-full" />
            </div>
            <p className="text-[11px] text-muted">
              ffmpeg is writing the last {fmtTime(seconds)} of the stream. This page updates live.
            </p>
          </div>
        )}

        {liveTasks.length > 0 && (
          <div className="card space-y-3 p-4">
            <h3 className="text-sm font-semibold">Recordings</h3>
            {liveTasks.map((t) => (
              <TaskRow key={t.id} t={t} />
            ))}
          </div>
        )}

        {result?.previewUrl && (
          <div className="card fade-in overflow-hidden">
            <video src={result.previewUrl} controls className="aspect-video w-full bg-black object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
              <span className="mono truncate text-muted">{result.fileName}</span>
              <div className="flex gap-2">
                <a className="btn btn-ghost !py-1.5 text-xs" href={result.previewUrl} download>
                  Download
                </a>
                <button
                  className="btn btn-primary !py-1.5 text-xs"
                  onClick={() => onClipRecorded(result.fileName ?? "", result.fileName ?? "live")}
                >
                  ✂ Clip this →
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <aside className="min-w-0 space-y-5">
        <div className="card p-4 text-[11.5px] leading-relaxed text-muted">
          <h3 className="mb-2 text-sm font-semibold text-ink">How live clipping works</h3>
          <ol className="list-decimal space-y-2 pl-4">
            <li>
              <span className="text-ink">Resolve.</span> yt-dlp finds the live HLS manifest behind a
              page link (Twitch, YouTube live). Direct <code className="mono">.m3u8</code> URLs skip
              this step.
            </li>
            <li>
              <span className="text-ink">Proxy.</span> The manifest and every segment are streamed
              through the local server so the browser can play them and ffmpeg can record them.
            </li>
            <li>
              <span className="text-ink">Record.</span> ffmpeg captures N seconds from the live edge
              into a fragmented MP4, then remuxes it to a seekable file.
            </li>
            <li>
              <span className="text-ink">Clip.</span> Load the recording in Studio and cut the moment
              you want — captions, vertical crops, all local.
            </li>
          </ol>
          <div className="mt-3 rounded-lg border border-line bg-black/30 p-2.5">
            <p className="font-semibold text-ink">Test it without a live source</p>
            <p className="mt-1">
              Run <code className="mono text-emerald-300">npm run demo:live</code> in another terminal,
              then paste <code className="mono break-all text-emerald-300">http://127.0.0.1:8080/live.m3u8</code>{" "}
              here.
            </p>
          </div>
          <p className="mt-3 text-[10.5px]">
            Only record streams you have the rights to. Recordings stay on this machine in{" "}
            <code className="mono">.data/live/</code>.
          </p>
        </div>

        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">Captured buffers</h3>
          <p className="text-[11px] text-muted">
            Clips created from live buffers show up in your library. {recordedCount > 0 && `You have ${recordedCount} recorded buffer(s).`}
          </p>
        </div>
      </aside>
    </main>
  );
}
