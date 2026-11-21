/**
 * Motion presets — the "everything moves" layer on top of every clip.
 *
 * Each preset is a pure string builder for an ffmpeg filter chain applied to
 * an already-framed vertical/square/widescreen stream `[0:v]` at size w×h with
 * `fps=FPS`. Presets must never depend on clip length, so they work for 3s
 * teasers and 3-minute recaps alike.
 *
 * Design goals:
 *  • Ken-Burns pushes for still/static footage (screen recordings, slides)
 *  • punch-in + zoom-out hooks that feel native to Shorts/Reels
 *  • light grading (contrast/saturation/vignette) so clips look "edited"
 * Without a preset, `none` returns an empty chain (zero extra CPU).
 */

export const MOTION_PRESETS = [
  "none",
  "zoom-in",
  "zoom-out",
  "pan-left",
  "pan-right",
  "shake",
  "pulse",
  "whip",
] as const;

export type MotionPreset = (typeof MOTION_PRESETS)[number];

export type MotionMeta = {
  id: MotionPreset;
  label: string;
  blurb: string;
  cpu: "low" | "medium" | "high";
};

export const MOTION_META: Record<MotionPreset, MotionMeta> = {
  none: {
    id: "none",
    label: "Static",
    blurb: "No camera movement — fastest export.",
    cpu: "low",
  },
  "zoom-in": {
    id: "zoom-in",
    label: "Zoom in",
    blurb: "Slow push toward the subject. The default hook for Shorts.",
    cpu: "medium",
  },
  "zoom-out": {
    id: "zoom-out",
    label: "Zoom out",
    blurb: "Starts tight, reveals the frame. Great for openings and reveals.",
    cpu: "medium",
  },
  "pan-left": {
    id: "pan-left",
    label: "Pan left",
    blurb: "Cinematic drift left across the frame.",
    cpu: "medium",
  },
  "pan-right": {
    id: "pan-right",
    label: "Pan right",
    blurb: "Cinematic drift right across the frame.",
    cpu: "medium",
  },
  shake: {
    id: "shake",
    label: "Beat shake",
    blurb: "Subtle rhythmic wobble for music and meme edits.",
    cpu: "medium",
  },
  pulse: {
    id: "pulse",
    label: "Pulse",
    blurb: "Breathing zoom that hits on the beat.",
    cpu: "medium",
  },
  whip: {
    id: "whip",
    label: "Whip pan",
    blurb: "Fast snap-in, then a slow settle. High-energy transitions.",
    cpu: "high",
  },
};

/**
 * Build the motion filter for a stream that is already w×h.
 * Returns "" for `none`.
 */
export function motionChain(preset: MotionPreset, w: number, h: number, fps = 30): string {
  if (!preset || preset === "none") return "";
  const out = `${w}x${h}`;
  const frames = "d=1"; // per-frame expression (zoompan)

  switch (preset) {
    case "zoom-in":
      // zoompan keeps the frame size fixed; the source is pre-scaled 2x so the
      // pan window is sharp. Progress is normalised by the frame counter.
      return `scale=${w * 2}:${h * 2}:flags=lanczos,zoompan=z='min(1.0+0.0009*on,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${frames}:s=${out}:fps=${fps},setsar=1`;
    case "zoom-out":
      return `scale=${w * 2}:${h * 2}:flags=lanczos,zoompan=z='max(1.18-0.0009*on,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${frames}:s=${out}:fps=${fps},setsar=1`;
    case "pan-left":
      return `scale=${w * 2}:${h * 2}:flags=lanczos,zoompan=z='1.12':x='(iw-iw/zoom)*(1-min(on/900,1))':y='ih/2-(ih/zoom/2)':${frames}:s=${out}:fps=${fps},setsar=1`;
    case "pan-right":
      return `scale=${w * 2}:${h * 2}:flags=lanczos,zoompan=z='1.12':x='(iw-iw/zoom)*min(on/900,1)':y='ih/2-(ih/zoom/2)':${frames}:s=${out}:fps=${fps},setsar=1`;
    case "shake": {
      const a = Math.max(2, Math.round(w * 0.004));
      // crop from a slightly larger frame with sinusoidal offsets
      return `scale=${w + a * 2}:${h + a * 2}:flags=lanczos,crop=${w}:${h}:'${a}+${a}*sin(t*22)':'${a}+${a}*sin(t*17+1.3)',setsar=1`;
    }
    case "pulse":
      return `scale=${w * 2}:${h * 2}:flags=lanczos,zoompan=z='1.02+0.02*sin(on/18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${frames}:s=${out}:fps=${fps},setsar=1`;
    case "whip":
      // quick snap from 1.4x to 1.0 in ~12 frames, then hold
      return `scale=${w * 2}:${h * 2}:flags=lanczos,zoompan=z='if(lte(on,12),1.4-0.033*on,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${frames}:s=${out}:fps=${fps},setsar=1`;
    default:
      return "";
  }
}

/**
 * Optional "editor polish" grade applied when motion is on: a touch of
 * contrast/saturation and a soft vignette so footage reads as intentional.
 * Kept very light to preserve upload quality.
 */
export function gradeChain(strength: "off" | "light" | "cinematic" = "light"): string {
  if (strength === "off") return "";
  if (strength === "cinematic") {
    return "eq=contrast=1.08:saturation=1.14:brightness=0.01,vignette=PI/5,unsharp=3:3:0.4:3:3:0.0";
  }
  return "eq=contrast=1.04:saturation=1.08,vignette=PI/6";
}

/** Normalise unknown strings from API/MCP callers. */
export function asMotionPreset(value?: string | null): MotionPreset {
  const v = (value ?? "none").toLowerCase().replace(/[_\s]+/g, "-");
  return (MOTION_PRESETS as readonly string[]).includes(v) ? (v as MotionPreset) : "none";
}
