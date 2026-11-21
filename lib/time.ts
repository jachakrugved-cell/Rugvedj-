/**
 * Timecode helpers + a lenient parser used by the UI and by MCP.
 * Accepts 90, 1:30, 01:02:03.5, "1h2m3s", "-15" and "from end" style marks.
 */
export function parseTimecode(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? Math.max(0, input) : null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);

  // 1h2m3s / 2m10s / 45s
  const unit = s.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/);
  if (unit && (unit[1] || unit[2] || unit[3])) {
    const total =
      Number(unit[1] ?? 0) * 3600 + Number(unit[2] ?? 0) * 60 + Number(unit[3] ?? 0);
    return neg ? -total : total;
  }

  // 01:02:03.5 / 2:03
  const parts = s.split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  let total = 0;
  for (const p of parts) total = total * 60 + p;
  return neg ? -total : total;
}

/** Resolve a possibly negative end mark ("-10") against a duration. */
export function resolveMark(
  value: string | number | null | undefined,
  durationSec: number | null,
): number | null {
  const t = parseTimecode(value);
  if (t === null) return null;
  if (t < 0) return durationSec ? Math.max(0, durationSec + t) : 0;
  return t;
}

export function fmtTime(sec: number | null | undefined, withMillis = false): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "--:--";
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const ssStr = withMillis
    ? ss.toFixed(2).padStart(5, "0")
    : Math.floor(ss).toString().padStart(2, "0");
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${ssStr}`
    : `${m.toString().padStart(2, "0")}:${ssStr}`;
}

/** ffmpeg-friendly timestamp. */
export function toFfmpegTs(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return `${h.toString().padStart(2, "0")}:${m
    .toString()
    .padStart(2, "0")}:${rest.toFixed(3).padStart(6, "0")}`;
}

/** ASS timestamp H:MM:SS.cc */
export function toAssTs(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

export function slugify(text: string, maxLen = 60): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxLen) || "clip"
  );
}
