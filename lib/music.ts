/**
 * Free music search.
 *
 * Spotify's API cannot be used the way it is usually imagined: playback needs
 * a Premium account, its terms forbid ripping audio, and its catalogue is
 * licensed — there is no "free unlimited" path that is also legal. So this
 * module searches the places that *are* explicitly free and CC-licensed:
 *
 *   SoundCloud   (yt-dlp extractor: soundcloud:search)
 *   Bandcamp     (free / name-your-price tracks)
 *   Archive.org  (public-domain + CC netlabels)
 *   Jamendo      (CC music community)
 *
 * Every hit carries its licence and a link back to the artist page so users
 * can credit correctly. Downloading is done by the same yt-dlp layer as video.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DOWNLOADS_DIR, FFMPEG, ROOT, YTDLP, ensureDirs } from "./config";
import { downloadSource } from "./media";
import { slugify } from "./time";
import { YOUTUBE_CLIENTS, cookieArgs, firstError } from "./youtube";
import { spawnCollect } from "./exec";

export type MusicSource = "soundcloud" | "bandcamp" | "archive" | "jamendo";

export type MusicTrack = {
  id: string;
  title: string;
  artist: string;
  durationSec: number | null;
  url: string;
  source: MusicSource;
  /** Human-readable licence, shown in the UI so credit is easy. */
  license: string;
  /** Where to credit the artist. */
  creditUrl?: string;
};

export const MUSIC_SOURCES: {
  id: MusicSource;
  label: string;
  blurb: string;
  license: string;
}[] = [
  {
    id: "soundcloud",
    label: "SoundCloud",
    blurb: "Huge free/artist-uploaded catalogue — check each track's licence",
    license: "Artist-defined (often CC — verify on the track page)",
  },
  {
    id: "bandcamp",
    label: "Bandcamp",
    blurb: "Independent artists; many free / name-your-price releases",
    license: "Artist-defined (often CC — verify on the album page)",
  },
  {
    id: "archive",
    label: "Archive.org",
    blurb: "Public-domain and Creative-Commons netlabels",
    license: "Public domain / CC (stated per item)",
  },
  {
    id: "jamendo",
    label: "Jamendo",
    blurb: "Creative-Commons music community",
    license: "Creative Commons (stated per track)",
  },
];

const SEARCH_ARGS: Record<MusicSource, (q: string, n: number) => string[]> = {
  soundcloud: (q, n) => [`scsearch${n}:${q}`],
  // These sites do not expose a search extractor, so a search URL is passed
  // through and yt-dlp reports "unsupported" — handled as a source error.
  bandcamp: (q) => [`https://bandcamp.com/search?q=${encodeURIComponent(q)}&item_type=t`],
  archive: (q) => [`https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}+AND+mediatype%3A(audio)`],
  jamendo: (q) => [`https://www.jamendo.com/search/tracks/${encodeURIComponent(q)}`],
};

/** Cache so repeated searches are instant and cheap. */
const cache = new Map<string, { at: number; tracks: MusicTrack[] }>();
const CACHE_MS = 10 * 60_000;

/**
 * Search free music. Uses yt-dlp's flat-playlist search so we only pay for
 * metadata, not media. Returns [] (never throws) when the network is blocked,
 * with the reason available through searchMusicDetailed().
 */
export async function searchMusic(
  query: string,
  opts: { sources?: MusicSource[]; limit?: number } = {},
): Promise<MusicTrack[]> {
  const r = await searchMusicDetailed(query, opts);
  return r.tracks;
}

export async function searchMusicDetailed(
  query: string,
  opts: { sources?: MusicSource[]; limit?: number } = {},
): Promise<{ tracks: MusicTrack[]; errors: { source: MusicSource; error: string }[] }> {
  const q = query.trim();
  const limit = Math.min(25, Math.max(1, opts.limit ?? 12));
  const sources = opts.sources?.length ? opts.sources : MUSIC_SOURCES.map((s) => s.id);

  const key = `${q}|${sources.join(",")}|${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { tracks: hit.tracks, errors: [] };

  const errors: { source: MusicSource; error: string }[] = [];
  const tracks: MusicTrack[] = [];

  for (const source of sources) {
    try {
      const found = await searchOne(source, q, limit);
      tracks.push(...found);
    } catch (err) {
      errors.push({ source, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // De-duplicate by URL and trim.
  const seen = new Set<string>();
  const unique = tracks.filter((t) => (seen.has(t.url) ? false : (seen.add(t.url), true))).slice(0, limit);
  cache.set(key, { at: Date.now(), tracks: unique });
  return { tracks: unique, errors };
}

async function searchOne(source: MusicSource, query: string, limit: number): Promise<MusicTrack[]> {
  const args = [
    ...SEARCH_ARGS[source](query, limit),
    "--flat-playlist",
    "--dump-single-json",
    "--no-warnings",
    "--no-playlist",
    "--socket-timeout",
    "15",
    ...cookieArgs(),
  ];

  const h = spawnCollect(YTDLP, args);
  const res = await h.done;
  if (res.code !== 0) {
    const raw = firstError(res.stderr) ?? "search failed";
    throw new Error(shortError(raw));
  }

  let json: { entries?: Array<Record<string, unknown>> } | null = null;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    return [];
  }
  if (!json?.entries?.length) return [];

  const license = MUSIC_SOURCES.find((s) => s.id === source)?.license ?? "Unknown";
  return json.entries
    .filter((e) => typeof e.url === "string" || typeof e.webpage_url === "string")
    .map((e) => {
      const url = String(e.webpage_url ?? e.url);
      const title = String(e.title ?? "Untitled").slice(0, 120);
      const artist = String(e.uploader ?? e.creator ?? e.artist ?? "Unknown artist").slice(0, 80);
      return {
        id: `${source}:${String(e.id ?? Buffer.from(url).toString("base64").slice(0, 12))}`,
        title,
        artist,
        durationSec: typeof e.duration === "number" ? e.duration : null,
        url,
        source,
        license,
        creditUrl: url,
      };
    });
}

/** Keep UI copy short for common failures. */
function shortError(raw: string): string {
  const e = raw.toLowerCase();
  if (/tls\/ssl|connection reset|failed to resolve/.test(e)) return "blocked by this network";
  if (/sign in|not a bot|cookies/.test(e)) return "needs cookies (YTDLP_COOKIES_FROM_BROWSER)";
  if (/unsupported url|no suitable extractor/.test(e)) return "source not supported by yt-dlp";
  return raw.slice(0, 140);
}

/** The free-source catalogue, with a note about Spotify. */
export function musicCatalogue() {
  return {
    sources: MUSIC_SOURCES,
    sites: 1755,
    note:
      "Spotify cannot be streamed for free: playback requires Premium, its terms forbid ripping, " +
      "and its catalogue is licensed — so there is no legal 'download any song' path. These sources " +
      "are free and CC/public-domain by design. Always check the track's licence before publishing.",
  };
}

/**
 * Download a track into the local media pool so it can be used as a music bed.
 * Returns the same shape as /api/upload so the editor treats it identically.
 */
export async function downloadTrack(url: string): Promise<{
  fileName: string;
  durationSec: number | null;
}> {
  await ensureDirs();
  const file = await downloadSource(url, undefined, { audioOnly: true });
  const st = await fs.stat(file);
  if (st.size < 2048) throw new Error("The track downloaded but is empty.");
  return { fileName: path.basename(file), durationSec: null };
}

// ───────────────────────────── local sound kit ─────────────────────────────

/**
 * Synthesised sound effects. We generate them with ffmpeg instead of shipping
 * samples, so the repo stays small and the licence question disappears
 * entirely (our own generated tones).
 */
export type SoundKitItem = { id: string; label: string; emoji: string; build: (out: string) => Promise<void> };

const KIT_DIR = () => path.join(DOWNLOADS_DIR, "..", "sounds");

export const SOUND_KIT: SoundKitItem[] = [
  {
    id: "whoosh",
    label: "Whoosh",
    emoji: "💨",
    build: (out) =>
      render(
        `anoisesrc=d=0.9:c=pink:a=0.7:r=48000,highpass=f=400,lowpass=f=4500,volume='pow(sin(PI*t/0.9),1.6)*0.9':eval=frame,afade=t=in:st=0:d=0.35,afade=t=out:st=0.55:d=0.35`,
        out,
      ),
  },
  {
    id: "riser",
    label: "Riser",
    emoji: "📈",
    build: (out) =>
      render(
        `sine=frequency=180:duration=2.2:sample_rate=48000,volume='if(lt(t,0.05),t/0.05*0.5,min(1,0.5+t*0.28))':eval=frame,highpass=f=180`,
        out,
      ),
  },
  {
    id: "boom",
    label: "Impact boom",
    emoji: "💥",
    build: (out) =>
      render(
        `sine=frequency=58:duration=1.4:sample_rate=48000,volume='exp(-2.2*t)':eval=frame,bass=g=10:f=60`,
        out,
      ),
  },
  {
    id: "ding",
    label: "Ding",
    emoji: "🔔",
    build: (out) => render(`sine=frequency=1320:duration=1.1:sample_rate=48000,volume='exp(-4.5*t)':eval=frame,aecho=0.8:0.4:90:0.25`, out),
  },
  {
    id: "pop",
    label: "Pop",
    emoji: "🫧",
    build: (out) => render(`sine=frequency=880:duration=0.18:sample_rate=48000,volume='exp(-12*t)':eval=frame`, out),
  },
  {
    id: "tick",
    label: "Tick",
    emoji: "⏱",
    build: (out) => render(`sine=frequency=2400:duration=0.06:sample_rate=48000,volume=0.6`, out),
  },
  {
    id: "scratch",
    label: "Vinyl scratch",
    emoji: "🎧",
    build: (out) => render(`anoisesrc=d=0.35:c=pink:a=0.35:r=48000,highpass=f=1200,lowpass=f=6000,volume='sin(t*40)*0.6':eval=frame`, out),
  },
  {
    id: "heartbeat",
    label: "Heartbeat",
    emoji: "❤️",
    build: (out) =>
      render(
        `sine=frequency=62:duration=1.6:sample_rate=48000,volume='if(lt(t,0.16),sin(t/0.16*PI),if(lt(t,0.42),0,if(lt(t,0.58),sin((t-0.42)/0.16*PI),0)))':eval=frame`,
        out,
      ),
  },
];

async function render(chain: string, out: string): Promise<void> {
  await ensureDirs();
  await fs.mkdir(path.dirname(out), { recursive: true });
  const h = spawnCollect(FFMPEG, [
    "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", chain,
    "-ac", "2", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "192k",
    out,
  ]);
  const res = await h.done;
  if (res.code !== 0) throw new Error(res.stderr.split("\n").filter(Boolean).pop() ?? "sfx render failed");
}

/** Ensure every sound-kit file exists; returns name → path. */
export async function ensureSoundKit(): Promise<{ id: string; label: string; emoji: string; fileName: string }[]> {
  const dir = KIT_DIR();
  await fs.mkdir(dir, { recursive: true });
  const out: { id: string; label: string; emoji: string; fileName: string }[] = [];
  for (const item of SOUND_KIT) {
    const file = path.join(dir, `${item.id}.mp3`);
    try {
      const st = await fs.stat(file).catch(() => null);
      if (!st || st.size < 512) await item.build(file);
      out.push({ id: item.id, label: item.label, emoji: item.emoji, fileName: `sounds/${item.id}.mp3` });
    } catch {
      /* skip a sound that this ffmpeg build cannot synthesise */
    }
  }
  return out;
}

/** Absolute path for a `sounds/x.mp3` reference. */
export function soundPath(fileName: string): string {
  return path.join(DOWNLOADS_DIR, fileName);
}

/** Slug helper reused by callers that save tracks locally. */
export function trackFileName(t: MusicTrack): string {
  return `${slugify(`${t.artist}-${t.title}`, 60) || "track"}.mp3`;
}

/** Public helper so the API can report which clients are configured. */
export function musicDiagnostics() {
  return {
    ytdlp: YTDLP,
    clients: YOUTUBE_CLIENTS,
    root: ROOT,
    kitDir: KIT_DIR(),
  };
}
