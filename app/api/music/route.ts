import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  MUSIC_SOURCES,
  downloadTrack,
  ensureSoundKit,
  musicCatalogue,
  searchMusicDetailed,
  type MusicSource,
} from "@/lib/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const SOURCE_IDS = MUSIC_SOURCES.map((s) => s.id) as [MusicSource, ...MusicSource[]];

/** GET /api/music — sources, licence notes, sound kit, and a Spotify explainer. */
export async function GET() {
  const kit = await ensureSoundKit().catch(() => []);
  return NextResponse.json({
    ...musicCatalogue(),
    soundKit: kit,
    soundKitUrl: (f: string) => `/api/media/${f}`, // client-side hint only
  });
}

const SearchBody = z.object({
  action: z.literal("search"),
  query: z.string().min(1).max(200),
  sources: z.array(z.enum(SOURCE_IDS)).optional(),
  limit: z.number().min(1).max(25).optional(),
});

const DownloadBody = z.object({
  action: z.literal("download"),
  url: z.string().url(),
});

const Body = z.discriminatedUnion("action", [SearchBody, DownloadBody]);

/** POST /api/music — { action:"search" } or { action:"download" }. */
export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 422 },
    );
  }

  if (parsed.data.action === "search") {
    const { tracks, errors } = await searchMusicDetailed(parsed.data.query, {
      sources: parsed.data.sources,
      limit: parsed.data.limit,
    });
    return NextResponse.json({
      ok: tracks.length > 0,
      tracks,
      errors,
      note:
        tracks.length === 0
          ? "No results. If every source errored with 'blocked by this network', this machine cannot reach them — try a direct MP3/audio URL instead."
          : undefined,
    });
  }

  try {
    const out = await downloadTrack(parsed.data.url);
    return NextResponse.json({
      ok: true,
      fileName: out.fileName,
      url: `/api/media/${encodeURIComponent(out.fileName)}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Download failed." },
      { status: 502 },
    );
  }
}
