import { NextResponse } from "next/server";
import { FFMPEG, FFPROBE, YTDLP, DATA_DIR, FONT_FILE, LIVE_MAX_SEC } from "@/lib/config";
import { binaryAvailable } from "@/lib/media";
import type { Health } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [ffOk, fpOk, ytOk] = await Promise.all([
    binaryAvailable(FFMPEG),
    binaryAvailable(FFPROBE),
    binaryAvailable(YTDLP),
  ]);

  const versionOf = async (bin: string, args = ["-version"]) => {
    const { run } = await import("@/lib/exec");
    const r = await run(bin, args, { timeoutMs: 8000 });
    return (r.stdout || r.stderr).split("\n").find((l) => l.trim())?.slice(0, 120);
  };

  const health: Health = {
    ok: ffOk && fpOk,
    name: "clipforge",
    version: "1.0.0",
    ffmpeg: { path: FFMPEG, ok: ffOk, version: ffOk ? await versionOf(FFMPEG) : undefined },
    ffprobe: { path: FFPROBE, ok: fpOk, version: fpOk ? await versionOf(FFPROBE) : undefined },
    ytdlp: { path: YTDLP, ok: ytOk, version: ytOk ? await versionOf(YTDLP, ["--version"]) : undefined },
    font: FONT_FILE || null,
    dataDir: DATA_DIR,
    liveMaxSec: LIVE_MAX_SEC,
  };
  if (!ytOk) {
    health.hint =
      "yt-dlp is optional but needed for YouTube/Vimeo/Twitch page links and for live page links. Install it with `npm run setup`, then restart.";
  }
  return NextResponse.json(health);
}
