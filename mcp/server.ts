#!/usr/bin/env node
/**
 * ClipForge MCP server — gives Claude Code a free, local video clipper.
 *
 * Tools:
 *   check_engine  ping the engine, report ffmpeg / ffprobe / yt-dlp status
 *   crew_video    run all 10 specialist agents (find → clip → caption → SEO)
 *   edit_video    CapCut-class multi-clip timeline render (looks, titles, music)
 *   youtube_status is YouTube reachable + which cookie/client mitigation is active
 *   find_music    search free/CC music (SoundCloud, Bandcamp, Archive.org, Jamendo)
 *   editor_kit    every transition / look / sound preset / FX the editor supports
 *   probe_video   read any link (page, MP4, HLS, DASH, live) → metadata
 *   clip_video    cut a clip by link or clip id (aspect, captions, styles)
 *   record_live   record N seconds of a live stream to a local MP4
 *   list_clips    list the local library
 *   get_clip      full metadata for one clip
 *   delete_clip   delete a clip from disk + index
 *
 * Transport: stdio. Register once (from the repo root):
 *   claude mcp add clipforge -- npx -y tsx mcp/server.ts
 *
 * Env:
 *   CLIPFORGE_ENGINE_URL   default http://127.0.0.1:3000
 *   CLIPFORGE_AUTOSTART    "0" disables auto-starting the engine
 *   CLIPFORGE_ROOT         repo root (default: cwd)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AGENTS, agentLines, runCrew, type AgentId } from "../lib/agents.js";
import { EngineClient, EngineError } from "../lib/engine-client.js";
import { parseTimecode } from "../lib/time.js";

const engine = new EngineClient();

const asTime = (v: number | string | undefined, fallback = 0): number => {
  if (v === undefined || v === null || v === "") return fallback;
  const n = parseTimecode(v);
  return n === null ? fallback : n;
};

const fmt = (sec: number | null | undefined): string => {
  if (sec === null || sec === undefined) return "unknown";
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
};

const text = (body: string) => ({ content: [{ type: "text" as const, text: body }] });
const fail = (err: unknown) =>
  ({
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `ClipForge error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ],
  });

const server = new McpServer({
  name: "clipforge",
  version: "1.0.0",
});

server.tool(
  "check_engine",
  "Connect to ClipForge and verify the local engine, ffmpeg, ffprobe and yt-dlp. Call this first when the user asks to connect or when another tool fails.",
  {},
  async () => {
    try {
      let h;
      try {
        h = await engine.health(3000);
      } catch {
        // Not running — start it (unless the user disabled autostart).
        h = await engine.ensureEngine();
      }
      return text(
        [
          `ClipForge engine: ${h.ok ? "ONLINE" : "degraded"} at ${engine.baseUrl}`,
          `ffmpeg  : ${h.ffmpeg.ok ? "ok" : "MISSING"} (${h.ffmpeg.version ?? h.ffmpeg.path})`,
          `ffprobe : ${h.ffprobe.ok ? "ok" : "MISSING"} (${h.ffprobe.version ?? h.ffprobe.path})`,
          `yt-dlp  : ${h.ytdlp.ok ? "ok" : "not installed — page links & live pages need it; run npm run setup"} (${h.ytdlp.version ?? h.ytdlp.path})`,
          `data dir: ${h.dataDir}`,
          h.hint ?? "",
          "",
          "Ready. Ask for a clip: give me a video link and an in/out range.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "probe_video",
  "Inspect any video link or local clip: title, duration, resolution, fps, whether it is LIVE, and whether it is directly playable. Supports YouTube/Vimeo/Twitch/Vimeo pages, direct MP4/WebM files, HLS (.m3u8) and DASH (.mpd) manifests, live streams, and existing clip ids.",
  {
    url: z.string().describe("Any video URL, HLS/DASH manifest, or a clip id from list_clips"),
    fresh: z.boolean().optional().describe("Bypass the 5-minute metadata cache"),
  },
  async ({ url, fresh }) => {
    try {
      const info = await engine.probe(url, fresh);
      return text(
        [
          `source      : ${info.kind}`,
          `title       : ${info.title ?? "(none)"}`,
          `uploader    : ${info.uploader ?? "(unknown)"}`,
          `duration    : ${info.isLive ? "LIVE (no fixed duration)" : fmt(info.durationSec)}`,
          `resolution  : ${info.width && info.height ? `${info.width}x${info.height}` : "unknown"}${info.fps ? ` @ ${info.fps}fps` : ""}`,
          `tracks      : video=${info.hasVideo ? info.vcodec ?? "yes" : "no"} audio=${info.hasAudio ? info.acodec ?? "yes" : "no"}`,
          `live        : ${info.isLive ? "YES — use record_live, then clip the recording" : "no"}`,
          `playable    : ${info.previewUrl ? "yes" : "not directly playable (still clip-able)"}`,
          "",
          info.isLive
            ? "Next: record_live url=<same link> durationSec=<n>, then clip_video source=<recording file>."
            : `Next: clip_video source="${url}" start="0:10" end="0:35" aspect="9:16".`,
        ].join("\n"),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "clip_video",
  "Cut a clip from any link (or from a local clip/recording) and save it as an MP4 in the local library. Handles aspect-ratio conversion with a smart center crop, burned-in captions (6 styles), and timecodes like 90, 1:30 or 01:02:03.",
  {
    source: z
      .string()
      .describe("Video URL (page, MP4, HLS manifest) or a clip id/file name from list_clips"),
    start: z
      .union([z.string(), z.number()])
      .describe('Start time: seconds (12.5), clock (1:30), or long form (1h2m3s). Use "-15" for 15s before the end.'),
    end: z
      .union([z.string(), z.number()])
      .optional()
      .describe("End time in the same formats. Defaults to start + 30s when omitted."),
    duration: z
      .union([z.string(), z.number()])
      .optional()
      .describe("Alternative to end: clip length, e.g. 30 or 0:30"),
    title: z.string().optional().describe("Clip title (used for the file name and library)"),
    aspect: z
      .enum(["original", "9:16", "1:1", "4:5", "16:9", "4:3"])
      .optional()
      .describe("Output aspect ratio. Default original. 9:16 for Reels/Shorts/TikTok."),
    captions: z
      .string()
      .optional()
      .describe(
        "Caption source: SRT/VTT with timestamps (best), or plain text lines that will be timed across the clip.",
      ),
    captionStyle: z
      .enum(["clean", "bold", "karaoke", "highlight", "neon", "minimal"])
      .optional()
      .describe("Caption look. Default clean."),
    filename: z.string().optional().describe("Base file name (no extension)"),
  },
  async (args) => {
    try {
      const start = asTime(args.start, 0);
      let end = args.end !== undefined ? asTime(args.end) : NaN;
      if (!Number.isFinite(end) || args.end === undefined) {
        end = start + (args.duration !== undefined ? asTime(args.duration, 30) : 30);
      } else if (end < 0) {
        // "-15" means 15 seconds before the end — resolve against duration.
        const info = await engine.probe(args.source);
        end = (info.durationSec ?? 0) + end;
      }
      if (end <= start) {
        return fail(new Error("end must be greater than start"));
      }

      const { clip } = await engine.createClip({
        source: args.source,
        start,
        end,
        title: args.title,
        aspect: args.aspect,
        captions: args.captions,
        captionStyle: args.captionStyle,
        filename: args.filename,
      });

      return text(
        [
          `Clip created.`,
          `title    : ${clip.title}`,
          `file     : ${clip.file}`,
          `range    : ${fmt(clip.startSec)} → ${fmt(clip.endSec)} (${fmt(clip.durationSec)})`,
          `output   : ${clip.meta?.width ?? "?"}x${clip.meta?.height ?? "?"} (${clip.aspect}${clip.captions ? `, ${clip.style} captions` : ""})`,
          `size     : ${(clip.sizeBytes / 1e6).toFixed(2)} MB`,
          `clip id  : ${clip.id}`,
          `open     : ${engine.baseUrl} (Library tab)`,
        ].join("\n"),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "record_live",
  "Record a live stream (HLS/DASH/page live URL) for N seconds from now and save an MP4 in the library folder. Then use clip_video on the returned file to cut the highlight.",
  {
    url: z.string().describe("Live stream link: .m3u8/.mpd manifest, or a Twitch/YouTube/Kick live page"),
    durationSec: z
      .number()
      .min(5)
      .max(7200)
      .optional()
      .describe("How many seconds to record. Default 60."),
    title: z.string().optional().describe("Name for the recording"),
  },
  async ({ url, durationSec, title }) => {
    try {
      const info = await engine.liveInfo(url);
      const secs = Math.min(durationSec ?? 60, info.maxRecordSec ?? 7200);
      const rec = await engine.recordLive({ url, durationSec: secs, title });
      return text(
        [
          `Live recording saved (${fmt(rec.durationSec)}).`,
          `file   : ${rec.fileName}`,
          `in data: .data/live/${rec.fileName}`,
          ``,
          `Next: clip_video source="${rec.fileName}" start="0:05" end="0:20" to cut the highlight.`,
        ].join("\n"),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "crew_video",
  "ONE-CALL video team. Runs all 10 ClipForge agents: find a video (YouTube search or a link) → rank it → pick the moment → cut → caption → add motion → check audio → thumbnail → SEO → QC. Prefer this for requests like \"find a viral clip and edit it\" — it replaces 5+ tool round-trips and returns one dense summary.",
  {
    theme: z
      .string()
      .optional()
      .describe('Search query, e.g. "viral cat shorts", or paste a video link here'),
    url: z.string().optional().describe("Specific video link (skips search)"),
    template: z
      .enum(["shorts-hook", "reels-clean", "tiktok-karaoke", "podcast-clip", "cinematic", "square-proof", "raw"])
      .optional()
      .describe("Edit template: aspect + motion + caption style in one word. Default shorts-hook."),
    platform: z
      .enum(["youtube-shorts", "tiktok", "instagram-reels", "youtube", "linkedin"])
      .optional()
      .describe("Target platform (affects hashtags + recommended posting time)"),
    start: z.number().optional().describe("Force an in-point (seconds). Otherwise the Editor picks."),
    end: z.number().optional().describe("Force an out-point (seconds)."),
    targetDurationSec: z.number().optional().describe("Desired clip length when the Editor picks (default 20)"),
    captionScript: z
      .string()
      .optional()
      .describe("Caption lines, one per line (auto-timed) or SRT/VTT. Omit for an auto hook script."),
    motion: z
      .enum(["none", "zoom-in", "zoom-out", "pan-left", "pan-right", "shake", "pulse", "whip"])
      .optional()
      .describe("Override the template's camera motion"),
    only: z
      .array(z.string())
      .optional()
      .describe("Run only these agent ids (talent-scout, analyst, editor, clip-smith, captioner, motion-artist, sound-tech, thumbnailist, seo-writer, qc-lead)"),
    except: z.array(z.string()).optional().describe("Skip these agent ids"),
  },
  async (args) => {
    try {
      const crew = await runCrew({
        theme: args.theme,
        url: args.url,
        template: args.template,
        platform: args.platform,
        start: args.start,
        end: args.end,
        targetDurationSec: args.targetDurationSec,
        captionScript: args.captionScript,
        motion: args.motion,
        only: args.only as AgentId[] | undefined,
        except: args.except as AgentId[] | undefined,
      });
      const lines = [
        crew.ok ? "🎬 CREW DELIVERED" : "⚠️ CREW FAILED",
        "",
        agentLines(crew),
        "",
        crew.clip ? `FILE: ${crew.clip.file}` : "",
        crew.clip
          ? `OPEN: ${engine.baseUrl} (Library tab) · id=${crew.clip.id}`
          : crew.search.note ?? "",
        crew.seo ? `SEO: ${crew.seo.title} · ${crew.seo.hashtags.join(" ")} · best ${crew.seo.bestTime}` : "",
        crew.thumbnail ? `THUMB: ${crew.thumbnail.file}` : "",
      ];
      return text(lines.filter(Boolean).join("\n"));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "edit_video",
  "CapCut-class editor in ONE call. Builds a multi-clip timeline: per-clip trim, speed, reverse, zoom, 16 looks, 8 motions, 9 transitions, free-positioned titles with animations, sticker overlays, music beds with auto-ducking — then renders one MP4. Prefer this over clip_video when the user asks to EDIT, not just cut.",
  {
    title: z.string().optional().describe("Output name, e.g. \"Gym motivation cut\""),
    aspect: z.enum(["9:16", "1:1", "4:5", "16:9", "4:3"]).optional().describe("Frame (default 9:16)"),
    clips: z
      .array(
        z.object({
          source: z.string().describe("Video link, /api/media/<file>, or clip id"),
          start: z.number().optional().describe("In-point seconds (default 0)"),
          end: z.number().optional().describe("Out-point seconds"),
          speed: z.number().optional().describe("0.25–4× (default 1)"),
          reverse: z.boolean().optional(),
          zoom: z.number().optional().describe("1–3× push-in"),
          look: z.string().optional().describe("Grade: warm|cool|cinematic|vintage|bw|sepia|vivid|soft|dreamy|noir|neon|sunset|matrix|crisp|fadey|none"),
          motion: z.enum(["none", "zoom-in", "zoom-out", "pan-left", "pan-right", "shake", "pulse", "whip"]).optional(),
          volume: z.number().optional().describe("0–2 (default 1)"),
          mute: z.boolean().optional(),
          transition: z.enum(["none", "fade", "dissolve", "wipeleft", "wiperight", "slideup", "slidedown", "circle", "smooth"]).optional().describe("Transition into the next clip"),
          transitionSec: z.number().optional().describe("0.1–2 s (default 0.4)"),
        }),
      )
      .describe("Ordered video segments"),
    texts: z
      .array(
        z.object({
          text: z.string(),
          at: z.number().optional().describe("Start second"),
          duration: z.number().optional().describe("Seconds (default 3)"),
          position: z.enum(["top", "center", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
          x: z.number().optional().describe("0–1 exact override"),
          y: z.number().optional(),
          size: z.number().optional().describe("Font px (auto if omitted)"),
          color: z.string().optional().describe("#rrggbb"),
          box: z.boolean().optional(),
          animation: z.enum(["none", "fade", "slide-up", "pop", "typewriter"]).optional(),
        }),
      )
      .optional()
      .describe("Titles / lower-thirds / captions"),
    audios: z
      .array(
        z.object({
          source: z.string(),
          at: z.number().optional(),
          volume: z.number().optional().describe("0–2 (default 0.35)"),
          loop: z.boolean().optional(),
          duckToClips: z.boolean().optional().describe("Lower music under dialogue"),
        }),
      )
      .optional()
      .describe("Music / voiceover beds"),
    overlays: z
      .array(
        z.object({
          source: z.string().describe("Sticker image URL or /emoji/star.png"),
          at: z.number().optional(),
          duration: z.number().optional(),
          x: z.number().optional().describe("0–1 centre"),
          y: z.number().optional(),
          width: z.number().optional().describe("Fraction of frame width"),
          opacity: z.number().optional(),
          rotate: z.number().optional().describe("Degrees"),
          fade: z.number().optional(),
        }),
      )
      .optional()
      .describe("Stickers / logos / emoji"),
  },
  async (args) => {
    try {
      const res = await engine.renderStudio({
        title: args.title,
        aspect: args.aspect ?? "9:16",
        clips: args.clips,
        texts: args.texts,
        audios: args.audios,
        overlays: args.overlays,
      });
      const c = res.clip;
      const lines = [
        "🎬 EDIT RENDERED",
        `${c.title} · ${fmt(c.durationSec)} · ${c.meta?.width}×${c.meta?.height} · ${(c.sizeBytes / 1e6).toFixed(1)} MB`,
        `${args.clips.length} clip(s) · ${args.texts?.length ?? 0} title(s) · ${args.overlays?.length ?? 0} sticker(s) · ${args.audios?.length ?? 0} audio bed(s)`,
        `FILE: ${c.file}`,
        `OPEN: ${engine.baseUrl}/ (Library tab) · id=${c.id}`,
      ];
      return text(lines.join("\n"));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "youtube_status",
  "Check whether YouTube is actually reachable from this machine and which mitigation is active (cookies file / browser jar / none). Run this FIRST when a YouTube link fails — it separates network blocks from bot checks.",
  {},
  async () => {
    try {
      const d = await engine.youtubeDoctor();
      const lines = [
        d.reachable ? "✅ YouTube reachable" : "❌ YouTube NOT reachable",
        `yt-dlp: ${d.version ?? "unknown"}`,
        `cookies: ${d.cookies}`,
        `player clients tried: ${d.clients.join(", ")}`,
        "",
        d.reachable
          ? "Single-video failures are then video-specific (private, region-locked, age-gated)."
          : d.detail,
      ];
      if (!d.reachable && d.cookies === "none") {
        lines.push(
          "",
          "To add a session: set YTDLP_COOKIES_FROM_BROWSER=chrome (or firefox/edge/safari),",
          "or save a Netscape cookies.txt to .data/cookies.txt. Use a throwaway account.",
        );
      }
      return text(lines.join("\n"));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "find_music",
  "Search FREE music for a video: SoundCloud, Bandcamp, Archive.org and Jamendo (CC / public-domain catalogues). Returns tracks with licence + credit link, and can download one straight into the media pool for a music bed. Note: Spotify is deliberately not supported — playback needs Premium and its terms forbid downloading.",
  {
    query: z.string().describe('Mood/genre, e.g. "lofi study", "epic cinematic trailer"'),
    sources: z
      .array(z.enum(["soundcloud", "bandcamp", "archive", "jamendo"]))
      .optional()
      .describe("Restrict to specific sources (default: all)"),
    limit: z.number().min(1).max(25).optional().describe("Max tracks (default 8)"),
    download: z.string().url().optional().describe("Track URL to download into the media pool for a music bed"),
  },
  async (args) => {
    try {
      if (args.download) {
        const r = await engine.requestMusicDownload(args.download);
        return text(`🎵 Downloaded\nFILE: ${r.fileName}\nUSE: /api/media/${encodeURIComponent(r.fileName)}\n(as a music bed in edit_video audios[].source)`);
      }
      const r = await engine.searchMusic(args.query, args.sources, args.limit ?? 8);
      if (!r.tracks?.length) {
        const errs = r.errors?.map((e) => `${e.source}: ${e.error}`).join(" · ") ?? "no results";
        return text(`No free tracks found (${errs}).`);
      }
      const lines = r.tracks.map(
        (t, i) =>
          `${i + 1}. ${t.artist} — ${t.title}${t.durationSec ? ` (${fmt(t.durationSec)})` : ""}\n   ${t.source} · ${t.license}\n   ${t.url}`,
      );
      return text(
        [`🎵 ${r.tracks.length} free tracks for "${args.query}"`, "", ...lines, "", "Download one with find_music(download=<url>), then use it in edit_video audios[]."].join("\n"),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "editor_kit",
  "List everything the ClipForge editor can do: all 58 transitions, 16 looks, 17 sound presets, 15 video FX, title animations and one-tap recipes. Call this before promising a specific effect.",
  {},
  async () => {
    try {
      const p = await engine.studioPalette();
      const lines = [
        "🎛 CLIPFORGE EDITOR KIT",
        "",
        `TRANSITIONS (${p.transitions.length - 1}): ${p.transitions.filter((t) => t !== "none").join(", ")}`,
        "",
        `LOOKS (${p.looks.length}): ${p.looks.map((l) => l.id).join(", ")}`,
        "",
        `SOUND PRESETS (${p.sounds?.length ?? 0}): ${(p.sounds ?? []).map((s) => s.id).join(", ")}`,
        "",
        `VIDEO FX (${p.fx?.length ?? 0}): ${(p.fx ?? []).map((f) => f.id).join(", ")}`,
        "",
        `TITLE ANIMATIONS: ${p.titleAnimations?.join(", ") ?? "fade, slide-up, pop, typewriter, bounce, blur-in"}`,
        "",
        `RECIPES (${p.recipes.length}): ${p.recipes.map((r) => `${r.emoji} ${r.label}`).join(" · ")}`,
        "",
        "Music: find_music. Everything renders through edit_video.",
      ];
      return text(lines.join("\n"));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "list_clips",
  "List clips in the local ClipForge library, newest first.",
  {
    limit: z.number().min(1).max(100).optional().describe("Max entries (default 20)"),
  },
  async ({ limit }) => {
    try {
      const { clips } = await engine.listClips();
      if (!clips.length) return text("The library is empty. Use clip_video with a video link to make one.");
      const rows = clips.slice(0, limit ?? 20).map((c, i) => {
        return `${i + 1}. ${c.title}\n   id=${c.id}  ${fmt(c.durationSec)}  ${(c.sizeBytes / 1e6).toFixed(1)}MB  ${c.meta?.width ?? "?"}x${c.meta?.height ?? "?"}${c.captions ? "  captions" : ""}\n   ${c.file}`;
      });
      return text(`${clips.length} clip(s):\n\n${rows.join("\n\n")}`);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_clip",
  "Get full metadata for one clip, including its absolute file path and source URL.",
  { id: z.string().describe("Clip id from list_clips, or its file name") },
  async ({ id }) => {
    try {
      const { clip } = await engine.getClip(id);
      return text(JSON.stringify(clip, null, 2));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "delete_clip",
  "Delete a clip — removes the MP4 from disk and from the library index.",
  { id: z.string().describe("Clip id from list_clips") },
  async ({ id }) => {
    try {
      const { clips } = await engine.deleteClip(id);
      return text(`Clip ${id} deleted. ${clips.length} clip(s) left in the library.`);
    } catch (err) {
      return fail(err);
    }
  },
);

// ─────────────────────────── Saved prompts ───────────────────────────
// Short, argument-based prompts keep the user's context window small:
// the engine expands them server-side instead of Claude re-deriving a plan.

server.prompt(
  "connect-clipforge",
  "Connect Claude to the ClipForge browser engine and verify every binary.",
  {},
  async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Call check_engine. If it is online, reply with ONE line: the engine URL, ffmpeg/yt-dlp status, and the Studio link. Do not restate the tool output.",
        },
      },
    ],
  }),
);

server.prompt(
  "make-viral-clip",
  "Find one viral video for a topic and produce a finished, captioned, moving clip.",
  {
    topic: z.string().describe("Topic to search, e.g. \"viral cat shorts\""),
    template: z
      .enum(["shorts-hook", "reels-clean", "tiktok-karaoke", "podcast-clip", "cinematic", "square-proof", "raw"])
      .optional()
      .describe("Edit style (default shorts-hook)"),
    caption_text: z.string().optional().describe("Optional caption lines, one per line"),
  },
  async ({ topic, template, caption_text }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Call crew_video with theme="${topic}"${template ? `, template="${template}"` : ""}${
              caption_text ? `, captionScript=${JSON.stringify(caption_text)}` : ""
            }.`,
            "Reply with at most 6 short lines: title, duration, resolution, file path, hashtags, and whether QC passed. Never paste the whole agent log.",
          ].join("\n"),
        },
      },
    ],
  }),
);

server.prompt(
  "clip-this-link",
  "Clip a specific link (or a live stream) with one line of input.",
  {
    link: z.string().describe("Video or live stream URL"),
    start: z.string().optional().describe("In-point, e.g. 0:42"),
    end: z.string().optional().describe("Out-point, e.g. 1:10"),
    template: z
      .enum(["shorts-hook", "reels-clean", "tiktok-karaoke", "podcast-clip", "cinematic", "square-proof", "raw"])
      .optional(),
  },
  async ({ link, start, end, template }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Use ClipForge. First call probe_video url="${link}".`,
            "If it is LIVE, call record_live with durationSec=60, then clip the returned file.",
            `Otherwise call clip_video with source="${link}"${start ? `, start="${start}"` : ""}${end ? `, end="${end}"` : ""}${
              template ? `, template="${template}"` : ', template="shorts-hook"'
            }.`,
            "Reply in 4 lines max: file path, duration, resolution, QC status. No explanation of ffmpeg.",
          ].join("\n"),
        },
      },
    ],
  }),
);

server.prompt(
  "crew-roster",
  "Show the 10 agents and what each one does (for the user's report or a quick sanity check).",
  {},
  async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            "List the ClipForge crew in a compact table: number, agent name, one-line job. " +
            "Use this roster:\n" +
            AGENTS.map((a) => `${a.n}. ${a.name} — ${a.role}`).join("\n"),
        },
      },
    ],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout carries the JSON-RPC stream.
  console.error(`[clipforge] MCP server connected — engine ${engine.baseUrl}`);
}

main().catch((err) => {
  console.error(`[clipforge] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

export { EngineError };
