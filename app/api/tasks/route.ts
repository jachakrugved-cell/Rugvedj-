import { NextRequest, NextResponse } from "next/server";
import { bus, listTasks, type Task } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/tasks — recent tasks (newest first). */
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const stream = req.nextUrl.searchParams.get("stream");

  if (stream === "1") {
    return sse(req);
  }
  return NextResponse.json({ tasks: listTasks(limit) });
}

/** GET /api/tasks?stream=1 — Server-Sent Events feed of live task updates. */
function sse(req: NextRequest): Response {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let onTask: ((t: Task) => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };
      send("snapshot", { tasks: listTasks(50) });

      onTask = (t: Task) => send("task", t);
      bus.on("task", onTask);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* ignore */
        }
      }, 15_000);

      req.signal.addEventListener("abort", () => {
        if (onTask) bus.off("task", onTask);
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
    },
    cancel() {
      if (onTask) bus.off("task", onTask);
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
