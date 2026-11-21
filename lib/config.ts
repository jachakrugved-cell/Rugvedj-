/**
 * Central configuration + binary resolution for ClipForge.
 *
 * Binaries are resolved in this order:
 *   1. explicit env var (FFMPEG_BIN / FFPROBE_BIN / YTDLP_BIN)
 *   2. bundled download in <repo>/.tools/bin  (created by `npm run setup`)
 *   3. `node_modules/@ffprobe-installer` (ffprobe always available)
 *   4. system PATH (ffmpeg, ffprobe, yt-dlp)
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export const ROOT = process.env.CLIPFORGE_ROOT
  ? path.resolve(process.env.CLIPFORGE_ROOT)
  : process.cwd();

export const DATA_DIR = process.env.CLIPFORGE_DATA
  ? path.resolve(process.env.CLIPFORGE_DATA)
  : path.join(ROOT, ".data");

export const CLIPS_DIR = path.join(DATA_DIR, "clips");
export const DOWNLOADS_DIR = path.join(DATA_DIR, "downloads");
export const LIVE_DIR = path.join(DATA_DIR, "live");
export const WORK_DIR = path.join(DATA_DIR, "work");
export const LIBRARY_FILE = path.join(DATA_DIR, "library.json");
export const RECORDINGS_FILE = path.join(DATA_DIR, "recordings.json");

export const LIVE_MAX_SEC = Math.max(
  30,
  Number(process.env.CLIPFORGE_LIVE_MAX_SEC || 2 * 60 * 60),
);

export function ensureDirs() {
  for (const dir of [DATA_DIR, CLIPS_DIR, DOWNLOADS_DIR, LIVE_DIR, WORK_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
}

const firstExisting = (...paths: (string | undefined | null)[]) => {
  for (const p of paths) {
    if (!p) continue;
    try {
      if (existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
};

function resolveFfmpeg(): string {
  return (
    firstExisting(
      process.env.FFMPEG_BIN,
      path.join(ROOT, ".tools/bin/ffmpeg"),
      path.join(ROOT, ".tools/bin/ffmpeg.exe"),
      "/usr/bin/ffmpeg",
      "/usr/local/bin/ffmpeg",
      "/opt/homebrew/bin/ffmpeg",
    ) || "ffmpeg"
  );
}

/**
 * Find ffprobe shipped by @ffprobe-installer without `require` (Next.js would
 * try to bundle the binary). We scan node_modules for the platform binary.
 */
function bundledFfprobe(): string | null {
  const platform = process.platform;
  const arch = process.arch;
  const candidates = [
    `linux-x64`,
    `linux-arm64`,
    `darwin-x64`,
    `darwin-arm64`,
    `win32-x64`,
  ].filter((p) => p.startsWith(platform) && p.endsWith(arch));
  for (const pkg of candidates) {
    const p = path.join(ROOT, "node_modules/@ffprobe-installer", pkg, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    if (existsSync(p)) return p;
  }
  return null;
}

function resolveFfprobe(): string {
  const installer = bundledFfprobe();
  return (
    firstExisting(
      process.env.FFPROBE_BIN,
      path.join(ROOT, ".tools/bin/ffprobe"),
      path.join(ROOT, ".tools/bin/ffprobe.exe"),
      installer,
      "/usr/bin/ffprobe",
      "/usr/local/bin/ffprobe",
      "/opt/homebrew/bin/ffprobe",
    ) || "ffprobe"
  );
}

function resolveYtdlp(): string {
  return (
    firstExisting(
      process.env.YTDLP_BIN,
      path.join(ROOT, ".tools/bin/yt-dlp"),
      path.join(ROOT, ".tools/bin/yt-dlp.exe"),
      process.env.HOME ? path.join(process.env.HOME, ".local/bin/yt-dlp") : null,
      "/usr/local/bin/yt-dlp",
      "/opt/homebrew/bin/yt-dlp",
      "/usr/bin/yt-dlp",
    ) || "yt-dlp"
  );
}

function resolveFont(): string {
  return (
    firstExisting(
      process.env.FFMPEG_FONT,
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
      "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
      "/System/Library/Fonts/Helvetica.ttc",
      "C:/Windows/Fonts/arialbd.ttf",
      "C:/Windows/Fonts/arial.ttf",
    ) || ""
  );
}

export const FFMPEG = resolveFfmpeg();
export const FFPROBE = resolveFfprobe();
export const YTDLP = resolveYtdlp();
export const FONT_FILE = resolveFont();

/** URL patterns that look like a direct media file we can feed straight to ffmpeg. */
const DIRECT_MEDIA_RE = /\.(mp4|m4v|mov|mkv|webm|avi|flv|ts|m3u8|mpd|mp3|m4a|aac|ogg|opus|wav|flac)(\?|#|$)/i;

export const HLS_RE = /\.m3u8(\?|#|$)/i;
export const DASH_RE = /\.mpd(\?|#|$)/i;
export const LIVE_HINTS = [
  /\.m3u8(\?|#|$)/i,
  /\.mpd(\?|#|$)/i,
  /\/live\//i,
  /\/hls\//i,
  /livestream/i,
  /youtube\.com\/live/i,
  /twitch\.tv\//i,
  /kick\.com\//i,
  /facebook\.com\/.+\/live/i,
  /stream/i,
];

import type { SourceKind } from "./types";
export type { SourceKind } from "./types";

/** Cheap client/server-safe classification of a user supplied link. */
export function classifySource(rawUrl: string): SourceKind {
  const url = rawUrl.trim();
  if (!url) return "page";
  if (url.startsWith("/api/media/") || url.startsWith("file:")) return "local";
  if (HLS_RE.test(url)) {
    return LIVE_HINTS.some((r) => r.test(url)) ? "live" : "hls";
  }
  if (DASH_RE.test(url)) return "dash";
  if (DIRECT_MEDIA_RE.test(url)) return "direct";
  return "page";
}

export const isProbablyLive = (rawUrl: string) =>
  LIVE_HINTS.some((r) => r.test(rawUrl.trim()));
