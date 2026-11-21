#!/usr/bin/env node
/**
 * `npm run demo:live` — serves a REAL rolling live HLS stream locally so you
 * can test live previewing + recording without any external service.
 *
 *   http://127.0.0.1:8080/live.m3u8      ← paste this into the Live tab
 *
 * Requires ffmpeg (run `npm run setup` once).
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const PORT = Number(process.env.DEMO_PORT ?? 8080);
const ROOT = process.cwd();
const DIR = path.join(ROOT, ".data", "demo-hls");
const FFMPEG =
  process.env.FFMPEG_BIN ??
  (exists(path.join(ROOT, ".tools", "bin", "ffmpeg"))
    ? path.join(ROOT, ".tools", "bin", "ffmpeg")
    : "ffmpeg");

function exists(p) {
  try {
    return spawnSync("sh", ["-c", `test -x '${p}'`]).status === 0;
  } catch {
    return false;
  }
}

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const font = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
  "C:/Windows/Fonts/arialbd.ttf",
].find((f) => spawnSync("sh", ["-c", `test -f '${f}'`]).status === 0);

const label = `LIVE DEMO  ·  %{localtime\\:%H\\\\\\:%M\\\\\\:%S}`;
const drawtext = font
  ? `drawtext=fontfile=${font}:text='${label}':fontsize=44:fontcolor=white:x=40:y=40:box=1:boxcolor=black@0.55:boxborderw=12`
  : "null";

const args = [
  "-hide_banner", "-loglevel", "warning", "-re",
  "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30",
  "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000",
  "-vf", drawtext,
  "-c:v", "libx264", "-preset", "veryfast", "-g", "60", "-b:v", "1600k",
  "-c:a", "aac", "-b:a", "96k",
  "-f", "hls",
  "-hls_time", "2",
  "-hls_list_size", "6",
  "-hls_flags", "delete_segments+omit_endlist",
  "-hls_segment_filename", path.join(DIR, "seg%03d.ts"),
  path.join(DIR, "live.m3u8"),
];

const ff = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
ff.stderr.on("data", (d) => {
  const s = d.toString().trim();
  if (s) console.log("[ffmpeg]", s.split("\n").slice(-1)[0]);
});
ff.on("error", (e) => {
  console.error(`Could not start ffmpeg (${e.message}). Run: npm run setup`);
  process.exit(1);
});

const server = createServer((req, res) => {
  const name = path.basename((req.url ?? "/").split("?")[0]);
  const file = path.join(DIR, name);
  if (name === "live.m3u8") {
    if (spawnSync("sh", ["-c", `test -f '${file}'`]).status !== 0) {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("Stream is warming up — retry in a couple of seconds.");
      return;
    }
    res.writeHead(200, {
      "content-type": "application/vnd.apple.mpegurl",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    res.end(spawnSync("sh", ["-c", `cat '${file}'`]).stdout);
    return;
  }
  if (!/^seg\d+\.ts$/.test(name)) {
    res.writeHead(404).end("not found");
    return;
  }
  const buf = spawnSync("sh", ["-c", `cat '${file}' 2>/dev/null`]).stdout;
  if (!buf?.length) {
    res.writeHead(404).end("segment expired");
    return;
  }
  res.writeHead(200, {
    "content-type": "video/mp2t",
    "access-control-allow-origin": "*",
  });
  res.end(buf);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${PORT} is busy. Run with another port:\n  DEMO_PORT=8090 npm run demo:live\n`);
    ff.kill("SIGINT");
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  ClipForge live demo`);
  console.log(`  ${"─".repeat(46)}`);
  console.log(`  Paste this into the Live tab:\n`);
  console.log(`     http://127.0.0.1:${PORT}/live.m3u8\n`);
  console.log(`  Recording works because the manifest rolls (6 × 2s segments).`);
  console.log(`  Ctrl+C to stop.\n`);
});

const shutdown = () => {
  ff.kill("SIGINT");
  server.close();
  console.log("\n[clipforge] demo stream stopped");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
