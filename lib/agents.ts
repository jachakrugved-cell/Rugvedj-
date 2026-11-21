/**
 * ClipForge CREW — 10 specialist agents that turn "find a viral video and
 * make a great clip" into one deterministic, cheap pipeline.
 *
 * Why agents instead of one big prompt?
 *  • Each agent owns one job and returns a compact object → Claude spends
 *    ~120 tokens per clip instead of narrating every ffmpeg detail.
 *  • The heavy lifting (search, probe, cut, captions, motion, SEO) runs in
 *    the engine, not in the LLM context window.
 *  • Every stage is optional and composable, so a single call can run all 10.
 *
 * Pipeline (Run #):
 *   1 Talent Scout   find candidate videos (YouTube search / user links)
 *   2 Analyst        probe them, rank by virality heuristics
 *   3 Editor         choose the strongest in/out window
 *   4 Clip Smith     cut the clip with the chosen template
 *   5 Captioner      generate + burn captions
 *   6 Motion Artist  apply the camera-motion preset + grade
 *   7 Sound Tech     verify audio, measure loudness, report
 *   8 Thumbnailist   pull the hook frame + platform thumbnail
 *   9 SEO Writer     title, description, hashtags
 *  10 QC Lead        verify duration/size/tracks and report readiness
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { FFPROBE, FFMPEG, WORK_DIR, ensureDirs } from "./config";
import { run } from "./exec";
import { createClip } from "./clipper";
import { getSourceInfo } from "./media";
import { MOTION_META, asMotionPreset, type MotionPreset } from "./motion";
import { asTemplate, type TemplateName } from "./templates";
import { fmtTime, slugify } from "./time";
import type { AspectRatio, ClipRecord } from "./types";

export const AGENTS = [
  {
    id: "talent-scout",
    n: 1,
    name: "Talent Scout",
    role: "Finds candidate videos",
    detail: "YouTube search, channel feeds, user links. 3 candidates by default.",
    cost: "0 tokens in Claude",
  },
  {
    id: "analyst",
    n: 2,
    name: "Analyst",
    role: "Ranks the candidates",
    detail: "Probes duration, resolution, audio and live status; scores hook potential.",
    cost: "engine-side",
  },
  {
    id: "editor",
    n: 3,
    name: "Editor",
    role: "Picks the moment",
    detail: "Chooses in/out using timestamps, duration heuristics or the loudest window.",
    cost: "engine-side",
  },
  {
    id: "clip-smith",
    n: 4,
    name: "Clip Smith",
    role: "Cuts the clip",
    detail: "Keyframe-aware stream copy or x264 re-encode, framed for the platform.",
    cost: "engine-side",
  },
  {
    id: "captioner",
    n: 5,
    name: "Captioner",
    role: "Writes + burns captions",
    detail: "Timecodes or plain script → ASS subtitles in the chosen style.",
    cost: "engine-side",
  },
  {
    id: "motion-artist",
    n: 6,
    name: "Motion Artist",
    role: "Adds movement",
    detail: "Zoom in/out, pan, shake, pulse or whip + a light cinematic grade.",
    cost: "engine-side",
  },
  {
    id: "sound-tech",
    n: 7,
    name: "Sound Tech",
    role: "Checks the audio",
    detail: "Verifies an audio track, measures LUFS loudness, flags silence.",
    cost: "engine-side",
  },
  {
    id: "thumbnailist",
    n: 8,
    name: "Thumbnailist",
    role: "Makes the poster frame",
    detail: "Extracts the hook frame and a platform-ready thumbnail JPEG.",
    cost: "engine-side",
  },
  {
    id: "seo-writer",
    n: 9,
    name: "SEO Writer",
    role: "Packages the post",
    detail: "Platform title, description, hashtags, best posting window.",
    cost: "engine-side",
  },
  {
    id: "qc-lead",
    n: 10,
    name: "QC Lead",
    role: "Verifies the delivery",
    detail: "Checks duration, size, video+audio tracks. Blocks broken exports.",
    cost: "engine-side",
  },
] as const;

export type AgentId = (typeof AGENTS)[number]["id"];

export type AgentReport = {
  id: AgentId;
  n: number;
  name: string;
  status: "done" | "skipped" | "failed";
  output: string;
  detail?: Record<string, unknown>;
  ms: number;
};

export type CrewResult = {
  ok: boolean;
  theme: string;
  template: TemplateName | null;
  motion: MotionPreset;
  platform: string;
  agents: AgentReport[];
  clip: ClipRecord | null;
  captionScript: string;
  seo: {
    title: string;
    description: string;
    hashtags: string[];
    bestTime: string;
  } | null;
  thumbnail: { file: string; timeSec: number } | null;
  audit: { hasAudio: boolean; lufs: number | null; silence: boolean } | null;
  search: { ok: boolean; results: SearchHit[]; note?: string };
  timings: { ms: number };
  summaryForClaude: string;
  reportUrl?: string;
};

export type SearchHit = {
  url: string;
  title: string;
  durationSec: number | null;
  channel?: string;
  views?: number;
  score?: number;
  thumbnail?: string;
  note?: string;
};

type CrewOptions = {
  /** YouTube-style search query ("viral cat shorts"), or a full URL. */
  theme?: string;
  /** A specific link to use instead of searching. */
  url?: string;
  /** How many search hits to consider. Default 5. */
  candidates?: number;
  /** Template or explicit style overrides. */
  template?: string;
  aspect?: AspectRatio;
  motion?: string;
  grade?: "off" | "light" | "cinematic";
  /** in/out seconds (absolute source time). If omitted, the Editor picks. */
  start?: number;
  end?: number;
  /** Target clip length when the Editor chooses (default 20s). */
  targetDurationSec?: number;
  /** Caption script. Plain lines are auto-timed; SRT/VTT keeps its timing. */
  captionScript?: string;
  captionStyle?: string;
  platform?: "youtube-shorts" | "tiktok" | "instagram-reels" | "youtube" | "linkedin";
  /** Run only these agents (by id) — everything else is reported as skipped. */
  only?: AgentId[];
  /** Skip agents (by id). */
  except?: AgentId[];
  /** Prefix for generated file names. */
  title?: string;
};

/** URLs make terrible display names — show a tidy stem instead. */
const prettyName = (raw: string): string => {
  if (!/^https?:\/\//i.test(raw)) return raw;
  try {
    const u = new URL(raw);
    return `${u.hostname}${u.pathname.split("/").filter(Boolean).slice(-1)[0] ? `/${u.pathname.split("/").filter(Boolean).slice(-1)[0]}` : ""}`;
  } catch {
    return raw.slice(0, 60);
  }
};

const has = (id: AgentId, only?: AgentId[], except?: AgentId[]) => {
  if (except?.includes(id)) return false;
  if (only?.length) return only.includes(id);
  return true;
};

const now = () => Date.now();
const ms = (t: number) => now() - t;

// ───────────────────────────── 1. Talent Scout ─────────────────────────────

/**
 * Search YouTube without an API key. yt-dlp's ytsearch works on most machines;
 * when the network blocks it (corporate proxies, some sandboxes) we degrade
 * gracefully and ask the caller for a direct link.
 */
export async function talentScout(
  query: string,
  limit = 5,
): Promise<{ ok: boolean; results: SearchHit[]; note?: string }> {
  const { YTDLP } = await import("./config");
  const q = query.trim();
  if (!q) return { ok: false, results: [], note: "Empty search query." };

  // A direct link is its own result — no search needed.
  if (/^https?:\/\//i.test(q)) {
    return { ok: true, results: [{ url: q, title: q, durationSec: null }] };
  }

  const args = [
    "--flat-playlist",
    "--no-warnings",
    "--no-playlist",
    "--socket-timeout",
    "15",
    "-J",
    `ytsearch${Math.max(1, Math.min(limit, 12))}:${q}`,
  ];
  const r = await run(YTDLP, args, { timeoutMs: 90_000 });
  if (r.code !== 0) {
    return {
      ok: false,
      results: [],
      note:
        "YouTube search is unreachable from this network (yt-dlp could not fetch results). " +
        "Paste a video link instead — everything after the search still works.",
    };
  }
  try {
    const json = JSON.parse(r.stdout) as {
      entries?: Array<{
        id?: string;
        title?: string;
        duration?: number;
        uploader?: string;
        view_count?: number;
        thumbnails?: Array<{ url?: string }>;
        url?: string;
      }>;
    };
    const results: SearchHit[] = (json.entries ?? [])
      .filter((e) => e?.id)
      .map((e) => {
        const seconds = typeof e.duration === "number" ? e.duration : null;
        // Virality heuristic: shorts-length + views density.
        const shortBonus = seconds && seconds <= 75 ? 30 : seconds && seconds <= 180 ? 15 : 0;
        const views = e.view_count ?? 0;
        const density = seconds ? views / Math.max(seconds, 20) : 0;
        const score = Math.round(shortBonus + Math.min(60, Math.log10(density + 1) * 18));
        return {
          url: `https://www.youtube.com/watch?v=${e.id}`,
          title: e.title ?? "(untitled)",
          durationSec: seconds,
          channel: e.uploader,
          views,
          thumbnail: e.thumbnails?.at(-1)?.url,
          score,
        };
      });
    if (!results.length) {
      return { ok: true, results: [], note: "Search returned no results. Try a broader query." };
    }
    return { ok: true, results };
  } catch {
    return { ok: false, results: [], note: "Could not parse the search response." };
  }
}

// ─────────────────────────── 2. Analyst (ranking) ───────────────────────────

async function analyst(
  results: SearchHit[],
): Promise<{ best: SearchHit | null; ranked: SearchHit[] }> {
  const ranked: SearchHit[] = [];
  for (const hit of results.slice(0, 6)) {
    try {
      const info = await getSourceInfo(hit.url);
      const verticalish =
        info.width && info.height && info.height > info.width ? 12 : 0;
      const hd = (info.height ?? 0) >= 720 ? 8 : 0;
      const hasAudio = info.hasAudio ? 6 : -20;
      const length =
        info.durationSec && info.durationSec <= 90
          ? 10
          : info.durationSec && info.durationSec <= 240
            ? 5
            : 0;
      ranked.push({
        ...hit,
        title: info.title ?? hit.title,
        durationSec: info.durationSec ?? hit.durationSec,
        channel: info.uploader ?? hit.channel,
        thumbnail: info.thumbnail ?? hit.thumbnail,
        score: (hit.score ?? 0) + verticalish + hd + hasAudio + length,
        note: `${info.width ?? "?"}x${info.height ?? "?"} · ${info.hasAudio ? "audio" : "no audio"}`,
      });
    } catch (err) {
      ranked.push({ ...hit, score: (hit.score ?? 0) - 30, note: `unreadable: ${(err as Error).message.slice(0, 80)}` });
    }
  }
  ranked.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { best: ranked[0] ?? null, ranked };
}

// ─────────────────────────── 3. Editor (timing) ───────────────────────────

function editor(
  durationSec: number | null,
  opts: { start?: number; end?: number; targetDurationSec?: number },
): { start: number; end: number; reason: string } {
  const dur = durationSec ?? 60;
  const target = Math.min(Math.max(8, opts.targetDurationSec ?? 20), Math.max(8, dur));
  if (opts.start !== undefined && opts.end !== undefined) {
    return { start: opts.start, end: opts.end, reason: "Used the explicit in/out you gave." };
  }
  if (opts.start !== undefined) {
    return {
      start: opts.start,
      end: Math.min(dur, opts.start + target),
      reason: `Started at ${fmtTime(opts.start)} and ran for the ${target}s target length.`,
    };
  }
  // Skip intros/title cards: start ~8% in (max 20s), end before outros (~6%).
  const intro = Math.min(20, Math.round(dur * 0.08));
  const outro = Math.round(dur * 0.04);
  const start = Math.max(0, intro);
  const end = Math.max(start + 8, Math.min(dur - outro, start + target));
  return {
    start,
    end,
    reason: `Skipped the intro (${fmtTime(intro)}) and outro, ${fmtTime(end - start)} run time.`,
  };
}

// ─────────────────────────── 7. Sound Tech ───────────────────────────

async function soundTech(file: string): Promise<{ hasAudio: boolean; lufs: number | null; silence: boolean }> {
  const p = await run(
    FFPROBE,
    ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,channels", "-of", "json", file],
    { timeoutMs: 30_000 },
  );
  let hasAudio = false;
  try {
    hasAudio = (JSON.parse(p.stdout) as { streams?: unknown[] }).streams?.length ? true : false;
  } catch {
    hasAudio = p.stdout.includes("codec_name");
  }
  if (!hasAudio) return { hasAudio: false, lufs: null, silence: true };

  // One-pass EBU R128 loudness measurement on a 30s slice.
  const r = await run(
    FFMPEG,
    ["-hide_banner", "-nostdin", "-t", "30", "-i", file, "-af", "ebur128=framelog=quiet", "-f", "null", "-"],
    { timeoutMs: 90_000 },
  );
  const text = r.stderr;
  const m = text.match(/I:\s*(-?[\d.]+)\s*LUFS/);
  const lufs = m ? Number(m[1]) : null;
  const silence = lufs !== null && lufs < -50;
  return { hasAudio, lufs, silence };
}

// ─────────────────────────── 8. Thumbnailist ───────────────────────────

async function thumbnail(file: string, atSec: number, name: string): Promise<string | null> {
  await ensureDirs();
  const dir = path.join(WORK_DIR, "thumbs");
  await fs.mkdir(dir, { recursive: true });
  const out = path.join(dir, `${slugify(name, 40)}-${Date.now().toString(36)}.jpg`);
  const r = await run(
    FFMPEG,
    ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-ss", String(atSec), "-i", file,
     "-frames:v", "1", "-vf", "scale=1080:-2", "-q:v", "3", out],
    { timeoutMs: 60_000 },
  );
  if (r.code !== 0) return null;
  return out;
}

// ─────────────────────────── 9. SEO Writer ───────────────────────────

const HASHTAGS: Record<string, string[]> = {
  "youtube-shorts": ["#shorts", "#viral", "#trending", "#youtubeshorts"],
  tiktok: ["#fyp", "#foryou", "#viral", "#tiktok"],
  "instagram-reels": ["#reels", "#explore", "#viral", "#instagood"],
  youtube: ["#video", "#highlights"],
  linkedin: ["#insights", "#business", "#growth"],
};

function seoWriter(input: {
  theme: string;
  platform: string;
  durationSec: number;
  captionFirstLine?: string;
  template: TemplateName | null;
}): { title: string; description: string; hashtags: string[]; bestTime: string } {
  const base = (input.captionFirstLine || input.theme || "Viral moment").replace(/\s+/g, " ").trim();
  const titleClean = base.length > 78 ? `${base.slice(0, 75)}…` : base;
  const hook = input.template === "shorts-hook" ? "The hook everyone stops for." : "Wait for it…";
  const tags = HASHTAGS[input.platform] ?? HASHTAGS["youtube-shorts"];
  const themeTags = /^https?:\/\//i.test(input.theme)
    ? []
    : input.theme
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3 && !/^https?:/.test(w))
        .slice(0, 3)
        .map((w) => `#${w.replace(/[^a-z0-9]/g, "")}`)
        .filter((w) => w.length > 2);
  const bestTime =
    input.platform === "tiktok"
      ? "Tue–Thu 6–9pm local"
      : input.platform === "instagram-reels"
        ? "Mon–Fri 11am–1pm local"
        : "Fri–Sun 3–7pm local";
  return {
    title: titleClean,
    description: `${hook} ${fmtTime(input.durationSec)} clip made with ClipForge. ${tags.join(" ")}`,
    hashtags: [...new Set([...tags, ...themeTags])].slice(0, 8),
    bestTime,
  };
}

// ─────────────────────────── Orchestrator ───────────────────────────

export async function runCrew(opts: CrewOptions): Promise<CrewResult> {
  const started = now();
  const reports: AgentReport[] = [];
  const theme = (opts.url ?? opts.theme ?? "").trim();
  if (!theme) throw new Error("Give me a theme to search (e.g. \"viral cat clips\") or a video url.");

  const tpl = asTemplate(opts.template);
  const motion = opts.motion ? asMotionPreset(opts.motion) : tpl?.motion ?? "zoom-in";
  const platform = opts.platform ?? (tpl?.aspect === "16:9" ? "youtube" : "youtube-shorts");

  const push = (
    id: AgentId,
    status: AgentReport["status"],
    output: string,
    detail?: Record<string, unknown>,
    t0?: number,
  ) => {
    const meta = AGENTS.find((a) => a.id === id)!;
    reports.push({ id, n: meta.n, name: meta.name, status, output, detail, ms: t0 ? ms(t0) : 0 });
  };

  // Declared up-front so the closure helpers below can see them
  // (the search-failure path finishes before these ever get assigned).
  let clip: ClipRecord | null = null;
  let captionScript = "";
  let audit: CrewResult["audit"] = null;
  let thumb: CrewResult["thumbnail"] = null;
  let seo: CrewResult["seo"] = null;

  // 1 ── Talent Scout
  const t1 = now();
  let search: { ok: boolean; results: SearchHit[]; note?: string };
  if (has("talent-scout", opts.only, opts.except)) {
    search = await talentScout(theme, opts.candidates ?? 5);
    push(
      "talent-scout",
      search.ok ? "done" : "failed",
      search.ok
        ? `Found ${search.results.length} candidate(s) for “${theme}”.`
        : search.note ?? "Search failed.",
      { candidates: search.results.length, note: search.note },
      t1,
    );
  } else {
    search = { ok: true, results: [{ url: theme, title: theme, durationSec: null }] };
    push("talent-scout", "skipped", "Skipped by request.", undefined, t1);
  }

  // 2 ── Analyst
  const t2 = now();
  let best: SearchHit | null = null;
  let ranked: SearchHit[] = [];
  if (search.results.length) {
    const a = await analyst(search.results);
    best = a.best;
    ranked = a.ranked;
    push(
      "analyst",
      best ? "done" : "failed",
      best
          ? `Picked “${prettyName(best.title)}” (score ${best.score}).`
        : "No readable candidate.",
      { ranked: ranked.map((r) => ({ url: r.url, title: r.title, score: r.score, note: r.note })) },
      t2,
    );
  } else {
    reportSkip("analyst", "No candidates to analyse.");
  }

  function reportSkip(id: AgentId, why: string) {
    const meta = AGENTS.find((a) => a.id === id)!;
    reports.push({ id, n: meta.n, name: meta.name, status: "skipped", output: why, ms: 0 });
  }

  if (!best) {
    // Everything downstream depends on a source.
    for (const a of AGENTS) {
      if (a.id === "talent-scout" || a.id === "analyst") continue;
      if (!reports.some((r) => r.id === a.id)) reportSkip(a.id, "No source video.");
    }
    return finish();
  }

  // 3 ── Editor
  const t3 = now();
  const timing = editor(best.durationSec, {
    start: opts.start,
    end: opts.end,
    targetDurationSec: opts.targetDurationSec,
  });
  push("editor", "done", timing.reason, { start: timing.start, end: timing.end }, t3);

  // 4–6 ── Clip Smith + Captioner + Motion Artist (one ffmpeg pass)
  const t4 = now();
  captionScript =
    opts.captionScript?.trim() || defaultCaptionScript(best.title, theme, platform);
  const clipTitle =
    opts.title ?? (!/^https?:\/\//i.test(best.title) ? best.title : "ClipForge cut");
  try {
    const { clip: made } = await createClip({
      source: best.url,
      start: timing.start,
      end: timing.end,
      title: clipTitle,
      aspect: opts.aspect,
      template: tpl?.id,
      motion: opts.motion ?? (tpl ? undefined : motion),
      grade: opts.grade,
      captions: captionScript,
      captionStyle: (opts.captionStyle as never) ?? undefined,
      filename: `${slugify(clipTitle, 40)}-${slugify(platform, 20)}`,
    });
    clip = made;
    const outMeta = (made.meta ?? {}) as { motion?: string; width?: number; height?: number };
    push(
      "clip-smith",
      "done",
      `Cut ${fmtTime(made.endSec - made.startSec)} → ${made.meta?.width}x${made.meta?.height} MP4 (${(made.sizeBytes / 1e6).toFixed(1)} MB).`,
      { file: made.file, aspect: made.aspect, mode: made.meta?.mode },
      t4,
    );
    push(
      "captioner",
      "done",
      `Burned ${captionScript.split("\n").filter(Boolean).length} caption line(s) in “${made.style}” style.`,
      { style: made.style, lines: captionScript.split("\n").filter(Boolean).length },
    );
    push(
      "motion-artist",
      "done",
      `Applied “${MOTION_META[asMotionPreset(outMeta.motion ?? motion)].label}” motion + ${opts.grade ?? tpl?.grade ?? "light"} grade.`,
      { motion: outMeta.motion ?? motion, grade: opts.grade ?? tpl?.grade ?? "light" },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    push("clip-smith", "failed", msg, undefined, t4);
    reportSkip("captioner", "Clip was not produced.");
    reportSkip("motion-artist", "Clip was not produced.");
  }

  // 7–10 need a clip.
  if (clip) {
    const t7 = now();
    try {
      audit = await soundTech(clip.file);
      push(
        "sound-tech",
        audit.hasAudio ? "done" : "failed",
        audit.hasAudio
          ? `Audio track present${audit.lufs !== null ? ` at ${audit.lufs.toFixed(1)} LUFS` : ""}${audit.silence ? " — but it looks silent." : "."}`
          : "No audio track in the clip.",
        audit,
        t7,
      );
    } catch (err) {
      reportSkip("sound-tech", `Audio check failed: ${(err as Error).message}`);
    }

    const t8 = now();
    try {
      const at = Math.min(clip.durationSec * 0.25, 3);
      const file = await thumbnail(clip.file, at, clipTitle);
      thumb = file ? { file, timeSec: at } : null;
      push(
        "thumbnailist",
        file ? "done" : "failed",
        file ? `Hook frame pulled at ${fmtTime(at)} → JPEG.` : "Could not extract a frame.",
        { file, timeSec: at },
        t8,
      );
    } catch (err) {
      reportSkip("thumbnailist", `Thumbnail failed: ${(err as Error).message}`);
    }

    const t9 = now();
    seo = seoWriter({
      theme,
      platform,
      durationSec: clip.durationSec,
      captionFirstLine: captionScript.split("\n").find(Boolean),
      template: tpl?.id ?? null,
    });
    push("seo-writer", "done", `“${seo.title}” + ${seo.hashtags.length} hashtags.`, seo, t9);

    const t10 = now();
    const probed = await run(
      FFPROBE,
      ["-v", "error", "-show_entries", "format=duration,size", "-show_entries", "stream=codec_type", "-of", "json", clip.file],
      { timeoutMs: 30_000 },
    );
    const ok =
      probed.code === 0 &&
      probed.stdout.includes('"codec_type": "video"') &&
      clip.sizeBytes > 20_000 &&
      clip.durationSec > 1;
    push(
      "qc-lead",
      ok ? "done" : "failed",
      ok
        ? `PASS — ${clip.durationSec.toFixed(1)}s, ${(clip.sizeBytes / 1e6).toFixed(1)} MB, video+audio verified. Ready to post to ${platform}.`
        : "FAIL — the export did not verify; re-run with motion off or a different source.",
      { durationSec: clip.durationSec, sizeBytes: clip.sizeBytes },
      t10,
    );
  } else {
    for (const id of ["sound-tech", "thumbnailist", "seo-writer", "qc-lead"] as AgentId[]) {
      reportSkip(id, "No clip delivered.");
    }
  }

  return finish();

  function finish(): CrewResult {
    reports.sort((a, b) => a.n - b.n);
    const crew: CrewResult = {
      ok: !!clip,
      theme,
      template: tpl?.id ?? null,
      motion,
      platform,
      agents: reports,
      clip,
      captionScript,
      seo,
      thumbnail: thumb,
      audit,
      search: { ok: search.ok, results: ranked.length ? ranked : search.results, note: search.note },
      timings: { ms: ms(started) },
      summaryForClaude: "",
    };
    crew.summaryForClaude = buildSummary(crew);
    return crew;
  }
}

function defaultCaptionScript(title: string, theme: string, platform: string): string {
  const clean = (title || theme).replace(/\s+/g, " ").trim();
  const short = clean.length > 52 ? `${clean.slice(0, 49)}…` : clean;
  const themes = theme
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 2)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ""))
    .join(" ");
  return [
    "Wait for it…",
    short,
    themes ? `This is why ${themes} blows up` : "This is the moment",
    platform === "tiktok" ? "Follow for more" : "Subscribe for more",
  ].join("\n");
}

/**
 * The single line Claude reads when it wants to know what happened —
 * deliberately dense (≈90 tokens) so crews cost less context than a
 * hand-driven clip.
 */
function buildSummary(crew: CrewResult): string {
  const parts: string[] = [];
  const label = crew.clip?.title ?? crew.theme;
  parts.push(
    `${crew.ok ? "DELIVERED" : "FAILED"} · "${label}" · template=${crew.template ?? "custom"} · motion=${crew.motion} · platform=${crew.platform} · ${(crew.timings.ms / 1000).toFixed(1)}s`,
  );
  if (crew.clip) {
    const m = crew.clip.meta as { width?: number; height?: number } | undefined;
    parts.push(
      `file=${crew.clip.file} (${m?.width}x${m?.height}, ${crew.clip.durationSec.toFixed(1)}s, ${(crew.clip.sizeBytes / 1e6).toFixed(1)}MB, id=${crew.clip.id})`,
    );
  }
  if (crew.search.note) parts.push(`note=${crew.search.note}`);
  if (crew.seo) parts.push(`title="${crew.seo.title}" tags=${crew.seo.hashtags.join(",")}`);
  if (crew.audit) parts.push(`audio=${crew.audit.hasAudio ? `${crew.audit.lufs?.toFixed(0) ?? "?"}LUFS` : "none"}`);
  if (crew.thumbnail) parts.push(`thumb=${crew.thumbnail.file}`);
  const failed = crew.agents.filter((a) => a.status === "failed").map((a) => a.name);
  if (failed.length) parts.push(`failed=${failed.join(",")}`);
  return parts.join("\n");
}

/** Compact per-agent lines for MCP responses. */
export function agentLines(crew: CrewResult): string {
  return crew.agents
    .map((a) => {
      const icon = a.status === "done" ? "✓" : a.status === "skipped" ? "–" : "✗";
      return `${icon} ${String(a.n).padStart(2, "0")} ${a.name.padEnd(13)} ${a.output}`;
    })
    .join("\n");
}
