"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chip, Spinner } from "@/components/ui";
import { fmtTime } from "@/lib/time";
import type { ClipRecord, Task } from "@/lib/types";
import type { CrewResult } from "@/lib/agents";

type Agent = {
  id: string;
  n: number;
  name: string;
  role: string;
  detail: string;
  cost: string;
};

const TEMPLATE_CHOICES = [
  ["shorts-hook", "Shorts hook", "9:16 · zoom · bold"],
  ["tiktok-karaoke", "TikTok karaoke", "9:16 · pulse · karaoke"],
  ["reels-clean", "Reels clean", "9:16 · pan · clean"],
  ["podcast-clip", "Podcast clip", "9:16 · zoom-out · highlight"],
  ["cinematic", "Cinematic", "16:9 · pan · minimal"],
  ["square-proof", "Square proof", "1:1 · zoom · clean"],
  ["raw", "Raw cut", "original · none"],
] as const;

const PLATFORMS = ["youtube-shorts", "tiktok", "instagram-reels", "youtube", "linkedin"] as const;

export default function CrewView({
  tasks,
  onOpenClip,
}: {
  tasks: Task[];
  onOpenClip: (c: ClipRecord) => void;
}) {
  const [roster, setRoster] = useState<Agent[]>([]);
  const [theme, setTheme] = useState("");
  const [template, setTemplate] = useState<string>("shorts-hook");
  const [platform, setPlatform] = useState<string>("youtube-shorts");
  const [target, setTarget] = useState(20);
  const [captions, setCaptions] = useState("");
  const [mode, setMode] = useState<"search" | "link">("search");

  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(0);
  const [result, setResult] = useState<CrewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // roster + a gentle faux-progress while the engine works
  useEffect(() => {
    fetch("/api/crew")
      .then((r) => r.json())
      .then((d: { agents: Agent[] }) => setRoster(d.agents ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!running) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    setCurrent(0);
    timer.current = setInterval(() => {
      setCurrent((c) => Math.min(9, c + 1));
    }, 2600);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [running]);

  const clipTasks = useMemo(
    () => tasks.filter((t) => t.kind === "clip" || t.kind === "download").slice(0, 3),
    [tasks],
  );

  const run = async () => {
    const input = theme.trim();
    if (!input) {
      setError("Type a topic to search, or switch to Link mode and paste a video URL.");
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const body = mode === "search" ? { theme: input } : { url: input };
      const r = await fetch("/api/crew", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          template,
          platform,
          targetDurationSec: target,
          captionScript: captions.trim() || undefined,
        }),
      });
      const j = (await r.json()) as CrewResult & { error?: string };
      if (!r.ok || j.error) throw new Error(j.error ?? "The crew could not finish.");
      setResult(j);
      setCurrent(10);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const statusOf = (n: number): "idle" | "working" | "done" | "failed" | "skipped" => {
    if (result) {
      const a = result.agents.find((x) => x.n === n);
      return a ? (a.status === "done" ? "done" : a.status === "failed" ? "failed" : "skipped") : "idle";
    }
    if (!running) return "idle";
    if (n <= current) return "done";
    if (n === current + 1) return "working";
    return "idle";
  };

  return (
    <main className="mt-5 grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
      <section className="min-w-0 space-y-5">
        <div className="glass rounded-2xl p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">
                CREW — 10 agents, one clip
              </h2>
              <p className="text-[11.5px] text-muted">
                Find a viral video → pick the moment → cut → caption → add motion → QC. All local.
              </p>
            </div>
            <Chip tone="brand">zero extra tokens per agent</Chip>
          </div>

          <div className="mb-2 flex gap-1 rounded-full border border-line bg-black/30 p-1 w-fit">
            {(
              [
                ["search", "Find for me"],
                ["link", "I have a link"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className="pill-tab" data-active={mode === k} onClick={() => setMode(k)}>
                {l}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
                {mode === "search" ? "🔎" : "🔗"}
              </span>
              <input
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !running && run()}
                placeholder={
                  mode === "search"
                    ? 'topic to search — e.g. "viral cat shorts", "gym transformation"'
                    : "https://youtube.com/watch?v=…  or  …/live.m3u8"
                }
                className="input !pl-9"
                spellCheck={false}
              />
            </div>
            <button className="btn btn-primary" onClick={run} disabled={running || !theme.trim()}>
              {running ? <Spinner /> : "▶ Run crew"}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Template</span>
              <select className="input !py-1.5 !text-xs" value={template} onChange={(e) => setTemplate(e.target.value)}>
                {TEMPLATE_CHOICES.map(([k, l, d]) => (
                  <option key={k} value={k}>
                    {l} — {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Platform</span>
              <select className="input !py-1.5 !text-xs" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Length</span>
              <select className="input !py-1.5 !text-xs" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                {[10, 15, 20, 30, 45, 60].map((s) => (
                  <option key={s} value={s}>
                    {fmtTime(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">Captions (optional)</span>
              <input
                className="input !py-1.5 !text-xs"
                placeholder="auto hook script"
                value={captions}
                onChange={(e) => setCaptions(e.target.value)}
              />
            </label>
          </div>
          {error && (
            <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </p>
          )}
        </div>

        {/* the 10-agent board */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h3 className="text-sm font-semibold">Agent board</h3>
            <span className="mono text-[11px] text-muted">
              {running ? `${Math.min(current, 10)}/10 running` : result ? (result.ok ? "delivered" : "failed") : "idle"}
            </span>
          </div>
          <ul className="divide-y divide-line">
            {(roster.length ? roster : Array.from({ length: 10 }, (_, i) => ({
              id: `x${i}`, n: i + 1, name: "…", role: "", detail: "", cost: "",
            }))).map((a) => {
              const st = statusOf(a.n);
              const out = result?.agents.find((x) => x.n === a.n);
              return (
                <li key={a.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span
                    className={`mono mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[10px] font-bold ${
                      st === "working"
                        ? "bg-brand/25 text-brand-2"
                        : st === "done"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : st === "failed"
                            ? "bg-rose-500/15 text-rose-300"
                            : st === "skipped"
                              ? "bg-white/5 text-muted"
                              : "bg-white/5 text-[#5d6479]"
                    }`}
                  >
                    {st === "working" ? <Spinner size={11} /> : st === "done" ? "✓" : st === "failed" ? "✗" : a.n}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-xs font-semibold">{a.name}</span>
                      <span className="text-[11px] text-muted">{a.role}</span>
                    </div>
                    <p className={`text-[11px] ${out?.status === "failed" ? "text-rose-300" : "text-[#7c8499]"}`}>
                      {out?.output ?? (st === "working" ? "working…" : a.detail)}
                    </p>
                  </div>
                  {out?.ms ? <span className="mono shrink-0 text-[10px] text-[#5d6479]">{(out.ms / 1000).toFixed(1)}s</span> : null}
                </li>
              );
            })}
          </ul>
        </div>

        {clipTasks.length > 0 && running && (
          <div className="card space-y-2 p-4">
            {clipTasks.map((t) => (
              <div key={t.id}>
                <div className="mb-1 flex justify-between text-[11px]">
                  <span className="truncate">{t.message}</span>
                  <span className="mono text-muted">{t.progress}%</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2 transition-[width]" style={{ width: `${Math.max(3, t.progress)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* result panel */}
      <aside className="min-w-0 space-y-5">
        {result?.clip ? (
          <div className="glass overflow-hidden rounded-2xl fade-in">
            <div className="aspect-video bg-black">
              <video src={`/api/clips/${result.clip.id}/file`} controls playsInline className="h-full w-full object-contain" />
            </div>
            <div className="space-y-2.5 p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold leading-snug">{result.seo?.title ?? result.clip.title}</h3>
                <Chip tone="ok">QC pass</Chip>
              </div>
              <div className="mono flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                <span>{result.clip.aspect}</span>
                <span>{fmtTime(result.clip.durationSec)}</span>
                <span>{(result.clip.sizeBytes / 1e6).toFixed(1)} MB</span>
                <span>{(result.clip.meta as { motion?: string })?.motion ?? "static"} motion</span>
                {result.audit?.lufs != null && <span>{result.audit.lufs.toFixed(0)} LUFS</span>}
              </div>
              {result.seo && (
                <div className="rounded-xl border border-line bg-black/30 p-2.5 text-[11px]">
                  <p className="text-muted">Description</p>
                  <p className="mt-0.5">{result.seo.description}</p>
                  <p className="mt-1.5 text-brand-2">{result.seo.hashtags.join(" ")}</p>
                  <p className="mt-1 text-[10px] text-[#5d6479]">best time → {result.seo.bestTime}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <a className="btn btn-primary !py-1.5 text-xs" href={`/api/clips/${result.clip.id}/file?download=1`} download>
                  Download
                </a>
                <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => onOpenClip(result.clip!)}>
                  Open in Studio
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="card grid-lines flex min-h-[240px] flex-col items-center justify-center gap-2 p-6 text-center">
            <span className="text-2xl">🎬</span>
            <p className="text-sm font-medium text-muted">Your crew is standing by</p>
            <p className="max-w-[260px] text-[11px] text-[#5d6479]">
              Give them a topic and they will find a video, cut the strongest moment, caption it,
              add motion, and hand you a post-ready MP4.
            </p>
          </div>
        )}

        {result?.search.results?.length ? (
          <div className="card p-4">
            <h3 className="mb-2 text-sm font-semibold">Scouted candidates</h3>
            <ul className="space-y-2">
              {result.search.results.slice(0, 5).map((r) => (
                <li key={r.url} className="flex items-center gap-2 rounded-lg border border-line bg-black/20 p-2">
                  {r.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.thumbnail} alt="" className="h-9 w-16 rounded object-cover" loading="lazy" />
                  ) : (
                    <div className="grid h-9 w-16 place-items-center rounded bg-white/5 text-[10px] text-muted">video</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium">{r.title}</p>
                    <p className="mono text-[10px] text-muted">
                      {r.durationSec ? fmtTime(r.durationSec) : "?"} {r.note ? `· ${r.note}` : ""}
                    </p>
                  </div>
                  {typeof r.score === "number" && <span className="mono shrink-0 text-[10px] text-brand-2">{r.score}</span>}
                </li>
              ))}
            </ul>
            {result.search.note && <p className="mt-2 text-[10.5px] text-amber-200/80">{result.search.note}</p>}
          </div>
        ) : null}

        <div className="card p-4 text-[11px] leading-relaxed text-muted">
          <h3 className="mb-1.5 text-sm font-semibold text-ink">How this stays cheap</h3>
          <ul className="space-y-1">
            <li>• Agents run in the engine, not in Claude&apos;s context.</li>
            <li>• One MCP call (<code className="mono text-ink">crew_video</code>) returns ≈90 tokens.</li>
            <li>• Saved prompts pre-shape the work so Claude never plans twice.</li>
            <li>• Captions, motion and grading are one ffmpeg pass.</li>
          </ul>
        </div>
      </aside>
    </main>
  );
}
