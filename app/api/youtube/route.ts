import { NextResponse } from "next/server";
import { youtubeDoctor } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/youtube — is YouTube reachable from this machine, and which
 * mitigation is active? Used by the UI banner and by the youtube_status tool.
 */
export async function GET() {
  const d = await youtubeDoctor();
  return NextResponse.json({
    ...d,
    hint: d.reachable
      ? "YouTube works. If a single video fails, it is usually video-specific (private/region)."
      : d.detail,
  });
}
