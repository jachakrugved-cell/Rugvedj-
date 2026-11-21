import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { DATA_DIR, ensureDirs } from "@/lib/config";
import { findClip } from "@/lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** GET /api/media/<id-or-file-name> — serve a clip, download or live recording. */
export async function GET(req: Request, ctx: Ctx) {
  await ensureDirs();
  const { name } = await ctx.params;
  const clean = decodeURIComponent(name.split("?")[0]);
  if (clean.includes("..") || clean.includes("/") || clean.includes("\\")) {
    return new Response("Not found", { status: 404 });
  }

  const candidates: string[] = [];
  const clip = await findClip(clean);
  if (clip) candidates.push(clip.file);
  candidates.push(
    path.join(DATA_DIR, "clips", clean),
    path.join(DATA_DIR, "downloads", clean),
    path.join(DATA_DIR, "live", clean),
  );

  let file: string | null = null;
  for (const c of candidates) {
    const resolved = path.resolve(c);
    if (!resolved.startsWith(path.resolve(DATA_DIR) + path.sep)) continue;
    const st = await fs.stat(resolved).catch(() => null);
    if (st?.isFile()) {
      file = resolved;
      break;
    }
  }
  if (!file) return new Response("Not found", { status: 404 });

  const st = (await fs.stat(file))!;
  const type = file.endsWith(".mp4")
    ? "video/mp4"
    : file.endsWith(".webm")
      ? "video/webm"
      : "application/octet-stream";
  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": type,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${st.size}`,
          "Accept-Ranges": "bytes",
        },
      });
    }
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: { "Content-Type": type, "Content-Length": String(st.size), "Accept-Ranges": "bytes" },
  });
}
