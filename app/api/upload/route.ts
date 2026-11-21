import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DOWNLOADS_DIR, ensureDirs } from "@/lib/config";
import { probeWithFfmpeg } from "@/lib/media";
import { slugify } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const ALLOWED = /\.(mp4|mov|m4v|webm|mkv|avi|mp3|m4a|wav|aac|flac|ogg|png|jpe?g|webp|gif)$/i;

/** POST /api/upload — drop a local file into the editor's media pool. */
export async function POST(req: NextRequest) {
  await ensureDirs();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send multipart/form-data with a `file` field." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file received." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File is larger than 2 GB." }, { status: 413 });
  if (!ALLOWED.test(file.name)) {
    return NextResponse.json(
      { error: "Unsupported file type. Use mp4/mov/webm/mkv/avi, audio, or png/jpg/webp/gif." },
      { status: 415 },
    );
  }

  const ext = path.extname(file.name).toLowerCase();
  const base = slugify(path.basename(file.name, ext), 50) || "upload";
  const fileName = `${base}-${Date.now().toString(36)}${ext}`;
  const dest = path.join(DOWNLOADS_DIR, fileName);

  await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));

  const isImage = /\.(png|jpe?g|webp|gif)$/.test(ext);
  const isAudio = /\.(mp3|m4a|wav|aac|flac|ogg)$/.test(ext);

  let durationSec: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  try {
    const p = await probeWithFfmpeg(dest);
    durationSec = p.durationSec ?? null;
    width = p.width ?? null;
    height = p.height ?? null;
  } catch {
    /* images and odd containers still work without metadata */
  }

  return NextResponse.json({
    ok: true,
    fileName,
    url: `/api/media/${encodeURIComponent(fileName)}`,
    kind: isImage ? "image" : isAudio ? "audio" : "video",
    durationSec: durationSec ?? (isImage ? 0 : null),
    width,
    height,
    sizeBytes: file.size,
  });
}
