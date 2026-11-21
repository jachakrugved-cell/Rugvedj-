import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClip } from "@/lib/clipper";
import { readLibrary } from "@/lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

const Aspect = z.enum(["original", "9:16", "1:1", "4:5", "16:9", "4:3"]);
const Style = z.enum(["clean", "bold", "karaoke", "highlight", "neon", "minimal"]);
const Motion = z.enum(["none", "zoom-in", "zoom-out", "pan-left", "pan-right", "shake", "pulse", "whip"]);
const Template = z.enum([
  "shorts-hook",
  "reels-clean",
  "tiktok-karaoke",
  "podcast-clip",
  "cinematic",
  "square-proof",
  "raw",
]);

const Body = z.object({
  source: z.string().min(1),
  start: z.union([z.number(), z.string()]).optional(),
  end: z.union([z.number(), z.string()]).optional(),
  startSec: z.number().optional(),
  endSec: z.number().optional(),
  title: z.string().optional(),
  aspect: Aspect.optional(),
  captions: z.string().optional(),
  captionStyle: Style.optional(),
  reencode: z.boolean().optional(),
  filename: z.string().optional(),
  /** One-word edit style: aspect + motion + captions. */
  template: Template.optional(),
  motion: Motion.optional(),
  grade: z.enum(["off", "light", "cinematic"]).optional(),
});

/** GET /api/clips — the library. */
export async function GET() {
  return NextResponse.json({ clips: await readLibrary() });
}

/** POST /api/clips — create a clip. Returns when the clip is finished. */
export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const b = parsed.data;
  const { resolveMark, parseTimecode } = await import("@/lib/time");

  const startRaw = b.startSec ?? b.start ?? 0;
  const endRaw = b.endSec ?? b.end;
  const start = parseTimecode(startRaw) ?? 0;
  const end = endRaw === undefined ? null : parseTimecode(endRaw);

  if (end === null) {
    return NextResponse.json(
      { error: "end is required (seconds or timecode, e.g. 90 or 1:30)" },
      { status: 400 },
    );
  }
  const endResolved = resolveMark(end, null) ?? end;
  if (endResolved <= start) {
    // Possibly a "last N seconds" style end; resolve against the source later.
    return NextResponse.json(
      { error: "end must be greater than start" },
      { status: 400 },
    );
  }

  try {
    const { clip, task } = await createClip({
      source: b.source,
      start,
      end: endResolved,
      title: b.title,
      aspect: b.aspect,
      captions: b.captions,
      captionStyle: b.captionStyle,
      forceReencode: b.reencode,
      filename: b.filename,
      template: b.template,
      motion: b.motion,
      grade: b.grade,
    });
    return NextResponse.json({ ok: true, clip, task });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
