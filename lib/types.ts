/**
 * Pure types shared by the engine (server) and the studio (client).
 * This module must never import Node built-ins.
 */

export type SourceKind = "hls" | "dash" | "live" | "page" | "direct" | "local";

export type MediaInfo = {
  durationSec: number | null;
  isLive: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  bitrate?: number;
  title?: string;
  thumbnail?: string;
  uploader?: string;
};

export type SourceInfo = MediaInfo & {
  kind: SourceKind;
  inputUrl: string;
  previewUrl: string | null;
  previewType: "hls" | "file" | "none";
  filePath?: string;
  needsProxy: boolean;
  headers?: Record<string, string>;
  resolvedAt: number;
  note?: string;
};

export type TaskState = "queued" | "running" | "done" | "error" | "cancelled";

export type Task = {
  id: string;
  kind: "clip" | "download" | "record";
  title: string;
  state: TaskState;
  progress: number;
  speed?: string;
  etaSec?: number;
  message: string;
  createdAt: number;
  updatedAt: number;
  outputPath?: string;
  outputName?: string;
  sizeBytes?: number;
  durationSec?: number;
  sourceUrl?: string;
  error?: string;
  meta?: Record<string, unknown>;
};

export type ClipRecord = {
  id: string;
  title: string;
  file: string;
  fileName: string;
  sizeBytes: number;
  durationSec: number;
  createdAt: number;
  sourceUrl: string;
  startSec: number;
  endSec: number;
  aspect: string;
  captions: boolean;
  style: string;
  meta?: Record<string, unknown>;
};

export type AspectRatio = "original" | "9:16" | "1:1" | "4:5" | "16:9" | "4:3";

export type CaptionStyleName =
  | "clean"
  | "bold"
  | "karaoke"
  | "highlight"
  | "neon"
  | "minimal";

export type Health = {
  ok: boolean;
  name: "clipforge";
  version: string;
  ffmpeg: { path: string; ok: boolean; version?: string };
  ffprobe: { path: string; ok: boolean; version?: string };
  ytdlp: { path: string; ok: boolean; version?: string };
  font: string | null;
  dataDir: string;
  liveMaxSec: number;
  hint?: string;
};
