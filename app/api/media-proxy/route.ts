import { lookup } from "node:dns/promises";
import net from "node:net";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

/**
 * Streaming proxy for remote media (HLS manifests, MP4s, segments).
 *
 * Browsers cannot play most CDN streams directly (CORS, signed URLs with
 * Referer checks, no CORS headers on segments). This route:
 *   • verifies the target is a public http(s) host (SSRF guard),
 *   • forwards Range/If-Range headers and streams bytes back,
 *   • rewrites HLS playlists so every segment/key still goes through us.
 *
 * GET /api/media-proxy?u=<encoded absolute url>&ref=<optional referer>
 */

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./,
];

function isPrivateAddress(addr: string): boolean {
  if (net.isIPv4(addr)) return PRIVATE_V4.some((r) => r.test(addr));
  if (net.isIPv6(addr)) {
    const a = addr.toLowerCase();
    return (
      a === "::1" ||
      a.startsWith("fc") ||
      a.startsWith("fd") ||
      a.startsWith("fe80") ||
      a.startsWith("::ffff:127.") ||
      a.startsWith("::ffff:10.") ||
      a.startsWith("::ffff:192.168.")
    );
  }
  return false;
}

async function assertPublicHost(url: URL): Promise<void> {
  if (process.env.CLIPFORGE_ALLOW_PRIVATE === "1") return;
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs can be proxied");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Local addresses are not allowed");
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("Private addresses are not allowed");
    return;
  }
  const results = await lookup(host, { all: true }).catch(() => []);
  if (results.some((r) => isPrivateAddress(r.address))) {
    throw new Error("Host resolves to a private address");
  }
}

const proxyUrl = (abs: string, referer?: string) =>
  `/api/media-proxy?u=${encodeURIComponent(abs)}${referer ? `&ref=${encodeURIComponent(referer)}` : ""}`;

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("u");
  const referer = req.nextUrl.searchParams.get("ref") ?? undefined;
  if (!target) return new Response("Missing ?u=", { status: 400 });

  let url: URL;
  try {
    url = new URL(target);
    await assertPublicHost(url);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Bad URL", { status: 400 });
  }

  const upstreamHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (referer) upstreamHeaders["Referer"] = referer;
  const range = req.headers.get("range");
  if (range) upstreamHeaders["Range"] = range;
  const ifRange = req.headers.get("if-range");
  if (ifRange) upstreamHeaders["If-Range"] = ifRange;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: upstreamHeaders,
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
  } catch (err) {
    return new Response(`Upstream fetch failed: ${(err as Error).message}`, { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(`Upstream responded ${upstream.status}`, { status: upstream.status });
  }

  const finalUrl = upstream.url ? new URL(upstream.url) : url;
  const type = (upstream.headers.get("content-type") ?? "").toLowerCase();

  // Rewrite HLS playlists so every child request stays proxied.
  const looksPlaylist =
    type.includes("mpegurl") ||
    url.pathname.toLowerCase().endsWith(".m3u8") ||
    finalUrl.pathname.toLowerCase().endsWith(".m3u8");

  if (looksPlaylist) {
    const text = await upstream.text();
    const isMaster = /#EXT-X-STREAM-INF/i.test(text);
    const out = text
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith("#")) {
          return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => {
            try {
              return `URI="${proxyUrl(new URL(uri, finalUrl).toString(), referer)}"`;
            } catch {
              return `URI="${uri}"`;
            }
          });
        }
        try {
          return proxyUrl(new URL(trimmed, finalUrl).toString(), referer);
        } catch {
          return line;
        }
      })
      .join("\n");

    return new Response(out, {
      status: 200,
      headers: {
        "Content-Type": isMaster
          ? "application/vnd.apple.mpegurl"
          : "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Pass-through of media bytes (supports 206 ranges).
  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Accept-Ranges": upstream.headers.get("accept-ranges") ?? "bytes",
  });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  const cr = upstream.headers.get("content-range");
  if (cr) headers.set("Content-Range", cr);

  return new Response(upstream.body, { status: upstream.status, headers });
}
