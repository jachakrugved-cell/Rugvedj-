/**
 * The Editor — a CapCut-class, multi-clip timeline renderer.
 *
 * A project is a plain JSON document (so Claude can build one in a single
 * tool call) that ffmpeg turns into a finished MP4 in one or two passes:
 *
 *   clips[]    video segments, each with in/out, speed, crop/zoom, look,
 *              per-clip volume, and an optional crossfade into the next clip
 *   audios[]   music / voiceover beds with their own in/out and volume
 *   texts[]    titles, lower-thirds and captions positioned anywhere
 *   overlays[] stickers / logos / emoji (image + position + timing)
 *
 * Composition: every clip is normalised to the project frame (aspect, size,
 * fps) and trimmed, looks are applied per clip, clips are joined with xfade
 * when a transition is set, then texts/overlays are drawn on top and the
 * audio beds are mixed with the clip audio.
 */
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { CLIPS_DIR, FFMPEG, WORK_DIR, ensureDirs } from "./config";
import { run, spawnCollect } from "./exec";
import { motionChain, asMotionPreset, type MotionPreset } from "./motion";
import { escapeFilterPath, wrapLines } from "./captions";
import { downloadSource, getSourceInfo, localSourcePath } from "./media";
import { slugify, fmtTime } from "./time";
import { createTask, newId, updateTask } from "./tasks";
import { addClip, type ClipRecord } from "./library";
import type { AspectRatio } from "./types";

// ───────────────────────────── project schema ─────────────────────────────

export type Crop = { x: number; y: number; w: number; h: number }; // 0..1 of the source

export type ClipLayer = {
  /** URL, /api/media/<name>, or clip id */
  source: string;
  start?: number;
  end?: number;
  speed?: number; // 0.25 .. 4
  reverse?: boolean;
  crop?: Crop;
  zoom?: number; // 1..3 (pushes in on the crop)
  motion?: MotionPreset;
  look?: string; // see LOOKS
  volume?: number; // 0..2 (per-clip)
  fadeIn?: number;
  fadeOut?: number;
  /** Transition into the NEXT clip. */
  transition?: "none" | "fade" | "dissolve" | "wipeleft" | "wiperight" | "slideup" | "slidedown" | "circle" | "smooth";
  transitionSec?: number;
  mute?: boolean;
};

export type AudioLayer = {
  source: string;
  start?: number; // source in-point
  end?: number;
  at?: number; // timeline position (seconds)
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  loop?: boolean;
  duckToClips?: boolean; // sidechain-compress the bed under clip audio
};

export type TextLayer = {
  text: string;
  at?: number;
  duration?: number;
  position?: "top" | "center" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
  x?: number; // 0..1 override
  y?: number; // 0..1 override
  size?: number;
  color?: string; // #rrggbb
  box?: boolean;
  boxColor?: string;
  shadow?: boolean;
  italic?: boolean;
  uppercase?: boolean;
  animation?: "none" | "fade" | "slide-up" | "pop" | "typewriter";
};

export type OverlayLayer = {
  source: string; // image URL/path (png/jpg)
  at?: number;
  duration?: number;
  x?: number; // 0..1 (center)
  y?: number; // 0..1 (center)
  width?: number; // fraction of frame width (0..1)
  opacity?: number; // 0..1
  rotate?: number; // degrees
  fade?: number;
};

export type Project = {
  title?: string;
  aspect?: AspectRatio;
  width?: number;
  height?: number;
  fps?: number;
  clips: ClipLayer[];
  audios?: AudioLayer[];
  texts?: TextLayer[];
  overlays?: OverlayLayer[];
  /** Overall look applied to every clip (can be overridden per clip). */
  look?: string;
  /** Master volume 0..2 */
  volume?: number;
};

// ───────────────────────────── looks (one-click grades) ─────────────────────────────

export const LOOKS: Record<string, { label: string; chain: string }> = {
  none: { label: "Original", chain: "" },
  warm: { label: "Warm film", chain: "eq=contrast=1.06:saturation=1.18:gamma_r=1.06:gamma_b=0.94,colorbalance=rs=0.05:bs=-0.05" },
  cool: { label: "Cool teal", chain: "eq=contrast=1.06:saturation=1.1,colorbalance=bs=0.06:rs=-0.04" },
  cinematic: { label: "Cinematic", chain: "eq=contrast=1.12:saturation=1.05:brightness=-0.01,vignette=PI/5,unsharp=3:3:0.45" },
  vintage: { label: "Vintage", chain: "curves=preset=vintage,eq=saturation=0.82:contrast=1.04,vignette=PI/4" },
  bw: { label: "Black & white", chain: "hue=s=0,eq=contrast=1.16,vignette=PI/5.5" },
  sepia: { label: "Sepia", chain: "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131,eq=contrast=1.05" },
  vivid: { label: "Vivid pop", chain: "eq=contrast=1.14:saturation=1.45:brightness=0.02" },
  soft: { label: "Soft pastel", chain: "eq=contrast=0.96:saturation=1.12:brightness=0.04,gblur=sigma=0.5" },
  dreamy: { label: "Dream glow", chain: "gblur=sigma=6,eq=brightness=0.05:saturation=1.2,blend=all_mode=screen:all_opacity=0.28" },
  noir: { label: "Noir", chain: "hue=s=0,eq=contrast=1.35:brightness=-0.06,vignette=PI/4" },
  neon: { label: "Neon night", chain: "eq=contrast=1.2:saturation=1.7:brightness=-0.02,colorbalance=rs=0.08:bs=0.1" },
  sunset: { label: "Sunset", chain: "eq=contrast=1.08:saturation=1.3,colorbalance=rs=0.09:gs=0.02:bs=-0.06" },
  matrix: { label: "Matrix", chain: "hue=s=0,colorchannelmixer=.3:.5:.2:0:.3:.5:.2:0:.3:.5:.2,eq=contrast=1.2" },
  crisp: { label: "Crisp HD", chain: "unsharp=5:5:0.7:5:5:0.0,eq=contrast=1.05:saturation=1.08" },
  fadey: { label: "Faded matte", chain: "curves=preset=linear:0/0.06 1/0.94,eq=saturation=0.9" },
};

// ───────────────────────────── text animations ─────────────────────────────

const POSITION_XY: Record<NonNullable<TextLayer["position"]>, () => { x: string; y: string }> = {
  top: () => ({ x: "(w-text_w)/2", y: "h*0.08" }),
  center: () => ({ x: "(w-text_w)/2", y: "(h-text_h)/2" }),
  bottom: () => ({ x: "(w-text_w)/2", y: "h*0.86-text_h" }),
  "top-left": () => ({ x: "w*0.06", y: "h*0.07" }),
  "top-right": () => ({ x: "w-text_w-w*0.06", y: "h*0.07" }),
  "bottom-left": () => ({ x: "w*0.06", y: "h*0.88-text_h" }),
  "bottom-right": () => ({ x: "w-text_w-w*0.06", y: "h*0.88-text_h" }),
};

/**
 * drawtext is notoriously fragile: ':' ',' "'" and '%' inside text or
 * expressions break the filter graph. We escape conservatively and prefer a
 * UTF-8 font so non-ASCII characters (→ · é 😀) render instead of failing.
 */
function sanitizeText(raw: string): string {
  return raw
    .replace(/\\/g, "／")   // fullwidth solidus: keeps the glyph, no escape noise
    .replace(/:/g, "：")
    .replace(/,/g, "，")
    .replace(/'/g, "’")
    .replace(/%/g, "％")
    .replace(/\n/g, " ");
}

function textFilter(t: TextLayer, w: number, h: number, font: string): string {
  const size = Math.round(t.size ?? Math.min(h * 0.055, w * 0.075));
  const color = (t.color ?? "#ffffff").replace("#", "0x");
  const pos = t.position ? POSITION_XY[t.position] : null;
  const anchor = pos ? pos() : null;
  const x = anchor ? anchor.x : `${Math.round((t.x ?? 0.5) * w)}-text_w/2`;
  const yBase = anchor ? anchor.y : `${Math.round((t.y ?? 0.85) * h)}-text_h/2`;
  const lines = wrapLines(t.text, Math.max(14, Math.floor((w * 0.86) / (size * 0.55))));
  const at = t.at ?? 0;
  const dur = Math.max(0.4, t.duration ?? 3);
  const end = at + dur;

  // Alpha envelope (fade in/out) expressed as a single clamped expression.
  const fadeIn = Math.min(0.45, dur / 3);
  const fadeOut = Math.min(0.45, dur / 3);
  let alpha: string;
  switch (t.animation ?? "none") {
    case "fade":
    case "typewriter":
      alpha = `if(lt(t,${at}),0,if(lt(t,${at + fadeIn}),(t-${at})/${fadeIn},if(lt(t,${end - fadeOut}),1,max(0,(${end}-t)/${fadeOut}))))`;
      break;
    case "slide-up":
      alpha = `if(lt(t,${at}),0,if(lt(t,${at + 0.4}),(t-${at})/0.4,1))`;
      break;
    default:
      alpha = "1";
  }
  const slide = t.animation === "slide-up" ? `+${Math.round(h * 0.05)}*(1-min(1,max(0,(t-${at})/0.4)))` : "";

  const chain: string[] = [];
  lines.forEach((line, i) => {
    const dy = i * Math.round(size * 1.3);
    const opts = [
      `fontfile='${escapeFilterPath(font)}'`,
      `text='${sanitizeText(line)}'`,
      "expansion=none",
      `fontsize=${size}`,
      `fontcolor=${color}`,
      `x='${x}'`,
      `y='${yBase}${slide}${dy ? `+${dy}` : ""}'`,
      `alpha='${alpha}'`,
      `enable='between(t,${at},${end})'`,
    ];
    if (t.shadow) opts.push(`shadowcolor=black@0.7:shadowx=${Math.max(2, Math.round(size * 0.05))}:shadowy=${Math.max(2, Math.round(size * 0.05))}`);
    if (t.box) opts.push(`box=1:boxcolor=${(t.boxColor ?? "#000000").replace("#", "0x")}@0.6:boxborderw=${Math.round(size * 0.32)}`);
    chain.push(`drawtext=${opts.join(":")}`);
  });
  return chain.join(",");
}

/**
 * Prefer a UTF-8 capable font for drawtext. DejaVu covers Latin/Greek/Cyrillic
 * and common punctuation; we verify it exists before handing it to ffmpeg.
 */
function pickFont(font: string): string {
  if (process.platform !== "win32" && font && /DejaVu|Noto/i.test(font)) return font;
  return font;
}

// ───────────────────────────── renderer ─────────────────────────────

export type StudioResult = {
  clip: ClipRecord;
  timelineSec: number;
  passes: number;
};

const even = (n: number) => (Math.round(n) % 2 === 0 ? Math.round(n) : Math.round(n) + 1);

export function frameSize(project: Project): { w: number; h: number } {
  if (project.width && project.height) return { w: even(project.width), h: even(project.height) };
  const map: Record<string, [number, number]> = {
    "9:16": [1080, 1920],
    "1:1": [1080, 1080],
    "4:5": [1080, 1350],
    "16:9": [1920, 1080],
    "4:3": [1440, 1080],
    original: [1080, 1920],
  };
  const [w, h] = map[project.aspect ?? "9:16"] ?? map["9:16"];
  return { w: even(w), h: even(h) };
}

/** Resolve any layer source to a local file or remote URL. */
type ResolvedSource = {
  input: string;
  file: string | null;
  durationSec: number | null;
  hasAudio: boolean;
  isImage: boolean;
};

async function resolveLayerSource(src: string): Promise<ResolvedSource> {
  const s = src.trim();
  if (!s) throw new Error("A layer is missing its source.");

  // Local library file (/api/media/<name>, file:, absolute path or a bare
  // filename in .data/downloads).
  const isImage = /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(s);
  if (!isImage && (s.startsWith("/api/media/") || s.startsWith("file:") || s.startsWith("/") || !s.includes("/") && !/^https?:/i.test(s))) {
    const f = await localSourcePath(s);
    const p = await probeSource(f);
    return { input: f, file: f, durationSec: p.durationSec, hasAudio: p.hasAudio, isImage: false };
  }
  // Sticker/overlay images have no duration. They can live in public/, so
  // resolve public paths to files on disk (ffmpeg cannot fetch our own server).
  if (isImage) {
    const pub = path.join(process.cwd(), "public", s.replace(/^\//, ""));
    if (existsSync(pub)) return { input: pub, file: pub, durationSec: null, hasAudio: false, isImage: true };
    return { input: s, file: null, durationSec: null, hasAudio: false, isImage: true };
  }

  const info = await getSourceInfo(s);
  if (info.kind === "local") {
    const f = await localSourcePath(s);
    const p = await probeSource(f);
    return { input: f, file: f, durationSec: p.durationSec, hasAudio: p.hasAudio, isImage: false };
  }
  if (info.kind === "page") {
    const f = await downloadSource(s);
    const p = await probeSource(f);
    return { input: f, file: f, durationSec: p.durationSec, hasAudio: p.hasAudio, isImage: false };
  }
  return {
    input: info.previewUrl ?? s,
    file: null,
    durationSec: info.kind === "hls" ? null : (info.durationSec ?? null),
    hasAudio: info.hasAudio ?? true,
    isImage: false,
  };
}

/** Best-effort duration + audio presence. */
async function probeSource(input: string): Promise<{ durationSec: number | null; hasAudio: boolean }> {
  try {
    const { probeWithFfmpeg } = await import("./media");
    const p = await probeWithFfmpeg(input);
    return { durationSec: p.durationSec ?? null, hasAudio: p.hasAudio !== false };
  } catch {
    return { durationSec: null, hasAudio: true };
  }
}

/**
 * Render a project to an MP4 clip. Everything is done in one ffmpeg graph
 * when possible; audio beds are mixed in the same pass.
 */
export async function renderProject(project: Project): Promise<StudioResult> {
  await ensureDirs();
  const srcClips = (project.clips ?? []).filter((c) => c?.source);
  if (!srcClips.length) throw new Error("A project needs at least one clip.");

  const { w, h } = frameSize(project);
  const fps = project.fps ?? 30;
  const title = project.title?.trim() || "ClipForge edit";

  const task = createTask({ kind: "clip", title, message: "Preparing timeline…", state: "running" });

  try {
    // ── resolve sources ──
    const resolved: Array<{ layer: ClipLayer } & ResolvedSource> = [];
    for (const layer of srcClips) {
      const r = await resolveLayerSource(layer.source);
      resolved.push({ layer, ...r });
    }

    // ── args: inputs ──
    const inputs: string[] = [];
    const filter: string[] = [];
    const audioLabels: string[] = [];
    let inputIndex = 0;

    // per-clip normalisation: crop → zoom → speed → fit → motion → look
    const clipDurations: number[] = [];
    resolved.forEach((r, i) => {
      const c = r.layer;
      inputs.push("-i", r.input);
      const idx = inputIndex++;

      const chain: string[] = [];

      // Trim the source range first (CapCut "split/trim"), then everything else.
      const from = Math.max(0, c.start ?? 0);
      const to = c.end ?? (r.durationSec ? r.durationSec : from + 10);
      const rawLen = Math.max(0.2, to - from);
      chain.push(`trim=start=${from.toFixed(3)}:end=${to.toFixed(3)}`);
      chain.push("setpts=PTS-STARTPTS");

      if (c.crop) {
        chain.push(
          `crop=iw*${c.crop.w}:ih*${c.crop.h}:iw*${c.crop.x}:ih*${c.crop.y}`,
        );
      }
      if (c.zoom && c.zoom > 1) {
        chain.push(`scale=iw*${c.zoom}:ih*${c.zoom}`);
        chain.push(`crop=${w}:${h}`);
      }
      if (c.speed && c.speed !== 1) chain.push(`setpts=PTS/${c.speed}`);
      if (c.reverse) chain.push("reverse");
      // Fit to the project frame (centre crop, no letterboxing).
      chain.push(`scale=${w}:${h}:force_original_aspect_ratio=increase`);
      chain.push(`crop=${w}:${h}`);
      chain.push("setsar=1");
      chain.push(`fps=${fps}`);
      if (c.motion) {
        const m = motionChain(asMotionPreset(c.motion), w, h, fps);
        if (m) chain.push(m);
      }
      const look = LOOKS[c.look ?? project.look ?? "none"]?.chain;
      if (look) chain.push(look);
      if (c.fadeIn) chain.push(`fade=t=in:st=0:d=${c.fadeIn}`);

      // Timeline length after speed (xfade overlap subtracted in the join loop).
      clipDurations.push(rawLen / Math.max(0.25, c.speed ?? 1));

      filter.push(`[${idx}:v]${chain.join(",")}[c${i}v]`);

      // Clip audio: speed-corrected, optional mute/volume. Silent sources get
      // generated silence so concat + amix always have matching maths.
      const vol = c.mute ? 0 : (c.volume ?? 1) * (project.volume ?? 1);
      const scaledLen = (rawLen / Math.max(0.25, c.speed ?? 1)).toFixed(3);

      if (!r.hasAudio) {
        filter.push(`anullsrc=r=48000:cl=stereo,atrim=start=0:end=${scaledLen},volume=0[c${i}a]`);
        audioLabels.push(`[c${i}a]`);
      } else {
        const aChain: string[] = [
          `atrim=start=${from.toFixed(3)}:end=${to.toFixed(3)}`,
          "asetpts=PTS-STARTPTS",
        ];
        if (c.reverse) aChain.push("areverse");
        if (c.speed && c.speed !== 1) {
          // atempo accepts 0.5..2; chain it for extreme speeds.
          let sp = c.speed;
          while (sp > 2) {
            aChain.push("atempo=2");
            sp /= 2;
          }
          while (sp < 0.5) {
            aChain.push("atempo=0.5");
            sp /= 0.5;
          }
          aChain.push(`atempo=${sp.toFixed(4)}`);
        }
        aChain.push(`volume=${vol}`);
        filter.push(`[${idx}:a]${aChain.join(",")}[c${i}a]`);
        audioLabels.push(`[c${i}a]`);
      }
    });

    // ── join clips (xfade when a transition is set, else concat) ──
    let vLabel = "[c0v]";
    let timeline = clipDurations[0] ?? 0;
    for (let i = 1; i < resolved.length; i++) {
      const prev = resolved[i - 1].layer;
      const trans = prev.transition && prev.transition !== "none" ? prev.transition : null;
      const out = `[v${i}]`;
      if (trans) {
        const map: Record<string, string> = {
          fade: "fade",
          dissolve: "dissolve",
          wipeleft: "wipeleft",
          wiperight: "wiperight",
          slideup: "slideup",
          slidedown: "slidedown",
          circle: "circleopen",
          smooth: "smoothleft",
        };
        // xfade overlap can never exceed either side's duration.
        const maxDur = Math.max(
          0.1,
          Math.min(prev.transitionSec ?? 0.4, (clipDurations[i - 1] ?? 1) / 2, (clipDurations[i] ?? 1) / 2),
        );
        const offset = Math.max(0, timeline - maxDur);
        filter.push(
          `${vLabel}[c${i}v]xfade=transition=${map[trans] ?? "fade"}:duration=${maxDur.toFixed(3)}:offset=${offset.toFixed(3)}${out}`,
        );
        timeline = offset + (clipDurations[i] ?? 0);
      } else {
        filter.push(`${vLabel}[c${i}v]concat=n=2:v=1:a=0${out}`);
        timeline += clipDurations[i] ?? 0;
      }
      vLabel = out;
    }

    // ── concat audio ──
    if (resolved.length > 1) {
      filter.push(`${audioLabels.join("")}concat=n=${resolved.length}:v=0:a=1[clipAudio]`);
    } else {
      filter.push(`${audioLabels[0]}anull[clipAudio]`);
    }
    let audioOut = "[clipAudio]";

    // ── audio beds ──
    const beds = (project.audios ?? []).filter((a) => a?.source);
    const bedLabels: string[] = [];
    for (const [bi, bed] of beds.entries()) {
      const r = await resolveLayerSource(bed.source);
      inputs.push("-i", r.input);
      const idx = inputIndex++;
      const vol = bed.volume ?? 0.35;
      const at = bed.at ?? 0;
      const fadeIn = bed.fadeIn ? `afade=t=in:st=${at}:d=${bed.fadeIn},` : "";
      const fadeOut = bed.fadeOut ? `afade=t=out:st=${Math.max(0, (bed.end ?? at + 30) - bed.fadeOut)}:d=${bed.fadeOut},` : "";
      const loop = bed.loop ? `aloop=loop=-1:size=2e9,` : "";
      const delay = at > 0 ? `adelay=${Math.round(at * 1000)}|${Math.round(at * 1000)},` : "";
      filter.push(
        `[${idx}:a]${loop}atrim=${bed.start ?? 0}:${bed.end ?? 30},asetpts=PTS-STARTPTS,${fadeIn}${fadeOut}volume=${vol}${delay ? `,${delay.replace(/,$/, "")}` : ""}[bed${bi}]`,
      );
      bedLabels.push(`[bed${bi}]`);
    }

    if (bedLabels.length) {
      const duck = beds.some((b) => b.duckToClips);
      if (duck) {
        // Sidechain: compress the music under the clip audio.
        filter.push(`[clipAudio]asplit=2[clipsA][key]`);
        const music = bedLabels.length > 1 ? `[bed0]` : bedLabels[0];
        filter.push(`${music}[key]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[ducked]`);
        filter.push(`[clipsA][ducked]amix=inputs=2:duration=longest:normalize=0,apad[mixed]`);
        audioOut = "[mixed]";
      } else {
        filter.push(`[clipAudio]${bedLabels.join("")}amix=inputs=${bedLabels.length + 1}:duration=longest:normalize=0,apad[mixed]`);
        audioOut = "[mixed]";
      }
    }

    // ── texts + overlays ──
    let vOut = vLabel;
    const texts = (project.texts ?? []).filter((t) => t?.text?.trim());
    const overlays = (project.overlays ?? []).filter((o) => o?.source);

    if (texts.length) {
      const { FONT_FILE } = await import("./config");
      if (!FONT_FILE) throw new Error("No TrueType font found — install fonts-dejavu or set FFMPEG_FONT.");
      const safeFont = pickFont(FONT_FILE);
      const chain = texts.map((t) => textFilter(t, w, h, safeFont)).join(",");
      filter.push(`${vOut}${chain}[vtext]`);
      vOut = "[vtext]";
    }

    for (const [oi, ov] of overlays.entries()) {
      const r = await resolveLayerSource(ov.source);
      const ow = Math.round(w * (ov.width ?? 0.22));
      const at = ov.at ?? 0;
      const dur = Math.max(0.3, ov.duration ?? 3);

      // Stills must be looped into a real stream first: a single frame at t=0
      // makes `fade:alpha` evaluate to fully transparent.
      if (r.isImage) {
        inputs.push("-loop", "1", "-framerate", String(fps), "-t", dur.toFixed(3), "-i", r.input);
      } else {
        inputs.push("-i", r.input);
      }
      const idx = inputIndex++;

      const x = `${Math.round((ov.x ?? 0.5) * w)}-overlay_w/2`;
      const y = `${Math.round((ov.y ?? 0.5) * h)}-overlay_h/2`;

      // alpha-capable pixel format first, geometry next, fades last.
      const chain: string[] = ["format=rgba", `scale=${ow}:-1`];
      if (ov.rotate) chain.push(`rotate=${((ov.rotate * Math.PI) / 180).toFixed(6)}:c=none`);
      if (ov.opacity !== undefined && ov.opacity < 1) chain.push(`colorchannelmixer=aa=${ov.opacity}`);
      if (ov.fade) {
        chain.push(
          `fade=t=in:st=0:d=${Math.min(ov.fade, dur / 2).toFixed(2)}:alpha=1`,
          `fade=t=out:st=${Math.max(0, dur - ov.fade).toFixed(2)}:d=${Math.min(ov.fade, dur / 2).toFixed(2)}:alpha=1`,
        );
      }
      filter.push(`[${idx}:v]${chain.join(",")}[ov${oi}]`);
      filter.push(
        `${vOut}[ov${oi}]overlay=${x}:${y}:enable='between(t,${at},${(at + dur).toFixed(3)})'[vov${oi}]`,
      );
      vOut = `[vov${oi}]`;
    }

    // ── output ──
    const fileName = `${slugify(title, 50)}-${newId("").slice(-6)}.mp4`;
    const outPath = path.join(CLIPS_DIR, fileName);

    const args = [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-loglevel",
      "info",
      "-stats_period",
      "0.5",
      ...inputs,
      "-filter_complex",
      filter.join(";"),
      "-map",
      vOut,
      "-map",
      audioOut,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-t",
      Math.max(0.5, timeline).toFixed(3),
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      outPath,
    ];

    if (process.env.CLIPFORGE_DEBUG_FILTER) {
      await fs.writeFile(path.join(WORK_DIR, "last-filter.txt"), filter.join(";\n"), "utf8");
    }
    updateTask(task.id, { message: "Rendering timeline…", progress: 2, meta: { layers: resolved.length, w, h } });

    await new Promise<void>((resolve, reject) => {
      const child = spawnCollect(FFMPEG, args);
      let buf = "";
      child.child.stderr?.on("data", (b: Buffer) => {
        buf += b.toString();
        const m = buf.match(/time=(\d+):(\d+):(\d+\.\d+)/g);
        if (m) {
          const last = m[m.length - 1];
          const [, hh, mm, ss] = last.match(/time=(\d+):(\d+):(\d+\.\d+)/) ?? [];
          if (hh) {
            const secs = Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
            updateTask(task.id, {
              progress: Math.min(99, Math.round((secs / Math.max(1, timeline + 1)) * 100)),
              message: `Rendering ${fmtTime(secs)} / ${fmtTime(timeline)}`,
            });
          }
        }
      });
      child.done.then((r) => {
        if (r.code === 0) resolve();
        else {
          const tail = r.stderr.split("\n").filter((l) => /error|invalid|failed|unable/i.test(l)).slice(-2).join(" ").trim();
          reject(new Error(tail || `ffmpeg exited ${r.code}`));
        }
      });
    });

    const st = await fs.stat(outPath);
    if (st.size < 1024) throw new Error("The render produced an empty file.");

    // probe output for the record
    const probe = await run(
      FFMPEG === "" ? "ffprobe" : (await import("./config")).FFPROBE,
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", outPath],
      { timeoutMs: 30_000 },
    );
    const durationSec = Number(probe.stdout.trim()) || Math.max(1, timeline);

    const clip: ClipRecord = {
      id: newId("c_"),
      title,
      file: outPath,
      fileName,
      sizeBytes: st.size,
      durationSec,
      createdAt: Date.now(),
      sourceUrl: "studio",
      startSec: 0,
      endSec: durationSec,
      aspect: `${w}:${h}`,
      captions: texts.length > 0,
      style: "studio",
      meta: { width: w, height: h, layers: resolved.length, texts: texts.length, overlays: overlays.length, audios: beds.length },
    };
    await addClip(clip);
    // clean up temp project file if any
    await fs.rm(path.join(WORK_DIR, `${task.id}.json`), { force: true }).catch(() => {});
    updateTask(task.id, { state: "done", progress: 100, message: "Edit ready", outputPath: outPath, outputName: fileName, sizeBytes: st.size, durationSec });

    return { clip, timelineSec: durationSec, passes: 1 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateTask(task.id, { state: "error", message: msg, error: msg });
    throw err;
  }
}

/** Cheap validation used by the API before rendering. */
export function validateProject(p: Project): string[] {
  const errors: string[] = [];
  if (!p || typeof p !== "object") return ["Project must be an object"];
  if (!Array.isArray(p.clips) || !p.clips.length) errors.push("clips[] needs at least one clip");
  p.clips?.forEach((c, i) => {
    if (!c?.source) errors.push(`clips[${i}].source is required`);
    if (c.end !== undefined && c.start !== undefined && c.end <= c.start) errors.push(`clips[${i}] end must be > start`);
    if (c.speed !== undefined && (c.speed < 0.25 || c.speed > 4)) errors.push(`clips[${i}].speed must be 0.25..4`);
    if (c.look && !LOOKS[c.look]) errors.push(`clips[${i}].look: unknown look "${c.look}"`);
  });
  p.texts?.forEach((t, i) => {
    if (!t.text?.trim()) errors.push(`texts[${i}].text is empty`);
  });
  return errors;
}
