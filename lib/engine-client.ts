/**
 * Typed HTTP client for the ClipForge engine.
 *
 * Used by the MCP server so Claude talks to the same engine the Studio UI
 * uses. If no engine is running and CLIPFORGE_AUTOSTART is not "0", it starts
 * one (`next start` when built, otherwise `next dev`) in the background.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ClipRecord, Health, SourceInfo, Task } from "./types";

export type EngineClientOptions = {
  baseUrl?: string;
  root?: string;
  autostart?: boolean;
};

export class EngineError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "EngineError";
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class EngineClient {
  readonly baseUrl: string;
  readonly root: string;
  readonly autostart: boolean;
  private starting: Promise<void> | null = null;

  constructor(opts: EngineClientOptions = {}) {
    this.baseUrl = (
      opts.baseUrl ??
      process.env.CLIPFORGE_ENGINE_URL ??
      `http://127.0.0.1:${process.env.PORT ?? 3000}`
    ).replace(/\/+$/, "");
    this.root = opts.root ?? process.env.CLIPFORGE_ROOT ?? process.cwd();
    this.autostart = opts.autostart ?? process.env.CLIPFORGE_AUTOSTART !== "0";
  }

  async health(timeoutMs = 4000): Promise<Health> {
    const r = await fetch(`${this.baseUrl}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    }).catch(() => null);
    if (!r || !r.ok) throw new EngineError(`ClipForge engine is not reachable at ${this.baseUrl}`);
    return (await r.json()) as Health;
  }

  /** Throws a helpful error if the engine is down; optionally starts it. */
  async ensureEngine(): Promise<Health> {
    try {
      return await this.health();
    } catch {
      if (!this.autostart) {
        throw new EngineError(
          `ClipForge engine is not running at ${this.baseUrl}. Start it with \`npm run dev\` in ${this.root}, ` +
            `or set CLIPFORGE_ENGINE_URL to a running instance.`,
        );
      }
      await this.startEngine();
      return this.health();
    }
  }

  private startEngine(): Promise<void> {
    if (this.starting) return this.starting;
    const port = new URL(this.baseUrl).port || "3000";
    const built = existsSync(path.join(this.root, ".next", "BUILD_ID"));
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const args = built ? ["run", "start"] : ["run", "dev"];

    this.starting = (async () => {
      const child = spawn(npm, args, {
        cwd: this.root,
        env: { ...process.env, PORT: String(port), CLIPFORGE_HOST: "0.0.0.0" },
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();

      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await sleep(1500);
        try {
          await this.health(2500);
          return;
        } catch {
          /* keep waiting — next dev compiles on first request */
        }
      }
      throw new EngineError(
        `Tried to auto-start the ClipForge engine (${npm} ${args.join(" ")}) but it did not answer ` +
          `within 2 minutes at ${this.baseUrl}. Start it manually and retry.`,
      );
    })();

    return this.starting;
  }

  private startingHealth: Promise<Health> | null = null;

  /** Single-flight health check so parallel tool calls never double-spawn. */
  private healthOrStart(): Promise<Health> {
    if (!this.startingHealth) {
      this.startingHealth = this.ensureEngine().finally(() => {
        this.startingHealth = null;
      });
    }
    return this.startingHealth;
  }

  private async request<T>(method: string, pathname: string, body?: unknown, timeoutMs = 120_000): Promise<T> {
    await this.healthOrStart();
    const r = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const text = await r.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!r.ok) {
      const msg =
        (json as { error?: string; message?: string } | null)?.error ??
        (json as { message?: string } | null)?.message ??
        `Engine responded ${r.status}`;
      throw new EngineError(msg, r.status);
    }
    return json as T;
  }

  probe(url: string, fresh = false) {
    return this.request<SourceInfo & { ok: boolean }>("POST", "/api/probe", { url, fresh }, 180_000);
  }

  createClip(input: {
    source: string;
    start: number;
    end: number;
    title?: string;
    aspect?: string;
    captions?: string;
    captionStyle?: string;
    reencode?: boolean;
    filename?: string;
  }) {
    return this.request<{ ok: boolean; clip: ClipRecord; task: Task }>(
      "POST",
      "/api/clips",
      input,
      60 * 60_000,
    );
  }

  listClips() {
    return this.request<{ clips: ClipRecord[] }>("GET", "/api/clips");
  }

  getClip(id: string) {
    return this.request<{ clip: ClipRecord }>("GET", `/api/clips/${encodeURIComponent(id)}`);
  }

  async deleteClip(id: string) {
    return this.request<{ ok: boolean; clips: ClipRecord[] }>(
      "DELETE",
      `/api/clips/${encodeURIComponent(id)}`,
    );
  }

  liveInfo(url: string) {
    return this.request<{
      ok: boolean;
      isLive: boolean;
      previewUrl: string | null;
      previewType: string;
      title?: string;
      maxRecordSec?: number;
    }>("GET", `/api/live?url=${encodeURIComponent(url)}`, undefined, 180_000);
  }

  recordLive(input: { url: string; durationSec: number; title?: string }) {
    return this.request<{
      ok: boolean;
      fileName: string;
      durationSec: number;
      previewUrl: string;
      task: Task;
    }>("POST", "/api/live", input, 60 * 60_000);
  }

  task(id: string) {
    return this.request<{ tasks: Task[] }>("GET", "/api/tasks?limit=200").then(
      (r) => r.tasks.find((t) => t.id === id) ?? null,
    );
  }
}
