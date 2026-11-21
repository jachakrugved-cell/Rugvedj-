/**
 * Source resolution: everything ClipForge knows about turning a URL
 * (page link, HLS, DASH, direct file, library clip) into playable + editable media.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DATA_DIR,
  DOWNLOADS_DIR,
  FFMPEG,
  FFPROBE,
  YTDLP,
  classifySource,
  ensureDirs,
} from "./config";
import { run, spawnCollect, tsToSeconds } from "./exec";
import { findClip } from "./library";
import { updateTask, type Task } from "./tasks";
import type { MediaInfo, SourceInfo } from "./types";
export type { MediaInfo, SourceInfo } from "./types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export async function binaryAvailable(bin: string): Promise<boolean> {
  const r = await run(bin, ["-version"], { timeoutMs: 8000 });
  if (r.code === 0) return true;
  const v = await run(bin, ["--version"], { timeoutMs: 8000 });
  return v.code === 0;
}

// ───────────────────────────── ffprobe ─────────────────────────────

type ProbeJson = {
  format?: {
    duration?: string;
    bit_rate?: string;
    format_name?: string;
    tags?: Record<string, string>;
  };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    duration?: string;
    tags?: Record<string, string>;
  }>;
};

const fpsOf = (rate?: string): number | undefined => {
  if (!rate) return undefined;
  const [n, d] = rate.split("/").map(Number);
  if (!d) return undefined;
  const v = n / d;
  return Number.isFinite(v) && v > 0 && v < 1000 ? Math.round(v * 100) / 100 : undefined;
};

/**
 * Fallback probe that parses `ffmpeg -i` banner output. Needed because some
 * prebuilt ffprobe binaries segfault on HLS manifests; ffmpeg itself is robust.
 */
export async function probeWithFfmpeg(
  source: string,
  headers: Record<string, string> = {},
): Promise<MediaInfo> {
  const args = ["-hide_banner", "-nostdin"];
  const headerStr = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n");
  if (headerStr) args.push("-headers", `${headerStr}\r\n`);
  args.push("-i", source, "-t", "0.1", "-f", "null", "-");

  const r = await run(FFMPEG, args, { timeoutMs: 90_000 });
  const text = r.stderr;
  if (!/Input #\d+/.test(text)) {
    throw new Error(humanizeMediaError(text, source));
  }

  const durM = text.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  const durationSec = durM
    ? Number(durM[1]) * 3600 + Number(durM[2]) * 60 + Number(durM[3])
    : null;
  const isLive = /Duration:\s*N\/A/.test(text) || durationSec === null;

  const videoLine = text.split("\n").find((l) => /Stream #\d+:\d+.*: Video:/.test(l)) ?? "";
  const audioLine = text.split("\n").find((l) => /Stream #\d+:\d+.*: Audio:/.test(l)) ?? "";
  const dim = videoLine.match(/(\d{2,5})x(\d{2,5})/);
  const fps = videoLine.match(/([\d.]+)\s*fps/);
  const vcodec = videoLine.match(/Video:\s*([a-z0-9_]+)/i);
  const acodec = audioLine.match(/Audio:\s*([a-z0-9_]+)/i);

  return {
    durationSec: durationSec && durationSec > 0 ? durationSec : null,
    isLive,
    hasVideo: !!videoLine,
    hasAudio: !!audioLine,
    width: dim ? Number(dim[1]) : undefined,
    height: dim ? Number(dim[2]) : undefined,
    fps: fps ? Number(fps[1]) : undefined,
    vcodec: vcodec?.[1],
    acodec: acodec?.[1],
  };
}

export async function probe(source: string): Promise<MediaInfo> {
  const args = [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    "-user_agent",
    UA,
    source,
  ];
  const r = await run(FFPROBE, args, { timeoutMs: 45_000 });
  if (r.code !== 0) {
    // Prebuilt ffprobe binaries sometimes crash (SIGSEGV) on HLS/DASH manifests.
    // ffmpeg's demuxer is the same code, so parse its banner instead.
    try {
      return await probeWithFfmpeg(source);
    } catch {
      throw new Error(humanizeMediaError(r.stderr, source));
    }
  }
  let json: ProbeJson;
  try {
    json = JSON.parse(r.stdout) as ProbeJson;
  } catch {
    throw new Error("Could not read media metadata (ffprobe returned invalid JSON).");
  }
  const streams = json.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const duration = Number(json.format?.duration);
  const bitrate = Number(json.format?.bit_rate);
  return {
    durationSec:
      Number.isFinite(duration) && duration > 0
        ? Math.round(duration * 1000) / 1000
        : null,
    isLive: !Number.isFinite(duration) || duration === 0 ? !!v && !json.format?.duration : false,
    hasVideo: !!v,
    hasAudio: !!a,
    width: v?.width,
    height: v?.height,
    fps: fpsOf(v?.avg_frame_rate) ?? fpsOf(v?.r_frame_rate),
    vcodec: v?.codec_name,
    acodec: a?.codec_name,
    bitrate: Number.isFinite(bitrate) ? bitrate : undefined,
    title: json.format?.tags?.title,
  };
}

function humanizeMediaError(stderr: string, source: string): string {
  const s = stderr.toLowerCase();
  if (s.includes("403") || s.includes("forbidden"))
    return "The server refused the request (HTTP 403). The link may need a login, a Referer header, or it has expired.";
  if (s.includes("404")) return "Media not found (HTTP 404). Check the link.";
  if (s.includes("invalid data found"))
    return "That link does not point to a media file. If it is a web page, ClipForge will try yt-dlp — install it with `npm run setup`.";
  if (s.includes("timed out") || s.includes("timeout"))
    return "Timed out while reading the media. The stream may be slow or offline.";
  if (s.includes("protocol not found"))
    return "Unsupported protocol in that link.";
  return `Could not read media: ${stderr.split("\n").filter(Boolean).slice(-2).join(" ").trim() || source}`;
}

// ───────────────────────────── yt-dlp ─────────────────────────────

type YtFormat = {
  format_id?: string;
  ext?: string;
  url?: string;
  protocol?: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  width?: number;
  fps?: number;
  tbr?: number;
  filesize?: number;
  filesize_approx?: number;
};

type YtInfo = {
  id?: string;
  title?: string;
  duration?: number;
  thumbnail?: string;
  uploader?: string;
  is_live?: boolean;
  live_status?: string;
  webpage_url?: string;
  url?: string;
  ext?: string;
  protocol?: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  width?: number;
  formats?: YtFormat[];
};

export type YtResolved = {
  ok: boolean;
  info?: YtInfo;
  error?: string;
  previewUrl?: string | null;
  previewType?: "hls" | "file";
};

const isHlsProto = (p?: string) =>
  !!p && (p.startsWith("m3u8") || p === "m3u8_native" || p.includes("m3u8"));

export async function ytdlpAvailable(): Promise<boolean> {
  return binaryAvailable(YTDLP);
}

/**
 * Resolve a page URL with yt-dlp without downloading, and pick the best
 * preview candidate (HLS for live, progressive MP4 otherwise).
 */
export async function resolveWithYtdlp(url: string): Promise<YtResolved> {
  if (!(await ytdlpAvailable())) {
    return {
      ok: false,
      error:
        "yt-dlp is not installed. Run `npm run setup` (or `pipx install yt-dlp`) and retry. Direct MP4/HLS links work without it.",
    };
  }
  const args = [
    "--no-warnings",
    "--no-playlist",
    "--socket-timeout",
    "20",
    "--add-header",
    `User-Agent:${UA}`,
    "-J",
    url,
  ];
  const r = await run(YTDLP, args, { timeoutMs: 120_000 });
  if (r.code !== 0) {
    const line =
      r.stderr
        .split("\n")
        .map((l) => l.replace(/^ERROR:\s*/i, "").trim())
        .filter(Boolean)
        .pop() || "yt-dlp could not resolve this link.";
    return { ok: false, error: line };
  }
  let info: YtInfo;
  try {
    info = JSON.parse(r.stdout) as YtInfo;
  } catch {
    return { ok: false, error: "yt-dlp returned unreadable metadata." };
  }

  const formats = (info.formats ?? []).filter((f) => f.url);
  const hls =
    formats.find(
      (f) => isHlsProto(f.protocol) && f.vcodec !== "none" && (f.height ?? 0) <= 1080,
    ) ?? formats.find((f) => isHlsProto(f.protocol));

  const mp4s = formats
    .filter(
      (f) =>
        f.ext === "mp4" &&
        (!f.protocol || f.protocol.startsWith("http")) &&
        f.vcodec !== "none" &&
        f.acodec !== "none",
    )
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const capped = mp4s.find((f) => (f.height ?? 0) <= 1080) ?? mp4s[0];

  if (info.is_live || info.live_status === "is_live") {
    const live = hls?.url ?? info.url ?? null;
    return {
      ok: true,
      info,
      previewUrl: live,
      previewType: live ? "hls" : "file",
    };
  }

  if (isHlsProto(info.protocol) && info.url) {
    return { ok: true, info, previewUrl: info.url, previewType: "hls" };
  }
  if (capped?.url) {
    return { ok: true, info, previewUrl: capped.url, previewType: "file" };
  }
  if (hls?.url) {
    return { ok: true, info, previewUrl: hls.url, previewType: "hls" };
  }
  if (info.url) {
    return {
      ok: true,
      info,
      previewUrl: info.url,
      previewType: isHlsProto(info.protocol) ? "hls" : "file",
    };
  }
  return { ok: true, info, previewUrl: null, previewType: null as never };
}

// ─────────────────────────── resolution cache ───────────────────────────

const cache = new Map<string, { value: SourceInfo; expires: number }>();
const CACHE_MS = 5 * 60 * 1000;

export function clearSourceCache() {
  cache.clear();
}

export async function getSourceInfo(
  inputUrl: string,
  opts: { fresh?: boolean } = {},
): Promise<SourceInfo> {
  const key = inputUrl.trim();
  const hit = cache.get(key);
  if (!opts.fresh && hit && hit.expires > Date.now()) return hit.value;

  const info = await resolveSource(key);
  cache.set(key, { value: info, expires: Date.now() + CACHE_MS });
  return info;
}

async function resolveSource(inputUrl: string): Promise<SourceInfo> {
  const kind = classifySource(inputUrl);
  const base: SourceInfo = {
    kind,
    inputUrl,
    previewUrl: null,
    previewType: "none",
    needsProxy: false,
    resolvedAt: Date.now(),
    durationSec: null,
    isLive: false,
    hasVideo: false,
    hasAudio: false,
  };

  if (kind === "local") {
    const file = await localSourcePath(inputUrl);
    const info = await probe(file);
    return {
      ...base,
      ...info,
      filePath: file,
      previewUrl: `/api/media/${path.basename(file)}?v=${Date.now()}`,
      previewType: "file",
      needsProxy: false,
    };
  }

  if (kind === "page") {
    const yt = await resolveWithYtdlp(inputUrl);
    if (!yt.ok || !yt.info) {
      throw new Error(yt.error ?? "Could not resolve that link.");
    }
    const info = yt.info;
    const isLive = !!info.is_live || info.live_status === "is_live";
    let probeInfo: MediaInfo | null = null;
    if (yt.previewUrl) {
      try {
        probeInfo = await probe(yt.previewUrl);
      } catch {
        probeInfo = null;
      }
    }
    const previewUrl = yt.previewUrl ?? null;
    return {
      ...base,
      ...(probeInfo ?? {}),
      isLive,
      hasVideo: probeInfo?.hasVideo ?? formatsHaveVideo(info),
      hasAudio: probeInfo?.hasAudio ?? formatsHaveAudio(info),
      durationSec:
        isLive || !info.duration ? probeInfo?.durationSec ?? null : info.duration,
      title: info.title,
      thumbnail: info.thumbnail,
      uploader: info.uploader,
      previewUrl,
      previewType: yt.previewType ?? (previewUrl ? "file" : "none"),
      needsProxy: !!previewUrl,
      headers: { Referer: info.webpage_url ?? inputUrl },
      note: isLive ? "Live stream resolved by yt-dlp." : undefined,
    };
  }

  // direct / hls / dash / live URL
  const info = await probe(inputUrl);
  const isLive =
    info.isLive ||
    kind === "live" ||
    (kind === "hls" && !info.durationSec);
  return {
    ...base,
    ...info,
    isLive,
    previewUrl: inputUrl,
    previewType: kind === "hls" || kind === "live" ? "hls" : "file",
    needsProxy: true,
  };
}

function formatsHaveVideo(info: YtInfo) {
  return (info.formats ?? []).some((f) => (f.vcodec ?? "none") !== "none");
}
function formatsHaveAudio(info: YtInfo) {
  return (info.formats ?? []).some((f) => (f.acodec ?? "none") !== "none");
}

/** Map /api/media/<id-or-name> or an absolute path inside .data to a real file. */
export async function localSourcePath(ref: string): Promise<string> {
  let p = ref.trim();
  if (p.startsWith("file://")) p = new URL(p).pathname;
  if (p.startsWith("/api/media/")) p = p.slice("/api/media/".length);
  p = decodeURIComponent(p.split("?")[0]);

  const clip = await findClip(p);
  if (clip) return clip.file;

  const clipDir = path.join(DATA_DIR, "clips");
  const liveDir = path.join(DATA_DIR, "live");
  const candidates = [
    path.join(DOWNLOADS_DIR, p),
    path.join(clipDir, p),
    path.join(liveDir, p),
    path.join(DATA_DIR, p),
    path.isAbsolute(ref) ? ref : path.resolve(ref),
  ];
  for (const c of candidates) {
    const resolved = path.resolve(c);
    // Only allow files inside our data directory.
    if (!resolved.startsWith(path.resolve(DATA_DIR) + path.sep)) continue;
    try {
      const st = await fs.stat(resolved);
      if (st.isFile()) return resolved;
    } catch {
      /* next */
    }
  }
  throw new Error(
    "Local media not found. Use a clip id from `list_clips`, or a path inside the .data folder.",
  );
}

// ─────────────────────────── downloading ───────────────────────────

const downloadLocks = new Map<string, Promise<string>>();

/**
 * Download the best ≤1080p MP4 for a page URL into .data/downloads.
 * Concurrent requests for the same URL share one download.
 */
export async function downloadSource(
  url: string,
  task?: Task,
  opts: { maxHeight?: number; audioOnly?: boolean } = {},
): Promise<string> {
  const key = `${url}|${opts.maxHeight ?? 1080}|${opts.audioOnly ? "a" : "v"}`;
  const existing = downloadLocks.get(key);
  if (existing) return existing;

  const job = (async () => {
    if (!(await ytdlpAvailable())) {
      // Fall back to ffmpeg for direct media URLs.
      const hash = createHash("sha1").update(url).digest("hex").slice(0, 12);
      const out = path.join(DOWNLOADS_DIR, `${hash}.mp4`);
      try {
        await fs.access(out);
        return out;
      } catch {
        /* download */
      }
      const r = await run(
        FFMPEG,
        ["-hide_banner", "-nostdin", "-y", "-i", url, "-c", "copy", out],
        { timeoutMs: 30 * 60_000 },
      );
      if (r.code !== 0) throw new Error(humanizeMediaError(r.stderr, url));
      return out;
    }

    await ensureDirs();
    const hash = createHash("sha1").update(key).digest("hex").slice(0, 12);
    const stem = path.join(DOWNLOADS_DIR, hash);
    const fmt = opts.audioOnly
      ? ["-f", "bestaudio/best"]
      : [
          "-f",
          `bv*[ext=mp4][height<=${opts.maxHeight ?? 1080}]+ba[ext=m4a]/b[ext=mp4][height<=${opts.maxHeight ?? 1080}]/bv*+ba/b`,
          "--merge-output-format",
          "mp4",
        ];

    const args = [
      "--no-warnings",
      "--no-playlist",
      "--newline",
      "--progress",
      "--socket-timeout",
      "20",
      ...fmt,
      "-o",
      `${stem}.%(ext)s`,
      url,
    ];

    if (task) updateTask(task.id, { state: "running", message: "Downloading source…" });
    const h = spawnCollect(YTDLP, args);
    const onChunk = (s: string) => {
      const m = s.match(/\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\w+)(?:\s+at\s+([\d.]+\w+\/s))?(?:\s+ETA\s+([\d:]+))?/);
      if (m && task) {
        const pct = Math.min(99, Math.round(Number(m[1])));
        updateTask(task.id, {
          progress: pct,
          speed: m[3],
          etaSec: m[4] ? (tsToSeconds(`00:${m[4]}`) ?? undefined) : undefined,
          message: `Downloading ${m[1]}% ${m[3] ? `· ${m[3]}` : ""}`.trim(),
          state: "running",
        });
      }
      const dest = s.match(/\[download\] Destination: (.+)/);
      if (dest && task) updateTask(task.id, { message: `Downloading ${path.basename(dest[1])}` });
      const merge = s.match(/\[Merger\] (.*)/);
      if (merge && task) updateTask(task.id, { message: `Merging streams…`, progress: 99 });
    };
    h.child.stdout?.on("data", (b: Buffer) => onChunk(b.toString()));
    h.child.stderr?.on("data", (b: Buffer) => onChunk(b.toString()));
    const res = await h.done;
    if (res.code !== 0) throw new Error(lastLines(res.stderr));

    const entries = await fs.readdir(DOWNLOADS_DIR);
    const match = entries
      .filter((f) => f.startsWith(`${hash}.`) && !f.endsWith(".part") && !f.endsWith(".ytdl"))
      .map((f) => path.join(DOWNLOADS_DIR, f))
      .sort()
      .reverse()[0];
    if (!match) throw new Error("Download finished but no file was produced.");
    if (task) {
      const st = await fs.stat(match);
      updateTask(task.id, {
        progress: 100,
        state: "done",
        message: "Source downloaded",
        outputPath: match,
        sizeBytes: st.size,
      });
    }
    return match;
  })();

  downloadLocks.set(key, job);
  try {
    return await job;
  } finally {
    downloadLocks.delete(key);
  }
}

function lastLines(text: string): string {
  return (
    text
      .split("\n")
      .map((l) => l.replace(/^ERROR:\s*/i, "").trim())
      .filter(Boolean)
      .slice(-2)
      .join(" ") || "Download failed."
  );
}
