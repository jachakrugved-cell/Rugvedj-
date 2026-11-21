import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AGENTS, runCrew, type AgentId } from "@/lib/agents";
import { MOTION_PRESETS } from "@/lib/motion";
import { TEMPLATES } from "@/lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

/** GET /api/crew — the roster (used by the browser page and MCP prompts). */
export async function GET() {
  return NextResponse.json({
    agents: AGENTS,
    templates: TEMPLATES,
    motions: MOTION_PRESETS,
    platforms: ["youtube-shorts", "tiktok", "instagram-reels", "youtube", "linkedin"],
  });
}

const Body = z.object({
  theme: z.string().optional(),
  url: z.string().optional(),
  candidates: z.number().min(1).max(12).optional(),
  template: z.enum(TEMPLATES).optional(),
  aspect: z.enum(["original", "9:16", "1:1", "4:5", "16:9", "4:3"]).optional(),
  motion: z.enum(MOTION_PRESETS).optional(),
  grade: z.enum(["off", "light", "cinematic"]).optional(),
  start: z.number().optional(),
  end: z.number().optional(),
  targetDurationSec: z.number().min(4).max(600).optional(),
  captionScript: z.string().optional(),
  captionStyle: z
    .enum(["clean", "bold", "karaoke", "highlight", "neon", "minimal"])
    .optional(),
  platform: z
    .enum(["youtube-shorts", "tiktok", "instagram-reels", "youtube", "linkedin"])
    .optional(),
  only: z.array(z.enum(AGENTS.map((a) => a.id) as [AgentId, ...AgentId[]])).optional(),
  except: z.array(z.enum(AGENTS.map((a) => a.id) as [AgentId, ...AgentId[]])).optional(),
  title: z.string().optional(),
});

/** POST /api/crew — run the 10-agent pipeline. */
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
  if (!b.theme && !b.url) {
    return NextResponse.json({ error: "Provide theme (search query) or url" }, { status: 400 });
  }
  try {
    const crew = await runCrew(b);
    return NextResponse.json(crew);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
