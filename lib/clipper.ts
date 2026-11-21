/**
 * The clipping engine.
 *
 *  • Local file / downloaded source → fast stream-copy cut (±re-encode when
 *    the requested start isn't on a keyframe).
 *  • Remote URL source → ffmpeg seeks the input directly, so you can clip a
 *    video without downloading the whole thing first.
 *  • Live stream → records from the live edge for N seconds, then trims.
 *  • Captions → ASS rendered over the cut with aspect-aware letterboxing so
 *    vertical (9:16, 1:1, 4:5) exports are clean.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildAss, clipCues, cuesFromText, escapeFilterPath, parseSubtitles, type CaptionStyle } from "./captions";
import {
  CLIPS_DIR,
  HLS_RE,
  LIVE_DIR,
  LIVE_MAX_SEC,
  WORK_DIR,
  ensureDirs,
} from "./config";
import { FFPROBE, FFMPEG, classifySource } from "./config";
import { parseFfmpegProgress, run, spawnCollect } from "./exec";
import { addClip, type ClipRecord } from "./library";
import { downloadSource, getSourceInfo, localSourcePath } from "./media";
import { bus, createTask, newId, updateTask, type Task } from "./tasks";
import { slugify, toFfmpegTs } from "./time";
import { gradeChain, motionChain, type MotionPreset } from "./motion";
import { resolveEditStyle } from "./templates";

export type AspectRatio = "original" | "9:16" | "1:1" | "4:5" | "16:9" | "4:3";

export type ClipOptions = {
  source: string;
  start: number; // seconds into the source
  end: number; // seconds into the source
  title?: string;
  aspect?: AspectRatio;
  captions?: string; // SRT/VTT text or plain text
  captionStyle?: CaptionStyle;
  forceReencode?: boolean;
  filename?: string;
  maxHeight?: number;
  /** Edit template: aspect + motion + caption style in one word. */
  template?: string;
  /** Camera motion preset (overrides the template's). */
  motion?: string;
  /** Colour grade: off | light | cinematic (defaults from template). */
  grade?: "off" | "light" | "cinematic";
};

export type RecordOptions = {
  source: string;
  durationSec: number;
  title?: string;
};

export type ClipResult = {
  task: Task;
  clip: ClipRecord;
};

// ───────────────────────────── size math ─────────────────────────────

const ASPECT_MAP: Record<Exclude<AspectRatio, "original">, number> = {
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
  "16:9": 16 / 9,
  "4:3": 4 / 3,
};

export function outputDimensions(
  srcW: number,
  srcH: number,
  aspect: AspectRatio,
  maxHeight = 1920,
): { w: number; h: number; pad: boolean } {
  if (aspect === "original") {
    const scale = Math.min(1, maxHeight / Math.max(1, srcH));
    return {
      w: even(srcW * scale),
      h: even(srcH * scale),
      pad: false,
    };
  }
  const ratio = ASPECT_MAP[aspect];
  let h = maxHeight;
  let w = Math.round(h * ratio);
  if (ratio >= 1 && w > 1920) {
    w = 1920;
    h = Math.round(w / ratio);
  }
  if (h % 2) h += 1;
  if (w % 2) w += 1;
  return { w, h, pad: true };
}

const even = (n: number) => (n % 2 ? Math.round(n) + 1 : Math.round(n));

// ───────────────────────── fast keyframe cut ─────────────────────────

/** Snap the start to the nearest keyframe at/before `start` so we can stream-copy. */
async function keyframeBefore(file: string, start: number): Promise<number | null> {
  const r = await run(
    FFPROBE,
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-skip_frame", "nokey",
      "-show_entries", "frame=pts_time",
      "-of", "csv=p=0",
      "-read_intervals", `${Math.max(0, start - 12)}%${start + 1}`,
      file,
    ],
    { timeoutMs: 30_000 },
  );
  if (r.code !== 0) return null;
  const times = r.stdout
    .split("\n")
    .map((l) => Number(l.trim().replace(/,$/, "")))
    .filter((n) => Number.isFinite(n) && n <= start + 0.001);
  if (!times.length) return null;
  return Math.max(...times);
}

// ───────────────────────────── the pipeline ─────────────────────────────

export async function createClip(opts: ClipOptions): Promise<ClipResult> {
  await ensureDirs();
  const style = resolveEditStyle({
    template: opts.template,
    aspect: opts.aspect,
    motion: opts.motion,
    captionStyle: opts.captionStyle,
  });
  const aspect: AspectRatio = style.aspect;
  const motion: MotionPreset = style.motion;
  const grade = opts.grade ?? style.grade;
  const src = opts.source.trim();
  if (!src) throw new Error("A video link or clip id is required.");

  if (!(opts.end > opts.start)) {
    throw new Error("End must be greater than start.");
  }

  const task = createTask({
    kind: "clip",
    title: opts.title?.trim() || `Clip ${toFfmpegTs(opts.start)} – ${toFfmpegTs(opts.end)}`,
    sourceUrl: src,
    message: "Resolving source…",
  });
  updateTask(task.id, { state: "running" });

  const job = (async (): Promise<ClipRecord> => {
    // 1. Where does the media come from?
    const info = await getSourceInfo(src);
    if (info.isLive) {
      throw new Error(
        "That link is a live stream. Use `recordLive` instead — it records for N seconds from now, then clips.",
      );
    }
    const duration = info.durationSec;
    if (duration && opts.start >= duration) {
      throw new Error(
        `Start (${toFfmpegTs(opts.start)}) is past the end of this video (${toFfmpegTs(duration)}).`,
      );
    }
    const end = duration ? Math.min(opts.end, duration) : opts.end;
    const start = Math.max(0, opts.start);

    let inputFile: string | null = null;
    if (info.kind === "local") inputFile = await localSourcePath(src);
    else if (info.kind === "page") {
      updateTask(task.id, { message: "Downloading source (first time for this link)…" });
      inputFile = await downloadSource(src, task, { maxHeight: opts.maxHeight ?? 1080 });
    } else if (info.kind === "direct") {
      // Direct files download faster than they seek-encode; manifests stream.
      try {
        updateTask(task.id, { message: "Fetching media…" });
        inputFile = await downloadSource(src, task, { maxHeight: opts.maxHeight ?? 1080 });
      } catch {
        inputFile = null; // remote seek fallback below
      }
    }
    const remote = !inputFile;
    const input = inputFile ?? info.previewUrl ?? src;
    const headers = remote ? info.headers ?? {} : {};

    // 2. Probe what we actually got (downloaded files can differ from the page).
    const probe = await probeLocal(input, headers);
    if (!probe.hasVideo) throw new Error("This source has no video track to clip.");
    const W = probe.width ?? 1920;
    const H = probe.height ?? 1080;
    // Goal: a 1080-class short edge (720p-class for widescreen) on any CPU.
    const targetLong =
      aspect === "original" ? 1280 : aspect === "9:16" ? 1920 : aspect === "16:9" ? 1280 : aspect === "4:3" ? 1440 : 1080;
    const { w, h, pad } = outputDimensions(W, H, aspect, targetLong);

    // 3. Decide stream copy vs re-encode.
    const needsReencode =
      opts.forceReencode ||
      pad ||
      !!opts.captions ||
      motion !== "none" ||
      grade !== "off" ||
      (aspect !== "original" && Math.abs(W / H - w / h) > 0.01);

    let seekStart = start;
    let copy = !needsReencode;
    if (copy && inputFile) {
      const kf = await keyframeBefore(inputFile, start);
      if (kf !== null && start - kf <= 0.75) seekStart = kf;
      else copy = false;
    }

    // 4. Captions file
    let assPath: string | null = null;
    if (opts.captions?.trim()) {
      const clipDur = Math.max(0.2, end - start);
      let cues = parseSubtitles(opts.captions);
      cues = cues.length
        ? clipCues(cues, start, end)
        : cuesFromText(opts.captions, clipDur);
      if (!cues.length) throw new Error("Captions were provided but no text could be parsed.");
      const ass = buildAss(cues, {
        width: w,
        height: h,
        style: opts.captionStyle ?? "clean",
      });
      assPath = path.join(WORK_DIR, `${task.id}.ass`);
      await fs.writeFile(assPath, ass, "utf8");
    }

    // 5. Output path
    const baseName =
      opts.filename?.replace(/[^\w.\-]+/g, "-") ||
      `${slugify(opts.title || info.title || "clip")}-${slugify(toFfmpegTs(start))}`;
    const hash = createHash("sha1").update(`${src}|${start}|${end}|${w}x${h}`).digest("hex").slice(0, 6);
    const fileName = `${baseName}-${hash}.mp4`;
    const outPath = path.join(CLIPS_DIR, fileName);

    // 6. Build the ffmpeg command
    // Aspect conversion fills the frame (center crop) like CapCut/Opus Clip:
    // scale so the frame is covered, then crop the overflow. Motion presets
    // and the grade run on the framed stream so the output size never drifts.
    const filterParts: string[] = [];
    const frame = pad
      ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30`
      : `scale=${w}:${h}:force_original_aspect_ratio=decrease,setsar=1,fps=30`;

    const motionFn = motionChain(motion, w, h, 30);
    const gradeFn = gradeChain(grade);
    const post = [motionFn, gradeFn].filter(Boolean).join(",");
    filterParts.push(`[0:v]${frame}${post ? `,${post}` : ""}[v]`);

    let mapArgs: string[];
    if (assPath) {
      filterParts.push(`[v]ass='${escapeFilterPath(assPath)}'[vout]`);
      mapArgs = ["-map", "[vout]", "-map", "0:a?"];
    } else {
      mapArgs = ["-map", "[v]", "-map", "0:a?"];
    }

    const args: string[] = [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-loglevel",
      "info",
      "-stats_period",
      "0.5",
    ];
    for (const [k, v] of Object.entries(headers)) args.push("-headers", `${k}: ${v}\r\n`);
    if (remote && classifySource(input) === "hls") {
      // Live manifests only carry the newest segments; ask for the oldest
      // buffered one so seeked cuts still land on real media.
      args.push("-live_start_index", "0");
    }
    args.push("-ss", toFfmpegTs(seekStart), "-t", toFfmpegTs(end - start + (start - seekStart)));
    args.push("-i", input !== src ? input : src);
    if (copy) {
      args.push("-c", "copy", "-avoid_negative_ts", "make_zero");
    } else {
      args.push(...mapArgs, "-filter_complex", filterParts.join(";"));
      args.push(
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-profile:v", "high",
        "-c:a", "aac",
        "-b:a", "160k",
        "-ac", "2",
        "-movflags", "+faststart",
      );
    }
    if (copy) {
      args.push("-movflags", "+faststart");
    }
    args.push(outPath);

    updateTask(task.id, {
      message: copy ? "Cutting (stream copy)…" : "Encoding clip…",
      progress: 2,
      meta: { mode: copy ? "copy" : "encode", width: w, height: h, motion, grade },
    });

    await runFfmpeg(args, task, end - seekStart);

    // 7. Verify + index
    const st = await fs.stat(outPath).catch(() => null);
    if (!st || st.size < 1024) throw new Error("ffmpeg finished but produced an empty file.");
    const outProbe = await probeLocal(outPath, {}).catch(() => null);

    const record: ClipRecord = {
      id: newId("c_"),
      title: opts.title?.trim() || info.title || "Untitled clip",
      file: outPath,
      fileName,
      sizeBytes: st.size,
      durationSec: outProbe?.durationSec ?? end - start,
      createdAt: Date.now(),
      sourceUrl: src,
      startSec: start,
      endSec: end,
      aspect,
      captions: !!assPath,
      style: assPath ? (opts.captionStyle ?? style.captionStyle) : "none",
      meta: {
        width: w,
        height: h,
        mode: copy ? "copy" : "encode",
        motion,
        grade,
        template: style.template,
      },
    };
    await addClip(record);
    updateTask(task.id, {
      state: "done",
      progress: 100,
      message: "Clip ready",
      outputPath: outPath,
      outputName: fileName,
      sizeBytes: st.size,
      durationSec: record.durationSec,
    });
    if (assPath) await fs.unlink(assPath).catch(() => {});
    return record;
  })();

  try {
    const clip = await job;
    return { task: updateTask(task.id, { state: "done" }) ?? task, clip };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateTask(task.id, { state: "error", message, error: message });
    throw err;
  }
}

async function probeLocal(source: string, headers: Record<string, string>) {
  const args = [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
  ];
  const input = source.startsWith("http") ? "http" : "";
  if (input) args.push("-headers", Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n"));
  args.push(source);
  const r = await run(FFPROBE, args, { timeoutMs: 60_000 });
  if (r.code !== 0) {
    // Old ffprobe builds can crash on some manifests/containers — ask ffmpeg.
    const { probeWithFfmpeg } = await import("./media");
    return probeWithFfmpeg(source, headers);
  }
  const j = JSON.parse(r.stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };
  const v = j.streams?.find((s) => s.codec_type === "video");
  const a = j.streams?.find((s) => s.codec_type === "audio");
  const d = Number(j.format?.duration);
  return {
    durationSec: Number.isFinite(d) && d > 0 ? d : null,
    hasVideo: !!v,
    hasAudio: !!a,
    width: v?.width,
    height: v?.height,
  };
}

async function runFfmpeg(args: string[], task: Task, totalSec: number) {
  return new Promise<void>((resolve, reject) => {
    const h = spawnCollect(FFMPEG, args);
    let buffer = "";
    h.child.stderr?.on("data", (b: Buffer) => {
      buffer += b.toString();
      const chunk = buffer;
      buffer = "";
      const p = parseFfmpegProgress(chunk);
      if (p.outTimeSec !== undefined && totalSec > 0) {
        const pct = Math.max(2, Math.min(99, (p.outTimeSec / totalSec) * 100));
        updateTask(task.id, {
          progress: Math.round(pct),
          speed: p.speed,
          message: `Encoding ${Math.round(pct)}%${p.speed ? ` · ${p.speed}` : ""}`,
        });
      }
    });
    h.done.then((res) => {
      if (res.code === 0) return resolve();
      const tail = res.stderr
        .split("\n")
        .filter((l) => /error|invalid|failed|unable|no such|denied/i.test(l))
        .slice(-2)
        .join(" ")
        .trim();
      reject(new Error(tail || `ffmpeg exited with code ${res.code}`));
    });
  });
}

// ───────────────────────────── live recording ─────────────────────────────

export type RecordResult = {
  task: Task;
  filePath: string;
  durationSec: number;
};

/**
 * Record a live stream (HLS/DASH/page live URL) for `durationSec`, starting
 * now. Writes an MP4 you can preview and clip immediately.
 */
export async function recordLive(opts: RecordOptions): Promise<RecordResult> {
  await ensureDirs();
  const src = opts.source.trim();
  const durationSec = Math.min(
    LIVE_MAX_SEC,
    Math.max(5, Math.round(opts.durationSec || 60)),
  );
  const info = await getSourceInfo(src);
  const input = info.previewUrl ?? src;
  if (!input) throw new Error("Could not find a playable stream URL for that link.");

  const task = createTask({
    kind: "record",
    title: opts.title?.trim() || `Live recording ${new Date().toLocaleTimeString()}`,
    sourceUrl: src,
    state: "running",
    message: `Recording live for ${durationSec}s…`,
  });

  const fileName = `${slugify(opts.title || "live")}-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}-${task.id.slice(-4)}.mp4`;
  const outPath = path.join(LIVE_DIR, fileName);

  const args = [
    "-hide_banner", "-nostdin", "-y", "-loglevel", "info", "-stats_period", "0.5",
  ];
  for (const [k, v] of Object.entries(info.headers ?? {})) args.push("-headers", `${k}: ${v}\r\n`);
  if (HLS_RE.test(input)) args.push("-live_start_index", "-1");
  args.push(
    "-i", input,
    "-t", String(durationSec),
    "-map", "0:v:0?", "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart+frag_keyframe+empty_moov",
    outPath,
  );

  const started = Date.now();
  let stderrTail = "";
  const h = spawnCollect(FFMPEG, args, {
    onStderr: (s) => {
      stderrTail = (stderrTail + s).slice(-8000);
      const p = parseFfmpegProgress(s);
      if (p.outTimeSec !== undefined) {
        const pct = Math.min(99, (p.outTimeSec / durationSec) * 100);
        updateTask(task.id, {
          progress: Math.round(pct),
          message: `Recording live ${toFfmpegTs(p.outTimeSec)} / ${toFfmpegTs(durationSec)}`,
        });
      }
    },
  });

  const cancel = () => h.kill("SIGINT");
  bus.once(`cancel:${task.id}`, cancel);

  const res = await h.done;
  bus.off(`cancel:${task.id}`, cancel);
  const elapsed = (Date.now() - started) / 1000;

  const st = await fs.stat(outPath).catch(() => null);
  if (!st || st.size < 4096) {
    const msg = `Recording failed. ${stderrTail.split("\n").filter(Boolean).slice(-2).join(" ")}`;
    updateTask(task.id, { state: "error", message: msg, error: msg });
    throw new Error(msg);
  }

  // Remux to a clean, seekable MP4 (the live muxer writes fragmented output).
  const finalPath = outPath.replace(/\.mp4$/, "-final.mp4");
  const remux = await run(
    FFMPEG,
    ["-hide_banner", "-y", "-i", outPath, "-c", "copy", "-movflags", "+faststart", finalPath],
    { timeoutMs: 10 * 60_000 },
  );
  const resolved = remux.code === 0 ? finalPath : outPath;
  if (resolved !== outPath) await fs.unlink(outPath).catch(() => {});

  const outProbe = await probeLocal(resolved, {}).catch(() => null);
  updateTask(task.id, {
    state: res.code === 0 ? "done" : "error",
    progress: 100,
    message: res.code === 0 ? "Recording ready" : "Recording ended early",
    outputPath: resolved,
    outputName: path.basename(resolved),
    sizeBytes: st.size,
    durationSec: outProbe?.durationSec ?? elapsed,
  });

  return {
    task,
    filePath: resolved,
    durationSec: outProbe?.durationSec ?? elapsed,
  };
}

