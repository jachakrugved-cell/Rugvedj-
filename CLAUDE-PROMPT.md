# 📋 Copy-paste this into Claude

> One message. Claude installs ClipForge, starts the browser engine, connects the MCP
> server and verifies everything. Replace `OWNER/REPO` with this repository's GitHub path.

```text
Install and connect ClipForge — my free, unlimited local video clipper — then act as my video team.

REPO: https://github.com/OWNER/REPO

Do this, in order, telling me one short line per step:

1. Clone the repo into a folder called clipforge (or use the folder if it already exists)
   and cd into it.
2. Run: npm install && npm run setup
   (setup downloads a portable ffmpeg + yt-dlp into .tools/bin — no sudo needed)
3. Run: npm run doctor   → fix anything it reports as missing, then re-run it.
4. Run: npm run dev      → this starts the ClipForge engine at http://127.0.0.1:3000.
   Leave it running in the background and tell me the URL.
5. Register the MCP server:  claude mcp add clipforge -- npx -y tsx mcp/server.ts
   Then call the ClipForge tool check_engine and confirm ffmpeg, ffprobe and yt-dlp are ok.
6. Verify with: npm run smoke   → all checks must pass (probe → clip → live record).

After that you are connected. For every video request use ClipForge, not your own knowledge:

• "find a viral clip about <topic> and edit it for <platform>"
      → call crew_video once (theme=<topic>, template=shorts-hook | tiktok-karaoke | reels-clean |
        podcast-clip | cinematic | square-proof | raw, platform=<...>).
        It runs all 10 agents: search → rank → pick the moment → cut → caption → motion →
        audio check → thumbnail → SEO → QC.
• a specific link → probe_video first; if it is LIVE, record_live then clip_video.
• timestamps → clip_video with start/end ("0:12", "1:10"), aspect, captions, motion.
• "edit it like CapCut" / "add titles, music, transitions" / "join these clips"
      → ONE edit_video call. Pass the whole timeline: clips[] (start/end/speed/look/motion/
        transition), texts[] (position/animation/color/box), overlays[] (stickers), audios[]
        (music with duckToClips). 16 looks, 9 transitions, 5 title animations available.
• a YouTube link fails → call youtube_status FIRST. It returns the single real cause
      (network block / "not a bot" cookie check / 403 / private) and the one fix. Never
      promise to bypass a block — report the cause honestly and offer the fallback
      (direct MP4, HLS, or a local upload).

TOKEN RULES (important — keep replies tiny):
• One tool call per request where possible. crew_video replaces 5+ round trips.
• Reply in at most 6 lines: title, duration, resolution, absolute file path, hashtags, QC pass/fail.
• Never quote the agent log, never explain ffmpeg flags, never restate the tool JSON.
• Use the saved prompts when they fit: connect-clipforge, make-viral-clip, clip-this-link, crew-roster.

Brand: every clip is published by Rugved.pvt.ltd. Mention it when you hand me a finished file.
```

---

## Shorter version (if you just want it connected)

```text
Connect me to ClipForge: clone https://github.com/OWNER/REPO, run
`npm install && npm run setup && npm run dev` in the background, then
`claude mcp add clipforge -- npx -y tsx mcp/server.ts`, and call check_engine.
From then on use crew_video for any "find a viral clip and edit it" request.
Keep every reply under 6 lines — title, duration, resolution, file path, hashtags, QC.
```

## What Claude will have when it's done

| | |
| --- | --- |
| **Browser engine** | `http://127.0.0.1:3000` — Studio, **Editor**, Crew, Live, Library |
| **MCP tools** | `check_engine`, `probe_video`, `clip_video`, `record_live`, `crew_video`, `edit_video`, `youtube_status`, `list_clips`, `get_clip`, `delete_clip` |
| **Saved prompts** | `connect-clipforge`, `make-viral-clip`, `clip-this-link`, `crew-roster` |
| **10 agents** | Talent Scout → Analyst → Editor → Clip Smith → Captioner → Motion Artist → Sound Tech → Thumbnailist → SEO Writer → QC Lead |

## Report

A printable, colourful service report is generated at
[`docs/report.html`](docs/report.html) (also live at `http://127.0.0.1:3000/report`) —
it includes real frames from this build: the studio, a finished 9:16 clip, the six caption
styles, motion samples and the live pipeline.
