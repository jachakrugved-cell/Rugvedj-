# ✂ ClipForge

![ClipForge](public/og.png)

**A free, fully local video clipper — paste any link, cut any moment, keep the clip.**
No accounts, no credits, no watermarks, no uploads. Just ffmpeg on your machine,
plus an **MCP server so Claude Code can clip for you**.

```
                 ┌──────────── CREW · 10 agents ────────────┐
any link  ──▶    │ scout → rank → edit → cut → caption →    │  ──▶  MP4 + captions
(live too)       │ motion → audio → thumb → SEO → QC        │       + hashtags + QC
                 └──────────────────────────────────────────┘
```

**→ [Service report](docs/report.html)** (colourful, printable, with real output images) ·
**→ [Paste-into-Claude prompt](CLAUDE-PROMPT.md)** · live at `http://127.0.0.1:3000/report`

---

## Quick start

```bash
git clone <this repo> clipforge && cd clipforge
npm install
npm run setup      # downloads portable ffmpeg + yt-dlp into .tools/ (no sudo)
npm run dev        # → http://127.0.0.1:3000
```

Then either paste a link in **Studio** and drag the handles, or open **Crew**, type a topic
(*"viral cat shorts"*), and let the 10 agents deliver a finished clip.

**Connect Claude Code** (one command, from the repo root):

```bash
claude mcp add clipforge -- npx -y tsx mcp/server.ts
```

Start `claude`, say **“connect to ClipForge and clip 0:12–0:48 of <link> as a 9:16 clip”**.
That's it — no API keys, no cloud.

> `npm run smoke` runs a real end-to-end test (probe → clip → live record) and
> `npm run doctor` prints exactly what your machine supports.

---

## What it does

| | |
| --- | --- |
| **Any link** | YouTube, Vimeo, Twitch, Kick, Facebook, X… pages via yt-dlp; direct `.mp4/.webm/.mov`; HLS `.m3u8`; DASH `.mpd`; existing library clips |
| **Live streams** | Detects live HLS/DASH and page lives, previews them through a local proxy, records N seconds from the live edge, then clips the buffer |
| **Any moment** | Scrub timeline with dual in/out handles, timecode inputs (`90`, `1:30`, `01:02:03`), quick actions, preview frames |
| **Social formats** | 9:16, 1:1, 4:5, 16:9, 4:3 — smart center-crop to fill, 1080-class output |
| **Captions** | Burned in with libass: 6 styles (clean, bold, karaoke, highlight, neon, minimal). Paste SRT/VTT for exact sync, or plain text and ClipForge times it for you |
| **10-agent crew** | Talent Scout → Analyst → Editor → Clip Smith → Captioner → Motion Artist → Sound Tech → Thumbnailist → SEO Writer → QC Lead — all in one call |
| **Motion** | 8 camera presets (zoom in/out, pan, shake, pulse, whip) + a light cinematic grade |
| **Templates** | `shorts-hook`, `tiktok-karaoke`, `reels-clean`, `podcast-clip`, `cinematic`, `square-proof`, `raw` — one word sets aspect + motion + caption style |
| **Editor (CapCut-class)** | Multi-track timeline: up to 40 cuts, trim, split, reorder, 0.25–4× speed, reverse, zoom, 16 looks, 9 transitions, animated titles, sticker overlays, music beds with auto-ducking |
| **Fast** | Stream-copy cuts when possible (keyframe-aware), full re-encode only when cropping or adding captions |
| **Local & free** | Everything lands in `.data/`; nothing leaves your machine. MIT licensed |

---

## The Editor (CapCut-class)

The **Editor** tab is a real multi-track timeline, not a caption form. Everything
you see compiles into a single JSON project and renders in one ffmpeg pass.

| Track | What you can do |
| --- | --- |
| **Video** | Add any number of cuts from the library or your own uploads · trim in/out to 0.1 s · split at the playhead · drag-free reorder (double-click a block) · 0.25×–4× speed · reverse · 1–3× push-in zoom · mute or re-mix each clip |
| **Looks** | 16 one-click grades: original, warm film, cool teal, cinematic, vintage, black & white, sepia, vivid pop, soft pastel, dream glow, noir, neon night, sunset, matrix, crisp HD, faded matte |
| **Transitions** | **58** — every xfade this ffmpeg supports: fades, wipes, slides, covers, reveals, shape opens, glitch slices, pixelate, zoom. Each with a 0.1–2 s duration |
| **Video FX** | 15 stackable effects — VHS, glitch, old film, grain, pixelate, bloom, chroma, blur, sharpen, vignette, mirror |
| **Sound** | 17 audio presets — podcast voice, bass boost, concert hall, lo-fi, radio, telephone, 8D swirl, cinematic, vinyl, vocal-reduce, slowed+reverb — plus a −12…+12 semitone pitch shift |
| **Motion** | The same 8 camera presets as the Studio (zoom, pan, shake, pulse, whip), per clip |
| **Text** | Free text anywhere: 7 anchors or exact x/y · 5 animations (fade, slide-up, pop, typewriter, none) · box, shadow, italic, uppercase, any colour, auto multi-line wrap |
| **Stickers** | PNG/JPG overlays with size, rotation, opacity and fade in/out. Five built-in: `star`, `heart`, `sparkle`, `fire`, `check` |
| **Audio** | Per-clip volume, plus unlimited music/voiceover beds with in/out, loop, fades and **auto-ducking** (sidechain-compressed under dialogue) |
| **Export** | One H.264 MP4, faststart, saved to the library with a poster frame |

### One-tap recipes

Eight presets that patch the selected clip in one click — Viral hook, Cinematic
open, Podcast clip, Retro VHS, Aesthetic B&W, Neon night, Tutorial, Face zoom.

### Render a timeline from the CLI

```bash
curl -s localhost:3000/api/studio -H 'content-type: application/json' -d '{
  "title": "My edit",
  "aspect": "9:16",
  "clips": [
    {"source": "https://youtu.be/VIDEO", "start": 12, "end": 20, "look": "vivid", "motion": "zoom-in", "transition": "dissolve"},
    {"source": "https://youtu.be/VIDEO", "start": 40, "end": 46, "look": "cinematic", "speed": 1.5, "transition": "wipeleft"},
    {"source": "/api/media/my-clip.mp4", "start": 0, "end": 5, "look": "noir"}
  ],
  "texts": [
    {"text": "WATCH THIS", "at": 0.3, "duration": 2.5, "position": "top", "animation": "pop", "box": true},
    {"text": "then this", "at": 9, "duration": 3, "position": "center", "animation": "slide-up", "color": "#4dd4ff"}
  ],
  "overlays": [{"source": "/emoji/star.png", "at": 1, "duration": 3, "x": 0.8, "y": 0.18, "width": 0.18, "rotate": 15, "fade": 0.3}],
  "audios": [{"source": "/api/media/music.mp3", "at": 0, "volume": 0.25, "loop": true, "duckToClips": true}]
}'
```

Claude can do the same thing with one tool call: `edit_video`.

---

## Connect Claude Code

### 1. Register the MCP server

The repo already contains `.mcp.json`, so a Claude Code session started in this
directory offers the `clipforge` server automatically. Prefer the CLI?

```bash
claude mcp add clipforge -- npx -y tsx mcp/server.ts
```

<details>
<summary>Or paste this into your MCP config</summary>

```json
{
  "mcpServers": {
    "clipforge": {
      "command": "npx",
      "args": ["-y", "tsx", "mcp/server.ts"],
      "cwd": "/absolute/path/to/this/repo",
      "env": {
        "CLIPFORGE_ENGINE_URL": "http://127.0.0.1:3000",
        "CLIPFORGE_AUTOSTART": "1"
      }
    }
  }
}
```
</details>

The MCP server is a thin client over the same local engine the Studio uses.
If the engine isn't running, it starts it for you (`CLIPFORGE_AUTOSTART=1`).

### 2. Tools Claude gets

| Tool | What it does |
| --- | --- |
| `check_engine` | Ping the engine; report ffmpeg / ffprobe / yt-dlp health |
| `probe_video` | Any link → title, duration, resolution, fps, **is-live**, playable? |
| `clip_video` | Cut a clip by link or clip id; aspect, captions, styles |
| `record_live` | Record N seconds of a live stream to a local MP4 |
| `crew_video` | **Runs all 10 agents in one call** — search → rank → cut → caption → motion → audio → thumb → SEO → QC |
| `edit_video` | **CapCut-class multi-clip edit in one call** — trim, speed, looks, transitions, titles, stickers, music → one MP4 |
| `youtube_status` | Is YouTube actually reachable, and which cookie/client fix is active? |
| `find_music` | Search free/CC music on 4 catalogues, download a bed straight into the media pool |
| `editor_kit` | List all 58 transitions, 16 looks, 17 sound presets, 15 FX, recipes |
| `list_clips` | Browse the library |
| `get_clip` | Full metadata + absolute path |
| `delete_clip` | Delete file + index entry |

### 2b. Saved prompts (low-token shortcuts)

| Prompt | Arguments | What it does |
| --- | --- | --- |
| `connect-clipforge` | — | Verifies the engine and reports in one line |
| `make-viral-clip` | `topic`, `template?`, `caption_text?` | One call to `crew_video`, 6-line reply |
| `clip-this-link` | `link`, `start?`, `end?`, `template?` | Probe → (record if live) → clip |
| `crew-roster` | — | Compact table of the 10 agents |

They keep the conversation short: the engine expands the plan, so Claude never re-derives it.

### 3. Things to say

```
Connect to ClipForge and check the engine.
Clip https://youtu.be/dQw4w9WgXcQ from 0:42 to 1:10 as a 9:16 clip with bold captions:
"Never gonna give you up / Never gonna let you down"

This stream is live — https://example.com/live.m3u8 — record 60 seconds,
then cut the most interesting 15 seconds as a square clip.

Find a viral clip about gym transformations and edit it for TikTok.

List my clips, and delete anything older than a week.
```

`CLAUDE.md` in this repo tells Claude exactly how to use the tools, so a fresh
session needs no extra coaching.

---

## Live video

```
Live tab ──▶ paste .m3u8 / .mpd / Twitch / YouTube-live link
         ──▶ preview plays through /api/media-proxy (rewrites playlists + segments)
         ──▶ “Record 60s” → ffmpeg captures the live edge → .data/live/*.mp4
         ──▶ Studio ▸ load the recording ▸ cut the moment
```

Everything is streamed through the local server, so it works even when the CDN
blocks the browser (CORS, signed URLs, Referer checks).

**Try it without any external service:**

```bash
npm run demo:live        # serves a rolling HLS stream on :8080
# paste  http://127.0.0.1:8080/live.m3u8  into the Live tab
```

---

## HTTP API

The UI and the MCP server both use these endpoints, so you can script ClipForge
with `curl`, Python, or anything else.

```bash
# inspect any link
curl -s localhost:3000/api/probe -H 'content-type: application/json' \
  -d '{"url":"https://youtu.be/VIDEO"}'

# cut a clip (blocks until the MP4 exists)
curl -s localhost:3000/api/clips -H 'content-type: application/json' \
  -d '{"source":"https://youtu.be/VIDEO","start":"0:12","end":"0:48",
       "aspect":"9:16","captions":"first line\nsecond line","captionStyle":"bold"}'

# record 60s of a live stream
curl -s localhost:3000/api/live -H 'content-type: application/json' \
  -d '{"url":"https://example.com/live.m3u8","durationSec":60}'

# find + edit in one call (10 agents)
curl -s localhost:3000/api/crew -H 'content-type: application/json' \
  -d '{"theme":"viral cat shorts","template":"shorts-hook","platform":"tiktok"}'

# library
curl -s localhost:3000/api/clips

# live progress feed (Server-Sent Events)
curl -N localhost:3000/api/tasks?stream=1
```

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Binaries, data dir, capabilities |
| `GET` | `/api/crew` | Roster of the 10 agents + templates + motion presets |
| `POST` | `/api/crew` | Run the whole pipeline — find, edit, caption, SEO, QC |
| `POST` | `/api/probe` | Resolve any link |
| `POST` | `/api/clips` | Create a clip |
| `GET` | `/api/clips` | List library |
| `GET`/`DELETE` | `/api/clips/:id` | Read / delete one clip |
| `GET` | `/api/clips/:id/file` | Stream MP4 (Range support, `?download=1`) |
| `GET` | `/api/live?url=` | Is it live? playable URL |
| `POST` | `/api/live` | Record N seconds |
| `GET` | `/api/tasks?stream=1` | SSE task progress |
| `GET` | `/api/frame?url=&t=` | Preview frame JPEG |
| `GET` | `/api/media-proxy?u=` | CORS/Range-safe media + HLS proxy |
| `GET` | `/api/media/:name` | Serve clips / recordings |
| `GET` | `/api/studio` | Editor palette: 16 looks, 9 transitions, 8 recipes, capability list |
| `POST` | `/api/studio` | **Render a multi-track project** (clips + texts + overlays + audio) |
| `POST` | `/api/upload` | Drop a local video/audio/image into the media pool (2 GB) |
| `GET` | `/api/youtube` | YouTube reachability + cookie config + client ladder |
| `GET` | `/api/music` | Free-music sources, licences, generated sound kit |
| `POST` | `/api/music` | `{action:"search"}` or `{action:"download"}` |

---

## How it works

```
                 ┌─────────────── Studio (Next.js, client) ───────────────┐
 paste link ──▶  │ probe → HLS.js preview → timeline → caption editor     │
                 └───────────────┬───────────────────────────────────────┘
                                 │ JSON / SSE
                 ┌───────────────▼──────────── lib/ (engine, Node) ───────┐
                 │ media.ts    resolve: yt-dlp | ffprobe | ffmpeg        │
                 │ clipper.ts  cut: copy | x264 + libass, crop, remux    │
                 │ tasks.ts    progress events (SSE)                     │
                 └───────────────┬───────────────────────────────────────┘
                                 │
                     ffmpeg/ffprobe/yt-dlp (portable, in .tools/)
                                 │
                       .data/{clips,downloads,live}
```

- **Cuts** are stream-copied when the in-point sits on a keyframe; otherwise the
  stream is re-encoded at `crf 20 / veryfast`. Cropping and captions always re-encode.
- **Remote links** are either downloaded once (best for repeats) or seeked
  directly by ffmpeg, so you can clip a 2-hour video without waiting for a full download.
- **Live** uses the HLS demuxer with a rolling manifest and a `-t` cap; the
  fragmented output is remuxed to a seekable MP4.

---

## Privacy & limits

- **Nothing uploads.** Clips, downloads and recordings are files in `.data/`.
- **No DRM.** ClipForge cannot (and won't try to) bypass protected streams.
- **Be a good citizen.** Only clip content you have the rights to; respect the
  terms of the sites you use.
- Public sources only for the proxy (SSRF guard). Set `CLIPFORGE_ALLOW_PRIVATE=1`
  to clip LAN devices such as IP cameras.

## Configuration

Copy `.env.example` to `.env` if you need overrides.

| Variable | Default | Meaning |
| --- | --- | --- |
| `FFMPEG_BIN` / `FFPROBE_BIN` / `YTDLP_BIN` | auto | Explicit binary paths |
| `CLIPFORGE_DATA` | `.data` | Where clips are stored |
| `FFMPEG_FONT` | auto-detected | TrueType font for captions |
| `CLIPFORGE_LIVE_MAX_SEC` | `7200` | Max live recording length |
| `CLIPFORGE_ENGINE_URL` | `http://127.0.0.1:3000` | Engine the MCP server talks to |
| `CLIPFORGE_AUTOSTART` | `1` | Let the MCP server start the engine |
| `YTDLP_COOKIES_FROM_BROWSER` | — | `chrome` / `firefox` / `edge` / `safari` — fixes "confirm you're not a bot" |
| `YTDLP_COOKIES_FILE` | `.data/cookies.txt` | Explicit Netscape cookie jar |
| `CLIPFORGE_DEBUG_FILTER` | — | Write the last ffmpeg filter graph to `.data/work/last-filter.txt` |

## Project layout

```
app/            Studio page + HTTP API route handlers
components/     Player (HLS.js), timeline, clip cards, views
lib/            Engine: resolution, cutting, captions, tasks, library
mcp/server.ts   MCP server (stdio) — the Claude Code connector
scripts/        setup.sh · doctor.ts · smoke.mjs · demo-live.mjs
public/demo/    30-second demo video for the built-in sample link
```

## Free music, and the truth about Spotify

The editor needs music, so ClipForge searches catalogues that are **free by
design** — SoundCloud, Bandcamp, Archive.org and Jamendo — through the same
yt-dlp layer it uses for video (1755 supported sites). Every result shows its
source and licence, and links back to the artist so credit is easy.

```bash
# search
curl -s localhost:3000/api/music -H 'content-type: application/json' \
  -d '{"action":"search","query":"lofi study","limit":12}'

# download one into the media pool, then use it as a music bed
curl -s localhost:3000/api/music -H 'content-type: application/json' \
  -d '{"action":"download","url":"https://soundcloud.com/artist/track"}'
```

### Why Spotify is not in that list

Spotify cannot be a free music source, and no amount of engineering changes that:

- **playback requires a Premium account** — the Web API only returns 30-second previews, and only for some tracks;
- **its terms forbid downloading or ripping audio** — a tool that did so would be a DRM/copyright problem, not a feature;
- **its catalogue is licensed**, not Creative Commons, so "free unlimited" has no legal meaning there.

If you have Spotify Premium, the honest workflow is to play the track in the
Spotify app and record it *for your own private use* — but ClipForge will not
build a ripper. The four sources above cover the same need legally.

### The built-in sound kit (no download, no licence)

Eight sound effects are **synthesised by ffmpeg** on first use — whoosh, riser,
impact boom, ding, pop, tick, vinyl scratch, heartbeat. They live in
`.data/sounds/`, cost nothing, and are yours to use because they are generated
tones rather than samples. A smoke check verifies each one is actually audible
(no −91 dB "silent" effects).

---

## YouTube: why it breaks, and what actually fixes it

Read this before blaming the app. YouTube failures are **three different bugs**
with three different fixes, and ClipForge now distinguishes them for you.

```bash
curl -s localhost:3000/api/youtube
```

The Studio tab shows the same thing as a banner, and Claude can check it with
`youtube_status`.

| Symptom | What is really happening | The fix that works |
| --- | --- | --- |
| `TLS/SSL connection has been closed (EOF)`, `Connection reset`, `Failed to resolve` | **The network blocks YouTube.** DNS resolves, every HTTPS packet to `youtube.com` / `*.googlevideo.com` / `youtubei.googleapis.com` is dropped. Common in offices, schools, CI and some sandboxes. | Nothing in the app can fix this. Run ClipForge on a normal connection or ask the admin to allow those three hosts. Everything else (direct MP4, HLS, uploads) keeps working. |
| `Sign in to confirm you're not a bot`, `cookies`, `login required` | **YouTube wants a session.** Datacenter/VPN IPs and cookie-less clients get challenged. | Pass cookies: `YTDLP_COOKIES_FROM_BROWSER=chrome` (or `firefox`, `edge`, `safari`), or export a Netscape `cookies.txt` to `.data/cookies.txt`. Use a throwaway Google account. ClipForge then retries with that jar automatically. |
| `HTTP 403 Forbidden` on `googlevideo.com` | The media URL is **IP-locked or expired** — very common behind VPNs. | Re-run the clip (URLs are re-resolved), turn the VPN off, or add cookies. |

### What ClipForge already does for you

Because YouTube's player shifts constantly, `lib/youtube.ts` does not trust a
single code path:

- retries across **8 player clients** — `default`, `web_safari`, `web_embedded`, `android_vr`, `tv`, `ios`, `web`, `mweb` — and stops early on permanent failures (private/removed) so you never wait for a pointless ladder;
- passes a cookie file (`.data/cookies.txt`) or your browser's jar automatically when configured;
- adds `--retries 5 --fragment-retries 10 --retry-sleep exp=1:8 --socket-timeout 20` so a flaky connection retries instead of dying;
- translates the final error into **one actionable sentence** instead of a stack trace;
- exposes the diagnosis at `GET /api/youtube` so you can see it before you paste a link.

### About "bypassing the YouTube bot"

Worth being straight with you: there is no honest switch that tells YouTube
"this is not a bot" when it has decided otherwise. What actually works is
**looking like a normal viewer** — a real session (cookies), a current yt-dlp
(`yt-dlp -U`, YouTube ships breaking changes weekly), and the client variants
that are not being challenged today. That is exactly what this layer
implements, automatically. The failure modes it cannot beat are a firewall that
drops the connection, a removed/private video, and a network-level block. In
those cases ClipForge tells you which one it is and keeps the rest of the app
usable.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `yt-dlp is not installed` | `npm run setup` (or `pipx install yt-dlp`), then restart |
| Page link fails with “Sign in to confirm…” | yt-dlp is out of date: `yt-dlp -U` (or re-run setup) |
| Preview is black but the clip works | Stream blocks browsers; you can still cut it (in/out inputs) |
| Captions missing | No TrueType font found — install `fonts-dejavu` or set `FFMPEG_FONT` |
| `Port 3000 is in use` | `PORT=3010 npm run dev` and set `CLIPFORGE_ENGINE_URL` for MCP |
| Claude can't see the tools | Run `claude mcp list`; the `cwd` in your config must be this repo |

## License

MIT — do what you want; attribution appreciated.
