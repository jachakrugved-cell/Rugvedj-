import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { FFMPEG, WORK_DIR, ensureDirs } from "@/lib/config";
import { run } from "@/lib/exec";
import { getSourceInfo } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/frame?url=<source>&t=<seconds>&w=640
 * Extracts a JPEG preview frame from any supported source.
 */
export async function GET(req: NextRequest) {
  await ensureDirs();
  const url = req.nextUrl.searchParams.get("url")?.trim();
  const t = Math.max(0, Number(req.nextUrl.searchParams.get("t") ?? 0));
  const width = Math.min(960, Math.max(160, Number(req.nextUrl.searchParams.get("w") ?? 640)));
  if (!url) return new Response("url required", { status: 400 });

  const cacheKey = createHash("sha1").update(`${url}|${Math.round(t)}|${width}`).digest("hex");
  const cacheDir = path.join(WORK_DIR, "frames");
  await fs.mkdir(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, `${cacheKey}.jpg`);

  const cached = await fs.readFile(cacheFile).catch(() => null);
  if (cached) return jpeg(cached);

  const info = await getSourceInfo(url).catch(() => null);
  const input = info?.filePath ?? info?.previewUrl ?? url;
  if (!input) return new Response("No playable source", { status: 422 });

  const headers = info?.headers
    ? Object.entries(info.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")
    : "";
  const args = ["-hide_banner", "-nostdin", "-loglevel", "error"];
  if (headers) args.push("-headers", `${headers}\r\n`);
  args.push(
    "-ss", String(t),
    "-i", input,
    "-frames:v", "1",
    "-vf", `scale=${width}:-2:force_original_aspect_ratio=decrease`,
    "-q:v", "4",
    "-f", "image2pipe",
    "-vcodec", "mjpeg",
    "-",
  );
  const r = await run(FFMPEG, args, { timeoutMs: 90_000, maxBuffer: 12 * 1024 * 1024 });
  if (r.code !== 0) {
    const msg = r.stderr.split("\n").filter(Boolean).slice(-1)[0] ?? "Frame extraction failed";
    return new Response(msg, { status: 422 });
  }
  const buf = Buffer.from(r.stdout, "binary");
  if (!buf.length) return new Response("No frame at that time", { status: 422 });
  await fs.writeFile(cacheFile, buf).catch(() => {});
  return jpeg(buf);
}

function jpeg(buf: Buffer | Uint8Array) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
