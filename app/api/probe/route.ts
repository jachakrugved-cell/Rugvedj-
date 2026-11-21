import { NextRequest, NextResponse } from "next/server";
import { getSourceInfo } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/probe  { url, fresh? }
 * Accepts any link: page (YouTube/Vimeo/Twitch/…), direct MP4, HLS/DASH
 * manifest or live stream URL. Returns everything the editor needs.
 */
export async function POST(req: NextRequest) {
  let body: { url?: string; fresh?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const url = (body.url ?? "").trim();
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });

  try {
    const info = await getSourceInfo(url, { fresh: body.fresh });
    return NextResponse.json({ ok: true, ...info });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url")?.trim();
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });
  try {
    const info = await getSourceInfo(url, {
      fresh: req.nextUrl.searchParams.get("fresh") === "1",
    });
    return NextResponse.json({ ok: true, ...info });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
