/**
 * Thin, safe wrappers around child_process for ffmpeg / ffprobe / yt-dlp.
 * No shell interpretation anywhere: arguments go through execFile/spawn
 * as arrays, so user supplied URLs can never inject commands.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";

export type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
};

type ExecOpts = {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxBuffer?: number;
};

export function run(
  bin: string,
  args: string[],
  opts: ExecOpts = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        timeout: opts.timeoutMs,
        signal: opts.signal,
        maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        resolve({
          code: e ? (typeof e.code === "number" ? e.code : 1) : 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          timedOut: !!e && e.killed === true,
        });
      },
    );
  });
}

export type SpawnHandle = {
  child: ChildProcess;
  done: Promise<ExecResult>;
  kill: (sig?: NodeJS.Signals) => void;
};

/** Spawn a long-lived process, collecting stderr (ffmpeg writes progress there). */
export function spawnCollect(
  bin: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    onStderr?: (chunk: string) => void;
    onStdout?: (chunk: string) => void;
  } = {},
): SpawnHandle {
  const child = spawn(bin, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (b: Buffer) => {
    const s = b.toString();
    if (stdout.length < 4 * 1024 * 1024) stdout += s;
    opts.onStdout?.(s);
  });
  child.stderr?.on("data", (b: Buffer) => {
    const s = b.toString();
    if (stderr.length < 4 * 1024 * 1024) stderr += s;
    opts.onStderr?.(s);
  });

  const done = new Promise<ExecResult>((resolve) => {
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    child.on("error", (err) =>
      resolve({ code: 1, stdout, stderr: `${stderr}\n${err.message}` }),
    );
  });

  return {
    child,
    done,
    kill: (sig: NodeJS.Signals = "SIGTERM") => {
      try {
        child.kill(sig);
      } catch {
        /* already gone */
      }
    },
  };
}

/** Parse "out_time_us=12345678" style ffmpeg progress blocks. */
export function parseFfmpegProgress(chunk: string): {
  outTimeSec?: number;
  speed?: string;
  fps?: string;
  dropped?: number;
} {
  const out: { outTimeSec?: number; speed?: string; fps?: string; dropped?: number } = {};
  const time = chunk.match(/out_time_us=(\d+)/);
  if (time) out.outTimeSec = Number(time[1]) / 1_000_000;
  const speed = chunk.match(/speed=\s*([\d.]+x)/);
  if (speed) out.speed = speed[1];
  const fps = chunk.match(/fps=\s*([\d.]+)/);
  if (fps) out.fps = fps[1];
  const drop = chunk.match(/drop=\s*(\d+)/);
  if (drop) out.dropped = Number(drop[1]);
  return out;
}

/** Convert ffmpeg's human timestamp (01:02:03.45) to seconds. */
export function tsToSeconds(ts: string): number | null {
  const m = ts.trim().match(/^(-?)(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  return (
    sign * (Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]))
  );
}
