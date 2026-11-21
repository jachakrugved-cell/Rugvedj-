/**
 * Edit templates — opinionated bundles of aspect + motion + caption style
 * so a one-line request from Claude (or a one-tap click in the Studio)
 * produces a polished, platform-ready clip.
 */
import type { AspectRatio } from "./types";
import { asMotionPreset, type MotionPreset } from "./motion";

export const TEMPLATES = [
  "shorts-hook",
  "reels-clean",
  "tiktok-karaoke",
  "podcast-clip",
  "cinematic",
  "square-proof",
  "raw",
] as const;

export type TemplateName = (typeof TEMPLATES)[number];

export type Template = {
  id: TemplateName;
  label: string;
  blurb: string;
  aspect: AspectRatio;
  motion: MotionPreset;
  captionStyle: "clean" | "bold" | "karaoke" | "highlight" | "neon" | "minimal";
  grade: "off" | "light" | "cinematic";
};

export const TEMPLATE_META: Record<TemplateName, Template> = {
  "shorts-hook": {
    id: "shorts-hook",
    label: "Shorts hook",
    blurb: "9:16 · slow zoom · bold captions. The default for YouTube Shorts.",
    aspect: "9:16",
    motion: "zoom-in",
    captionStyle: "bold",
    grade: "light",
  },
  "reels-clean": {
    id: "reels-clean",
    label: "Reels clean",
    blurb: "9:16 · gentle pan · clean captions. Polished Instagram look.",
    aspect: "9:16",
    motion: "pan-right",
    captionStyle: "clean",
    grade: "light",
  },
  "tiktok-karaoke": {
    id: "tiktok-karaoke",
    label: "TikTok karaoke",
    blurb: "9:16 · pulse · word-by-word karaoke captions. High energy.",
    aspect: "9:16",
    motion: "pulse",
    captionStyle: "karaoke",
    grade: "light",
  },
  "podcast-clip": {
    id: "podcast-clip",
    label: "Podcast clip",
    blurb: "9:16 · zoom-out · yellow highlight captions. Designed for talking heads.",
    aspect: "9:16",
    motion: "zoom-out",
    captionStyle: "highlight",
    grade: "light",
  },
  cinematic: {
    id: "cinematic",
    label: "Cinematic",
    blurb: "16:9 · slow pan · minimal captions · filmic grade.",
    aspect: "16:9",
    motion: "pan-left",
    captionStyle: "minimal",
    grade: "cinematic",
  },
  "square-proof": {
    id: "square-proof",
    label: "Square proof",
    blurb: "1:1 · gentle zoom · clean captions. Client proofs and feeds.",
    aspect: "1:1",
    motion: "zoom-in",
    captionStyle: "clean",
    grade: "light",
  },
  raw: {
    id: "raw",
    label: "Raw cut",
    blurb: "Original framing · no motion · no grade. Fastest, lossless where possible.",
    aspect: "original",
    motion: "none",
    captionStyle: "clean",
    grade: "off",
  },
};

export function asTemplate(value?: string | null): Template | null {
  if (!value) return null;
  const v = value.toLowerCase().replace(/[_\s]+/g, "-");
  return (TEMPLATES as readonly string[]).includes(v)
    ? TEMPLATE_META[v as TemplateName]
    : null;
}

/** Merge a template with explicit caller overrides (overrides win). */
export function resolveEditStyle(input: {
  template?: string | null;
  aspect?: AspectRatio;
  motion?: string | null;
  captionStyle?: string | null;
}) {
  const t = asTemplate(input.template);
  return {
    aspect: input.aspect ?? t?.aspect ?? "original",
    motion: input.motion ? asMotionPreset(input.motion) : t?.motion ?? "none",
    captionStyle: (input.captionStyle as Template["captionStyle"]) ?? t?.captionStyle ?? "clean",
    grade: t?.grade ?? "light",
    template: t?.id ?? null,
  };
}
