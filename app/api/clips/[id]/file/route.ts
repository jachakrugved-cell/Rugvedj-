import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { findClip } from "@/lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/clips/<id>/file — stream with HTTP Range support (seekable preview). */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const clip = await findClip(id);
  if (!clip) return new Response("Clip not found", { status: 404 });

  const st = await fs.stat(clip.file).catch(() => null);
  if (!st) return new Response("File missing", { status: 404 });

  const range = req.headers.get("range");
  const download = new URL(req.url).searchParams.get("download") === "1";
  const disposition = download
    ? `attachment; filename="${clip.fileName.replace(/"/g, "")}"`
    : "inline";

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (start >= st.size || end < start) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${st.size}` } });
      }
      const nodeStream = createReadStream(clip.file, { start, end });
      return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${st.size}`,
          "Accept-Ranges": "bytes",
          "Content-Disposition": disposition,
          "Cache-Control": "private, max-age=3600",
        },
      });
    }
  }

  const nodeStream = createReadStream(clip.file);
  return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(st.size),
      "Accept-Ranges": "bytes",
      "Content-Disposition": disposition,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
