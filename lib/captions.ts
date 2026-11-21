/**
 * Caption pipeline: SRT/VTT parsing, auto-generated (evenly distributed) cues,
 * and ASS rendering with animated styles rendered by libass/ffmpeg.
 */
import { toAssTs } from "./time";

export type Cue = { start: number; end: number; text: string };

/** Parse SRT or WebVTT into cues. Forgiving about numbering and blank lines. */
export function parseSubtitles(raw: string): Cue[] {
  const text = raw.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];
  const tsRe =
    /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/;

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (!lines.length) continue;
    if (/^WEBVTT/i.test(lines[0]) && lines.length === 1) continue;
    const idx = lines.findIndex((l) => tsRe.test(l));
    if (idx < 0) continue;
    const m = lines[idx].match(tsRe)!;
    const start = srtTime(m[1]);
    const end = srtTime(m[2]);
    const body = lines
      .slice(idx + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\{[^}]*\}/g, "")
      .trim();
    if (body && end > start) cues.push({ start, end, text: body });
  }
  return cues;
}

function srtTime(t: string): number {
  const parts = t.replace(",", ".").split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/**
 * Build cues when the user gave plain text instead of timestamps.
 * Short lines (or a long paragraph split into sentences) get one cue each,
 * filling the clip so words are spoken over the whole duration.
 */
export function cuesFromText(text: string, durationSec: number): Cue[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  let pieces = clean.includes("\n")
    ? clean.split("\n").map((s) => s.trim()).filter(Boolean)
    : clean.split(/(?<=[.!?…])\s+(?=[A-Z0-9"“'])/g).map((s) => s.trim()).filter(Boolean);
  if (pieces.length === 1 && clean.length > 90) {
    pieces = chunkByChars(clean, 42);
  }
  // Weight by character count so longer lines stay on screen longer.
  const weights = pieces.map((p) => Math.max(8, p.length));
  const sum = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return pieces.map((p, i) => {
    const dur = (weights[i] / sum) * durationSec;
    const cue = { start: t, end: t + dur, text: p };
    t += dur;
    return cue;
  });
}

function chunkByChars(text: string, max: number): string[] {
  const words = text.split(" ");
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > max && line) {
      out.push(line.trim());
      line = w;
    } else line += " " + w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

/** Shift cues so clip-relative time starts at 0 and clip between [start,end]. */
export function clipCues(cues: Cue[], clipStart: number, clipEnd: number): Cue[] {
  return cues
    .filter((c) => c.end > clipStart && c.start < clipEnd)
    .map((c) => ({
      start: Math.max(0, c.start - clipStart),
      end: Math.min(clipEnd, c.end) - clipStart,
      text: c.text,
    }))
    .filter((c) => c.end > c.start);
}

// ─────────────────────────────── ASS styles ───────────────────────────────

export type CaptionStyle =
  | "clean"
  | "bold"
  | "karaoke"
  | "highlight"
  | "neon"
  | "minimal";

export const CAPTION_STYLES: Record<
  CaptionStyle,
  { label: string; primary: string; secondary: string; outline: string; bold: number }
> = {
  clean:     { label: "Clean white",      primary: "&H00FFFFFF", secondary: "&H00FFFFFF", outline: "&H00000000", bold: 1 },
  bold:      { label: "Bold impact",      primary: "&H00FFFFFF", secondary: "&H00FFFFFF", outline: "&H00000000", bold: 1 },
  karaoke:   { label: "Karaoke yellow",   primary: "&H0000E7FF", secondary: "&H00FFFFFF", outline: "&H00000000", bold: 1 },
  highlight: { label: "Yellow highlight", primary: "&H00000000", secondary: "&H00000000", outline: "&H0000E7FF", bold: 1 },
  neon:      { label: "Neon green",       primary: "&H0000FF88", secondary: "&H00FFFFFF", outline: "&H00201010", bold: 1 },
  minimal:   { label: "Minimal mono",     primary: "&H00F0F0F0", secondary: "&H00F0F0F0", outline: "&H00202020", bold: 0 },
};

export type AssOptions = {
  width: number;
  height: number;
  style: CaptionStyle;
  fontSize?: number;
  words?: boolean;
};

/** DejaVu ships with virtually every Linux/macOS install; libass falls back if absent. */
const FONT_FAMILY = "DejaVu Sans";

const esc = (t: string) =>
  t.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");

/** Greedy word wrap so long cues never run off the frame. */
export function wrapLines(text: string, maxChars: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) {
      line = w;
      continue;
    }
    if ((line + " " + w).length <= maxChars) line += " " + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function buildAss(cues: Cue[], opts: AssOptions): string {
  const { width, height } = opts;
  const st = CAPTION_STYLES[opts.style] ?? CAPTION_STYLES.clean;
  const vertical = height > width;

  // Type size: bounded by both the short edge and the frame height.
  const size =
    opts.fontSize ??
    Math.round(
      Math.min(height * (vertical ? 0.038 : 0.055), width * (vertical ? 0.068 : 0.05)),
    );
  const bold = st.bold ? -1 : 0;
  const borderStyle = opts.style === "highlight" ? 3 : 1;
  const outline =
    opts.style === "neon"
      ? Math.max(3, Math.round(size * 0.10))
      : Math.max(2, Math.round(size * 0.055));
  const shadow = opts.style === "minimal" ? 0 : Math.max(1, Math.round(size * 0.03));
  const marginH = Math.round(width * 0.07);
  const marginV = Math.round(height * (vertical ? 0.13 : 0.075));
  const maxChars = Math.max(14, Math.floor((width - marginH * 2) / (size * 0.52)));

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${FONT_FAMILY},${size},${st.primary},${st.secondary},${st.outline},&H78000000,${bold},0,0,0,100,100,0.4,0,${borderStyle},${outline},${shadow},2,${marginH},${marginH},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events: string[] = [];
  for (const cue of cues) {
    const start = toAssTs(cue.start);
    const end = toAssTs(cue.end + 0.08);
    const lines = wrapLines(cue.text, maxChars);
    let body: string;

    switch (opts.style) {
      case "karaoke":
      case "bold": {
        // Pop-in word by word using \k tags (libass renders progressive reveal).
        const words = lines.join(" ").split(/\s+/);
        const totalCs = Math.max(1, Math.round((cue.end - cue.start) * 100));
        const per = Math.max(6, Math.round(totalCs / Math.max(1, words.length)));
        const revealed = words.map((w) => `{\\k${per}}${esc(w)}`).join(" ");
        body = `{\\fad(60,60)}${revealed}`;
        break;
      }
      case "highlight": {
        body = `{\\fad(90,90)\\bord${outline}}${esc(cue.text.toUpperCase())}`;
        break;
      }
      case "neon": {
        body = `{\\fad(120,120)\\blur1.5}${esc(cue.text)}`;
        break;
      }
      default:
        body = `{\\fad(70,70)}${esc(cue.text.toUpperCase())}`;
    }

    // Insert manual line breaks (esc() removes newlines).
    const text = body.includes("\\N") ? body : rewrapBody(body, lines);
    events.push(`Dialogue: 0,${start},${end},Cap,,0,0,0,,${text}`);
  }

  return header + events.join("\n") + "\n";
}

/** Re-insert \\N breaks into an already-styled body by replacing spaces. */
function rewrapBody(body: string, lines: string[]): string {
  if (lines.length <= 1) return body;
  // Replace the (lines.length-1) spaces that fall at line boundaries.
  const boundaries = new Set<number>();
  let count = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    count += lines[i].split(" ").length;
    boundaries.add(count);
  }
  let wordIdx = 0;
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === " ") {
      wordIdx++;
      out += boundaries.has(wordIdx) ? "\\N" : " ";
    } else out += ch;
  }
  return out;
}

/** ASS path must be escaped for the ffmpeg filter graph. */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,");
}
