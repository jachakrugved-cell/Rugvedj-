/**
 * `npm run doctor` — prints exactly what ClipForge can do on this machine.
 * Exits non-zero when clipping is impossible (no ffmpeg).
 */
import { existsSync } from "node:fs";
import { FFMPEG, FFPROBE, YTDLP, DATA_DIR, FONT_FILE } from "../lib/config";
import { binaryAvailable, probe, ytdlpAvailable } from "../lib/media";

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function line(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? green("✓") : red("✗")} ${label.padEnd(12)} ${dim(detail)}`);
}

async function main() {
  console.log("\nClipForge doctor\n" + "─".repeat(56));

  const ffOk = await binaryAvailable(FFMPEG);
  const fpOk = await binaryAvailable(FFPROBE);
  const ytOk = await ytdlpAvailable();

  await line("ffmpeg", ffOk, FFMPEG);
  await line("ffprobe", fpOk, FFPROBE);
  await line("yt-dlp", ytOk, ytOk ? YTDLP : `${YTDLP} (optional: page links + live pages)`);
  await line("font", !!FONT_FILE, FONT_FILE || "no TrueType font found (captions need one)");
  await line("data dir", existsSync(DATA_DIR), DATA_DIR);
  await line("node", Number(process.versions.node.split(".")[0]) >= 20, `v${process.versions.node}`);

  if (fpOk) {
    console.log("\n" + "─".repeat(56));
    console.log("ffprobe smoke test (self-probe):");
    const info = await probe(FFPROBE).catch(() => null);
    if (!info) console.log(`  ${yellow("!")} ffprobe exists but could not read itself (normal — it is not media).`);
  }

  console.log("\n" + "─".repeat(56));
  console.log("Capabilities:");
  console.log(`  clip local files      ${ffOk ? green("yes") : red("no")}`);
  console.log(`  clip direct URLs      ${ffOk ? green("yes") : red("no")}`);
  console.log(`  clip HLS/DASH         ${ffOk ? green("yes") : red("no")}`);
  console.log(`  clip YouTube/Vimeo    ${ffOk && ytOk ? green("yes") : red("needs yt-dlp")}`);
  console.log(`  record live streams   ${ffOk ? green("yes") : red("no")}${ytOk ? "" : dim(" (page live links need yt-dlp)")}`);
  console.log(`  burn-in captions      ${ffOk && FONT_FILE ? green("yes") : red("no")}`);
  console.log(`  vertical export       ${ffOk ? green("yes") : red("no")}`);

  if (!ffOk) {
    console.log(`\n${red("ffmpeg is required.")} Run ${yellow("npm run setup")} to download a portable build.`);
    process.exit(1);
  }
  if (!ytOk) {
    console.log(`\n${yellow("Tip:")} run ${yellow("npm run setup")} to add yt-dlp and unlock YouTube/Vimeo/Twitch links.`);
  }

  console.log(`\nStart the studio: ${yellow("npm run dev")}  →  http://127.0.0.1:3000`);
  console.log(`Connect Claude : ${yellow("claude mcp add clipforge -- npx -y tsx mcp/server.ts")}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
