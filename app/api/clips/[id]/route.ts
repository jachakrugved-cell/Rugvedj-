import { NextResponse } from "next/server";
import { readLibrary, removeClip } from "@/lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const clip = (await readLibrary()).find((c) => c.id === id);
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  return NextResponse.json({ clip });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const clips = await removeClip(id);
  return NextResponse.json({ ok: true, clips });
}
