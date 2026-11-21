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
| `list_clips` | browse the local library |
| `get_clip` | full metadata / absolute path of one clip |
| `delete_clip` | remove a clip from disk + index |

If `clipforge` is not listed yet, add it (from the repo root):

```bash
claude mcp add clipforge -- npx -y tsx mcp/server.ts
```

Then call `check_engine`. The MCP server auto-starts the studio engine at
`http://127.0.0.1:3000` if it is not running (`CLIPFORGE_AUTOSTART=1`).

## How to answer clip requests

1. If the user gives a link and a time range → call `clip_video` directly
   (`start`/`end` accept `90`, `1:30`, `1:02:03`).
2. If the link might be live, or the user is unsure → call `probe_video` first.
   If `live: YES`, call `record_live`, then `clip_video` on the returned file.
3. Nice defaults: `aspect: "9:16"` for social, `captionStyle: "bold"` when the
   user provides a transcript. Captions accept pasted SRT/VTT.
4. Files land in `.data/clips/` (or `.data/live/`). Report the absolute path,
   duration, resolution and size back to the user.

## Working on the code

- `app/page.tsx` + `components/` — the Studio UI (Next.js 16, Tailwind 4).
- `lib/clipper.ts` — the ffmpeg pipeline (cut, crop, captions, live record).
- `lib/media.ts` — link resolution (yt-dlp, HLS/DASH, direct files).
- `app/api/*` — HTTP API used by the UI *and* the MCP client.
- `mcp/server.ts` — the MCP tool definitions.

Verify changes with `npm run typecheck` and `npm run smoke`.
