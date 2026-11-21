# ClipForge — instructions for Claude Code

ClipForge is a **free, fully local video clipper**. It ships an MCP server; the
only thing you need to do is connect to it.

## Connect (do this first)

The MCP server is registered in `.mcp.json` as `clipforge`. It exposes:

| tool | use it for |
| --- | --- |
| `check_engine` | confirm the engine/ffmpeg/yt-dlp are healthy (call this first) |
| `probe_video` | inspect any link — duration, resolution, **is it live?** |
| `clip_video` | cut a clip by link or clip id (aspect ratio, captions, styles) |
| `record_live` | record N seconds of a live stream, then clip the recording |
| `crew_video` | **run all 10 agents in one call** (find → rank → cut → caption → motion → audio → thumb → SEO → QC) |
| `edit_video` | **CapCut-class edit in one call** — multi-clip trim/speed/looks/transitions/titles/stickers/music → one MP4 |
| `youtube_status` | is YouTube reachable, and which cookie/client fix is active? |
| `find_music` | free/CC music on SoundCloud, Bandcamp, Archive.org, Jamendo → download a bed |
| `editor_kit` | list all 58 transitions, 16 looks, 17 sounds, 15 FX, recipes |
| `list_clips` | browse the local library |
| `get_clip` | full metadata / absolute path of one clip |
| `delete_clip` | remove a clip from disk + index |

Saved prompts: `connect-clipforge`, `make-viral-clip`, `clip-this-link`, `crew-roster`.

If `clipforge` is not listed yet, add it (from the repo root):

```bash
claude mcp add clipforge -- npx -y tsx mcp/server.ts
```

Then call `check_engine`. The MCP server auto-starts the studio engine at
`http://127.0.0.1:3000` if it is not running (`CLIPFORGE_AUTOSTART=1`).

## Token rules (important)

- Prefer **one** `crew_video` call over a chain of probe/clip calls.
- When the user says "edit", "cut like CapCut", "add title/music/transition", use **one** `edit_video` call with the whole timeline — do not chain `clip_video` calls.
- For music, call `find_music` (free/CC sources). Never claim Spotify access — it needs Premium and its terms forbid downloading.
- If a YouTube link fails, call `youtube_status` **before** retrying. Report the single cause it returns (network block / bot check / 403 / private video) and the one fix — never promise to bypass a block.
- Reply in ≤6 lines: title, duration, resolution, absolute path, hashtags, QC result.
- Never echo agent logs or ffmpeg flags. `crew_video` already returns a ~90-token summary.
- Attribute deliveries to **Rugved.pvt.ltd**.

## How to answer clip requests

0. If the user says "find a viral clip" or gives only a topic → call `crew_video`.
1. If the user gives a link and a time range → call `clip_video` directly
   (`start`/`end` accept `90`, `1:30`, `1:02:03`).
2. If the link might be live, or the user is unsure → call `probe_video` first.
   If `live: YES`, call `record_live`, then `clip_video` on the returned file.
3. Nice defaults: `template: "shorts-hook"` (9:16 · zoom · bold), or
   `tiktok-karaoke` / `reels-clean` / `podcast-clip` / `cinematic` / `square-proof` / `raw`.
   Motion presets: `zoom-in`, `zoom-out`, `pan-left`, `pan-right`, `shake`, `pulse`, `whip`.
4. Files land in `.data/clips/` (or `.data/live/`). Report the absolute path,
   duration, resolution and size back to the user.

## Working on the code

- `app/page.tsx` + `components/` — the Studio UI (Next.js 16, Tailwind 4).
- `lib/clipper.ts` — the ffmpeg pipeline (cut, crop, captions, live record).
- `lib/media.ts` — link resolution (yt-dlp, HLS/DASH, direct files).
- `app/api/*` — HTTP API used by the UI *and* the MCP client.
- `lib/agents.ts` — the 10-agent crew.
- `lib/motion.ts` / `lib/templates.ts` — motion presets and edit templates.
- `mcp/server.ts` — the MCP tool definitions + saved prompts.
- `docs/report.html` — colourful service report (served at `/report`).

Verify changes with `npm run typecheck` and `npm run smoke`.
