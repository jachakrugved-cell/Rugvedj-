import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { LOOKS, renderProject, validateProject, type Project } from "@/lib/studio";
import { MOTION_PRESETS } from "@/lib/motion";
import { TRANSITIONS, TITLE_ANIMATIONS, POSITIONS, ONE_TAP_RECIPES, EDIT_CAPABILITIES } from "@/lib/effects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

/** GET /api/studio — the palette the editor UI + Claude both read. */
export async function GET() {
  return NextResponse.json({
    looks: Object.entries(LOOKS).map(([id, v]) => ({ id, label: v.label })),
    transitions: TRANSITIONS,
    motions: MOTION_PRESETS,
    positions: POSITIONS,
    titleAnimations: TITLE_ANIMATIONS,
    recipes: ONE_TAP_RECIPES,
    capabilities: EDIT_CAPABILITIES,
  });
}

const Crop = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

const ClipLayer = z.object({
  source: z.string().min(1),
  start: z.number().min(0).optional(),
  end: z.number().positive().optional(),
  speed: z.number().min(0.25).max(4).optional(),
  reverse: z.boolean().optional(),
  crop: Crop.optional(),
  zoom: z.number().min(1).max(3).optional(),
  motion: z.enum(MOTION_PRESETS).optional(),
  look: z.string().optional(),
  volume: z.number().min(0).max(2).optional(),
  fadeIn: z.number().min(0).max(5).optional(),
  fadeOut: z.number().min(0).max(5).optional(),
  mute: z.boolean().optional(),
  transition: z.enum(TRANSITIONS).optional(),
  transitionSec: z.number().min(0.1).max(2).optional(),
});

const AudioLayer = z.object({
  source: z.string().min(1),
  start: z.number().min(0).optional(),
  end: z.number().min(0.1).optional(),
  at: z.number().min(0).optional(),
  volume: z.number().min(0).max(2).optional(),
  fadeIn: z.number().min(0).optional(),
  fadeOut: z.number().min(0).optional(),
  loop: z.boolean().optional(),
  duckToClips: z.boolean().optional(),
});

const TextLayer = z.object({
  text: z.string().min(1),
  at: z.number().min(0).optional(),
  duration: z.number().min(0.2).optional(),
  position: z.enum(POSITIONS).optional(),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  size: z.number().min(8).max(400).optional(),
  color: z.string().optional(),
  box: z.boolean().optional(),
  boxColor: z.string().optional(),
  shadow: z.boolean().optional(),
  italic: z.boolean().optional(),
  uppercase: z.boolean().optional(),
  animation: z.enum(TITLE_ANIMATIONS).optional(),
});

const OverlayLayer = z.object({
  source: z.string().min(1),
  at: z.number().min(0).optional(),
  duration: z.number().min(0.2).optional(),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  width: z.number().min(0.02).max(1).optional(),
  opacity: z.number().min(0).max(1).optional(),
  rotate: z.number().min(-180).max(180).optional(),
  fade: z.number().min(0).max(5).optional(),
});

const ProjectBody = z.object({
  title: z.string().optional(),
  aspect: z.enum(["original", "9:16", "1:1", "4:5", "16:9", "4:3"]).optional(),
  width: z.number().min(64).max(4096).optional(),
  height: z.number().min(64).max(4096).optional(),
  fps: z.number().min(10).max(60).optional(),
  look: z.string().optional(),
  volume: z.number().min(0).max(2).optional(),
  clips: z.array(ClipLayer).min(1).max(40),
  audios: z.array(AudioLayer).max(8).optional(),
  texts: z.array(TextLayer).max(30).optional(),
  overlays: z.array(OverlayLayer).max(12).optional(),
});

/** POST /api/studio — render a full timeline to an MP4. */
export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = ProjectBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid project.",
        details: parsed.error.issues.map((i) => `${i.path.join(".") || "project"}: ${i.message}`),
      },
      { status: 422 },
    );
  }

  const project = parsed.data as Project;
  const problems = validateProject(project);
  if (problems.length) return NextResponse.json({ error: problems.join("; ") }, { status: 422 });

  try {
    const { clip } = await renderProject(project);
    return NextResponse.json({
      ok: true,
      clip,
      url: `/api/clips/${clip.id}/file`,
      poster: `/api/clips/${clip.id}/file?poster=1`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Render failed." },
      { status: 500 },
    );
  }
}
