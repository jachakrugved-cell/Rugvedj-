#!/usr/bin/env node
/**
 * `npm run smoke` — real end-to-end check with no mocks:
 *
 *  1. health of the engine (starts `next dev` if needed)
 *  2. probe a real MP4
 *  3. cut a vertical clip with captions and verify it with ffprobe
 *  4. live: spin a rolling HLS stream, record 6s, then clip the recording
 *
 * Exit code 0 only if every step works.
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PORT = Number(process.env.CLIPFORGE_PORT ?? 3000);
const BASE = process.env.CLIPFORGE_ENGINE_URL ?? `http://127.0.0.1:${PORT}`;
const FFMPEG = process.env.FFMPEG_BIN ?? path.join(ROOT, ".tools", "bin", "ffmpeg");
const FFPROBE = process.env.FFPROBE_BIN ?? path.join(ROOT, ".tools", "bin", "ffprobe");

const G = "\x1b[32m", R = "\x1b[31m", D = "\x1b[2m", B = "\x1b[1m", X = "\x1b[0m";
const pass = (m) => console.log(`  ${G}✓${X} ${m}`);
const fail = (m) => console.log(`  ${R}✗${X} ${m}`);
const info = (m) => console.log(`  ${D}${m}${X}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pick a free TCP port (avoids clashing with `npm run demo:live` etc.). */
function freePort() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

let failures = 0;
const check = (cond, okMsg, failMsg) => {
  if (cond) pass(okMsg);
  else {
    failures++;
    fail(failMsg);
  }
  return cond;
};

async function get(pathname, tries = 1) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}${pathname}`, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) return await r.json().catch(() => null);
    } catch {
      /* retry */
    }
    await sleep(1500);
  }
  return null;
}

async function post(pathname, body, timeoutMs = 300_000) {
  const r = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return r.json().catch(() => null);
}

function ffprobeJson(file) {
  const r = spawnSync(FFPROBE, [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
  ], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

async function main() {
  console.log(`\n${B}ClipForge smoke test${X}  ${D}${BASE}${X}\n`);

  // 0 ── binaries
  console.log(`${B}1. Binaries${X}`);
  const ffOk = existsSync(FFMPEG);
  check(ffOk, `ffmpeg found (${FFMPEG})`, `ffmpeg missing at ${FFMPEG} — run npm run setup`);
  if (!ffOk) process.exit(1);

  // 1 ── engine
  console.log(`\n${B}2. Engine${X}`);
  let health = await get("/api/health", 1);
  if (!health) {
    info("engine not running — starting `npm run dev`…");
    const child = spawn("npm", ["run", "dev"], {
      cwd: ROOT,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PORT: String(PORT) },
    });
    child.unref();
    health = await get("/api/health", 40);
  }
  check(!!health?.ok, `engine online at ${BASE}`, `engine did not respond at ${BASE}`);
  if (health) {
    check(health.ffmpeg?.ok, "engine sees ffmpeg", "engine cannot run ffmpeg");
    info(`yt-dlp: ${health.ytdlp?.ok ? health.ytdlp.version : "not installed (optional)"}`);
  }
  if (!health?.ok) process.exit(1);

  // 2 ── probe a real file over HTTP
  console.log(`\n${B}3. Probe a real MP4${X}`);
  const demoUrl = `${BASE}/demo/demo-clip.mp4`;
  const probe = await post("/api/probe", { url: demoUrl });
  check(probe?.ok === true, `probe ok — ${probe?.width}x${probe?.height}, ${probe?.durationSec}s, ${probe?.vcodec}/${probe?.acodec}`, `probe failed: ${probe?.error}`);
  check(probe?.isLive === false, "VOD correctly reported as not live", "VOD mis-reported as live");

  // 3 ── cut a clip with captions + vertical crop
  console.log(`\n${B}4. Cut a captioned 9:16 clip${X}`);
  const t0 = Date.now();
  const clipRes = await post("/api/clips", {
    source: demoUrl,
    start: 4,
    end: 12,
    title: "Smoke test clip",
    aspect: "9:16",
    captions: "Smoke test\ncaptions are burned in\nand wrapped properly",
    captionStyle: "bold",
  });
  const clip = clipRes?.clip;
  check(clipRes?.ok === true && !!clip, `clip created in ${((Date.now() - t0) / 1000).toFixed(1)}s`, `clip failed: ${clipRes?.error}`);
  if (clip) {
    const meta = ffprobeJson(clip.file);
    const v = meta?.streams?.find((s) => s.codec_type === "video");
    check(v?.width === 1080 && v?.height === 1920, `output is 1080x1920 (${clip.style} captions)`, `unexpected size ${v?.width}x${v?.height}`);
    check(Math.abs(Number(meta?.format?.duration) - 8) < 1.2, `duration ≈ 8s (${Number(meta?.format?.duration).toFixed(2)}s)`, "wrong clip duration");
    check(meta?.streams?.some((s) => s.codec_type === "audio"), "audio track present", "audio missing");

    // library + file serving + range request
    const lib = await get("/api/clips");
    check(lib?.clips?.some((c) => c.id === clip.id), "clip indexed in library", "clip missing from library");

    const range = await fetch(`${BASE}/api/clips/${clip.id}/file`, {
      headers: { range: "bytes=0-1023" },
      signal: AbortSignal.timeout(10_000),
    });
    check(range.status === 206 && (await range.arrayBuffer()).byteLength === 1024, "range streaming works (seekable preview)", `range request returned ${range.status}`);
  }

  // 4 ── live HLS
  console.log(`\n${B}5. Live stream: probe → record → clip${X}`);
  const liveDir = path.join(ROOT, ".data", "smoke-hls");
  rmSync(liveDir, { recursive: true, force: true });
  mkdirSync(liveDir, { recursive: true });
  const livePort = Number(process.env.SMOKE_LIVE_PORT ?? (await freePort()));
  const ff = spawn(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-re",
    "-f", "lavfi", "-i", "testsrc2=size=854x480:rate=25",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
    "-c:v", "libx264", "-preset", "ultrafast", "-g", "50", "-b:v", "900k",
    "-c:a", "aac", "-b:a", "96k",
    "-f", "hls", "-hls_time", "1", "-hls_list_size", "4",
    "-hls_flags", "delete_segments+omit_endlist",
    "-hls_segment_filename", path.join(liveDir, "seg%03d.ts"),
    path.join(liveDir, "live.m3u8"),
  ], { stdio: "ignore" });

  const server = spawn(process.execPath, ["-e", `
    const http = require("http"), fs = require("fs"), path = require("path");
    const dir = ${JSON.stringify(liveDir)};
    http.createServer((req, res) => {
      const f = path.join(dir, path.basename(req.url.split("?")[0]));
      fs.readFile(f, (e, buf) => {
        if (e) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "content-type": f.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t", "access-control-allow-origin": "*" });
        res.end(buf);
      });
    }).listen(${livePort}, "127.0.0.1");
  `], { stdio: "ignore" });

  try {
    await sleep(6000);
    const liveUrl = `http://127.0.0.1:${livePort}/live.m3u8`;
    const live = await get(`/api/live?url=${encodeURIComponent(liveUrl)}`);
    check(live?.ok === true && live?.isLive === true, "live HLS detected as LIVE", `live detection failed: ${live?.error}`);

    const rec = await post("/api/live", { url: liveUrl, durationSec: 6, title: "Smoke live" }, 180_000);
    const recFile = rec?.fileName ? path.join(ROOT, ".data", "live", rec.fileName) : null;
    check(rec?.ok === true && recFile && existsSync(recFile), `live recording captured (${rec?.durationSec?.toFixed(1)}s)`, `live recording failed: ${rec?.error}`);
    if (recFile && existsSync(recFile)) {
      const size = statSync(recFile).size;
      check(size > 20_000, `recording is real media (${(size / 1e6).toFixed(2)} MB)`, "recording looks empty");

      const fromLive = await post("/api/clips", {
        source: `/api/media/${encodeURIComponent(path.basename(recFile))}`,
        start: 0,
        end: 3,
        aspect: "1:1",
        title: "Smoke from live buffer",
      });
      check(fromLive?.ok === true, `clipped the live buffer (${fromLive?.clip?.meta?.width}x${fromLive?.clip?.meta?.height})`, `clipping the buffer failed: ${fromLive?.error}`);
      if (fromLive?.clip) rmSync(fromLive.clip.file, { force: true });
    }
  } finally {
    ff.kill("SIGINT");
    server.kill("SIGTERM");
    rmSync(liveDir, { recursive: true, force: true });
  }

  // 5 ── crew pipeline (10 agents, one call)
  console.log(`\n${B}6. Crew: 10 agents in one call${X}`);
  const crewRes = await post("/api/crew", {
    url: demoUrl,
    template: "shorts-hook",
    platform: "youtube-shorts",
    targetDurationSec: 10,
  }, 600_000);
  const crew = crewRes;
  check(crew?.ok === true, `crew delivered (${crew?.agents?.filter((a) => a.status === "done").length ?? 0}/10 agents done)`, `crew failed: ${crew?.error ?? "no result"}`);
  if (crew?.clip) {
    const cm = ffprobeJson(crew.clip.file);
    const cv = cm?.streams?.find((s) => s.codec_type === "video");
    check(cv?.width === 1080 && cv?.height === 1920, `crew clip is 1080x1920 with ${crew.clip.meta?.motion ?? "?"} motion`, `unexpected crew size ${cv?.width}x${cv?.height}`);
    check(!!crew.seo?.title && crew.seo?.hashtags?.length > 0, `SEO pack: "${crew.seo?.title}" ${crew.seo?.hashtags?.slice(0, 3).join(" ")}`, "SEO pack missing");
    check(!!crew.thumbnail, "poster frame extracted", "no poster frame");
    const qc = crew.agents?.find((a) => a.id === "qc-lead");
    check(qc?.status === "done", "QC lead passed the delivery", `QC failed: ${qc?.output}`);
  }

  // summary
  console.log("\n" + "─".repeat(52));
  if (failures === 0) {
    console.log(`${G}${B}All checks passed.${X} Open ${B}${BASE}${X} to clip for real.\n`);
  } else {
    console.log(`${R}${B}${failures} check(s) failed.${X} Run ${B}npm run doctor${X} for details.\n`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n${R}Smoke test crashed:${X}`, err);
  process.exit(1);
});
