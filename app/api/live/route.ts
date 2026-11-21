import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { LIVE_MAX_SEC } from "@/lib/config";
import { recordLive } from "@/lib/clipper";
import { getSourceInfo } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

const Body = z.object({
  url: z.string().min(1),
  durationSec: z.number().min(5).max(LIVE_MAX_SEC).optional(),
  title: z.string().optional(),
});

/** GET /api/live — detect whether a URL is live and get a playable stream URL. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url")?.trim();
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
  try {
    const info = await getSourceInfo(url, { fresh: true });
    return NextResponse.json({
      ok: true,
      isLive: info.isLive,
      previewUrl: info.previewUrl,
      previewType: info.previewType,
      needsProxy: info.needsProxy,
      title: info.title,
      durationSec: info.durationSec,
      maxRecordSec: LIVE_MAX_SEC,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}

/** POST /api/live — record the live stream for N seconds (default 60). */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const result = await recordLive({
      source: parsed.data.url,
      durationSec: parsed.data.durationSec ?? 60,
      title: parsed.data.title,
    });
    return NextResponse.json({
      ok: true,
      task: result.task,
      filePath: result.filePath,
      fileName: result.filePath.split("/").pop(),
      durationSec: result.durationSec,
      previewUrl: `/api/media/${encodeURIComponent(result.filePath.split("/").pop()!)}`,
      mediaUrl: `/api/media/${encodeURIComponent(result.filePath.split("/").pop()!)}`,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
