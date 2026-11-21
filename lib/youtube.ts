/**
 * YouTube hardening.
 *
 * "Sign in to confirm you're not a bot", "HTTP 403 on googlevideo" and
 * "Unable to download API page: TLS/SSL" are the three failure modes people
 * hit with YouTube. They have different fixes, so this module:
 *
 *  1. tries yt-dlp with a ladder of player clients (web_safari, web_embedded,
 *     android_vr, tv, ios, web) instead of a single default;
 *  2. passes PO-token / visitor-data / cookies options when they exist;
 *  3. falls back to a cookie file or the browser's cookie jar
 *     (`--cookies-from-browser`) when YouTube demands a session;
 *  4. translates the final error into one actionable sentence.
 *
 * Nothing here bypasses DRM or paywalls: it only uses the public player
 * endpoints yt-dlp already implements, in the combinations YouTube is least
 * aggressive about.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, ROOT, YTDLP } from "./config";
import { run } from "./exec";

export type YtAttempt = { label: string; ok: boolean; error?: string; ms: number };

export type YtResult<T> = {
  ok: boolean;
  data?: T;
  error?: string;
  hint?: string;
  attempts: YtAttempt[];
};

const isYoutube = (url: string) =>
  /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|m\.youtube\.com|music\.youtube\.com)/i.test(
    (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return "";
      }
    })(),
  );

/**
 * Client ladder. `default` keeps yt-dlp's own choice; the rest are explicit.
 * Order matters: newer yt-dlp builds prefer web_safari/embedded because they
 * need fewer tokens, so they come first.
 */
export const YOUTUBE_CLIENTS = [
  "default",
  "web_safari",
  "web_embedded",
  "android_vr",
  "tv",
  "ios",
  "web",
  "mweb",
] as const;

export type YoutubeClient = (typeof YOUTUBE_CLIENTS)[number];

/** Where a cookie file may live (user supplied, never committed). */
export function cookieFile(): string | null {
  const explicit = process.env.YTDLP_COOKIES_FILE;
  if (explicit && existsSync(explicit)) return explicit;
  for (const p of [path.join(DATA_DIR, "cookies.txt"), path.join(ROOT, "cookies.txt")]) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Browser to import cookies from, e.g. YTDLP_COOKIES_FROM_BROWSER=chrome */
export function cookieBrowser(): string | null {
  const b = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim();
  return b || null;
}

export function cookieArgs(): string[] {
  // An explicit cookie file wins; the browser jar is the convenience option.
  const file = cookieFile();
  if (file) return ["--cookies", file];
  const browser = cookieBrowser();
  if (browser) return ["--cookies-from-browser", browser];
  return [];
}

/** Retry / politeness flags that reduce YouTube throttling. */
export const RESILIENCE_ARGS = [
  "--retries",
  "5",
  "--fragment-retries",
  "10",
  "--retry-sleep",
  "exp=1:8",
  "--socket-timeout",
  "20",
  "--newline",
];

/**
 * Run yt-dlp against a URL, trying client strategies in order when it is a
 * YouTube link. Non-YouTube URLs take a single default attempt.
 */
export async function ytdlpSmart(
  url: string,
  buildArgs: (extra: string[]) => string[],
  opts: { timeoutMs?: number; clients?: readonly string[]; attemptsLog?: YtAttempt[] } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string; attempts: YtAttempt[] }> {
  const attempts = opts.attemptsLog ?? [];
  const youtube = isYoutube(url);
  const clients = youtube ? (opts.clients ?? YOUTUBE_CLIENTS) : (["default"] as const);

  let last = { stdout: "", stderr: "" };
  for (const client of clients) {
    const extra: string[] = [];
    if (client !== "default") extra.push("--extractor-args", `youtube:player_client=${client}`);
    // A second pass with cookies only makes sense once the token needs show up.
    const args = buildArgs([...extra, ...cookieArgs()]);
    const t0 = Date.now();
    const r = await run(YTDLP, args, { timeoutMs: opts.timeoutMs ?? 120_000 });
    last = { stdout: r.stdout, stderr: r.stderr };
    const errLine = firstError(r.stderr);
    const ok = r.code === 0;
    attempts.push({
      label: `${client}${cookieArgs().length ? "+cookies" : ""}`,
      ok,
      error: ok ? undefined : errLine,
      ms: Date.now() - t0,
    });
    if (ok) return { ok: true, ...last, attempts };

    // Permanent failures: retrying with other clients will not help and just
    // burns time. "Video unavailable" / private / removed are final.
    if (/video unavailable|private video|removed by the uploader|members-only|age-restricted/i.test(errLine ?? "")) {
      break;
    }
    // TLS-level blocking (corporate firewall) affects every client — stop early.
    if (/TLS\/SSL connection has been closed|Connection reset by peer|Name or service not known|Failed to resolve/i.test(errLine ?? "")) {
      break;
    }
  }

  return { ok: false, ...last, attempts };
}

/**
 * Spawn-based variant for downloads: keeps stdout/stderr streaming so the UI
 * can show live progress, while still walking the client ladder on failure.
 */
export async function ytdlpSpawnSmart(
  url: string,
  buildArgs: (extra: string[]) => string[],
  opts: {
    onLine?: (line: string) => void;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{ ok: boolean; stderr: string; attempts: YtAttempt[] }> {
  const { spawnCollect } = await import("./exec");
  const attempts: YtAttempt[] = [];
  const clients = isYoutube(url) ? YOUTUBE_CLIENTS : (["default"] as const);

  let stderr = "";
  for (const client of clients) {
    const extra: string[] = [];
    if (client !== "default") extra.push("--extractor-args", `youtube:player_client=${client}`);
    const args = buildArgs([...extra, ...cookieArgs()]);
    const ck = cookieArgs().length ? "+cookies" : "";
    const t0 = Date.now();

    const h = spawnCollect(YTDLP, args);
    h.child.stdout?.on("data", (b: Buffer) => opts.onLine?.(b.toString()));
    h.child.stderr?.on("data", (b: Buffer) => {
      stderr += b.toString();
      opts.onLine?.(b.toString());
    });
    const onAbort = () => h.kill("SIGINT");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const res = await h.done;
    opts.signal?.removeEventListener("abort", onAbort);

    const errLine = firstError(res.stderr) ?? undefined;
    attempts.push({ label: `${client}${ck}`, ok: res.code === 0, error: errLine, ms: Date.now() - t0 });
    if (res.code === 0) return { ok: true, stderr: "", attempts };

    stderr = res.stderr;
    if (/video unavailable|private video|removed by the uploader|members-only/i.test(errLine ?? "")) break;
    if (/TLS\/SSL connection has been closed|Connection reset by peer|Failed to resolve|Name or service not known/i.test(errLine ?? "")) break;
  }
  return { ok: false, stderr, attempts };
}

export function firstError(stderr: string): string | undefined {
  return stderr
    .split("\n")
    .map((l) => l.replace(/^ERROR:\s*/i, "").trim())
    .filter(Boolean)
    .pop();
}

/** One actionable sentence for the user, based on the failure text. */
export function explainYoutubeError(rawError: string, attempts: YtAttempt[] = []): string {
  const e = rawError.toLowerCase();
  const tried = attempts.length ? ` (tried ${attempts.map((a) => a.label).join(", ")})` : "";

  if (/tls\/ssl connection has been closed|connection reset|failed to resolve|name or service/.test(e)) {
    return (
      "This network blocks YouTube at the firewall level — DNS resolves but every HTTPS connection to " +
      "youtube.com / googlevideo.com is dropped. ClipForge cannot work around a network block. " +
      "Run ClipForge on a normal connection, or ask your admin to allow youtube.com, " +
      "*.googlevideo.com and youtubei.googleapis.com" +
      tried +
      "."
    );
  }
  if (/sign in to confirm|not a bot|cookies|login required|confirm your age/.test(e)) {
    return (
      "YouTube wants a logged-in session (the classic “Sign in to confirm you’re not a bot”). " +
      "Fix it once — either pass your browser cookies: set YTDLP_COOKIES_FROM_BROWSER=chrome " +
      "(or firefox/edge/safari) and restart, or export a cookies.txt into .data/cookies.txt " +
      "(use a throwaway Google account, never your main one). " +
      "ClipForge already retries across 7 player clients" +
      tried +
      "."
    );
  }
  if (/403|forbidden/.test(e)) {
    return (
      "YouTube accepted the metadata but refused the media stream (HTTP 403). This is usually an " +
      "expired or IP-locked link. Re-run the clip (the URL is re-resolved), or add cookies via " +
      "YTDLP_COOKIES_FROM_BROWSER. If you are on a VPN/proxy, try turning it off — YouTube locks " +
      "streams to the requesting IP" +
      tried +
      "."
    );
  }
  if (/requested format is not available/.test(e)) {
    return "That download format is not offered for this video. ClipForge retries with a simpler format selector — re-run, or ask for a shorter clip.";
  }
  if (/video unavailable|private video|removed by the uploader|members-only/.test(e)) {
    return "The video itself is unavailable (private, removed, members-only or region-locked). Nothing can be downloaded for it.";
  }
  if (/unsupported url|no suitable extractor/.test(e)) {
    return "That link is not a supported video page. Try the direct MP4/HLS URL instead.";
  }
  if (/is live|live event will begin|premieres in/.test(e)) {
    return "The video has not started yet (a scheduled premiere or upcoming live). Wait for it to begin, then use Live ▸ Record.";
  }
  return `${rawError}${tried}. If this persists, update yt-dlp (\`yt-dlp -U\`) — YouTube changes its player often and yt-dlp ships fixes weekly.`;
}

/** Progress + diagnostics for the UI/MCP. */
export async function youtubeDoctor(): Promise<{
  reachable: boolean;
  detail: string;
  cookies: "file" | "browser" | "none";
  clients: readonly string[];
  version?: string;
}> {
  const ver = await run(YTDLP, ["--version"], { timeoutMs: 15_000 });
  const version = ver.stdout.trim().split("\n")[0];
  const probe = await run(
    YTDLP,
    [
      "--simulate",
      "--no-warnings",
      "--socket-timeout",
      "10",
      "--extractor-args",
      "youtube:player_client=web_embedded",
      "https://www.youtube.com/watch?v=aqz-KE-bpKQ", // Big Buck Bunny (public, stable)
    ],
    { timeoutMs: 45_000 },
  );
  const reachable = probe.code === 0;
  const err = firstError(probe.stderr) ?? "";
  return {
    reachable,
    detail: reachable
      ? "YouTube is reachable and resolvable from this machine."
      : explainYoutubeError(err, []),
    cookies: cookieFile() ? "file" : cookieBrowser() ? "browser" : "none",
    clients: YOUTUBE_CLIENTS,
    version,
  };
}
