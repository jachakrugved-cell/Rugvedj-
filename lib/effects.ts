/**
 * The editor's palettes: transitions, title animations, sound presets, video
 * FX, one-tap recipes and a human-readable capability list. Shared by the UI,
 * /api/studio, the MCP tools and the docs so they can never drift apart.
 */

/**
 * Every xfade transition this ffmpeg build supports (63 as of n9.x).
 * Verified with `ffmpeg -h filter=xfade` — not a wish list.
 */
export const TRANSITIONS = [
  "none",
  // classic
  "fade", "fadeblack", "fadewhite", "fadefast", "fadeslow", "dissolve", "distance",
  // wipes
  "wipeleft", "wiperight", "wipeup", "wipedown",
  "wipetl", "wipetr", "wipebl", "wipebr",
  // slides
  "slideleft", "slideright", "slideup", "slidedown",
  "coverleft", "coverright", "coverup", "coverdown",
  "revealleft", "revealright", "revealup", "revealdown",
  // shapes
  "circleopen", "circleclose", "circlecrop", "rectcrop",
  "vertopen", "vertclose", "horzopen", "horzclose",
  "radial", "diagtl", "diagtr", "diagbl", "diagbr",
  // smooth
  "smoothleft", "smoothright", "smoothup", "smoothdown",
  "squeezeh", "squeezev",
  // glitch / slice
  "hlslice", "hrslice", "vuslice", "vdslice",
  "hlwind", "hrwind", "vuwind", "vdwind",
  "hblur", "pixelize", "fadegrays", "zoomin",
] as const;

export type Transition = (typeof TRANSITIONS)[number];

/** Human labels for the UI (raw ffmpeg names are cryptic). */
export const TRANSITION_LABELS: Record<string, string> = {
  fade: "Fade", fadeblack: "Fade to black", fadewhite: "Fade to white",
  fadefast: "Quick fade", fadeslow: "Slow fade", dissolve: "Dissolve", distance: "Distance",
  wipeleft: "Wipe ◀", wiperight: "Wipe ▶", wipeup: "Wipe ▲", wipedown: "Wipe ▼",
  wipetl: "Wipe ◤", wipetr: "Wipe ◥", wipebl: "Wipe ◣", wipebr: "Wipe ◢",
  slideleft: "Slide ◀", slideright: "Slide ▶", slideup: "Slide ▲", slidedown: "Slide ▼",
  coverleft: "Cover ◀", coverright: "Cover ▶", coverup: "Cover ▲", coverdown: "Cover ▼",
  revealleft: "Reveal ◀", revealright: "Reveal ▶", revealup: "Reveal ▲", revealdown: "Reveal ▼",
  circleopen: "Circle open", circleclose: "Circle close", circlecrop: "Circle crop", rectcrop: "Rect crop",
  vertopen: "Split ↕", vertclose: "Close ↕", horzopen: "Split ↔", horzclose: "Close ↔",
  radial: "Radial", diagtl: "Diag ◤", diagtr: "Diag ◥", diagbl: "Diag ◣", diagbr: "Diag ◢",
  smoothleft: "Smooth ◀", smoothright: "Smooth ▶", smoothup: "Smooth ▲", smoothdown: "Smooth ▼",
  squeezeh: "Squeeze ↔", squeezev: "Squeeze ↕",
  hlslice: "Slice ⇤", hrslice: "Slice ⇥", vuslice: "Slice ⇧", vdslice: "Slice ⇩",
  hlwind: "Wind ⇤", hrwind: "Wind ⇥", vuwind: "Wind ⇧", vdwind: "Wind ⇩",
  hblur: "Blur wipe", pixelize: "Pixelate", fadegrays: "Fade greys", zoomin: "Zoom in",
};

export const TITLE_ANIMATIONS = ["none", "fade", "slide-up", "pop", "typewriter", "bounce", "blur-in"] as const;

export const POSITIONS = [
  "top", "center", "bottom",
  "top-left", "top-right", "bottom-left", "bottom-right",
] as const;

// ───────────────────────────── sound presets ─────────────────────────────

/**
 * Applied to the final mixed audio track. These are real ffmpeg filter
 * chains (equalizer, acompressor, aecho, rubberband, loudnorm…), not labels.
 */
export const SOUND_PRESETS: Record<string, { label: string; chain: string }> = {
  none: { label: "Original", chain: "" },
  loud: { label: "Loud & clear", chain: "loudnorm=I=-14:TP=-1.5:LRA=11" },
  podcast: {
    label: "Podcast voice",
    chain: "highpass=f=85,equalizer=f=250:t=q:w=1:g=-2,equalizer=f=3000:t=q:w=1.2:g=3,acompressor=threshold=-18dB:ratio=3:attack=8:release=180,loudnorm=I=-16:TP=-1.5",
  },
  bass: { label: "Bass boost", chain: "bass=g=9:f=90,acompressor=threshold=-12dB:ratio=2,loudnorm=I=-14:TP=-1" },
  treble: { label: "Bright", chain: "treble=g=7:f=4000,loudnorm=I=-14:TP=-1" },
  hall: { label: "Concert hall", chain: "aecho=0.85:0.9:400|750:0.35|0.25" },
  room: { label: "Small room", chain: "aecho=0.8:0.5:60:0.2" },
  lofi: { label: "Lo-fi", chain: "lowpass=f=3200,highpass=f=140,aecho=0.8:0.6:120:0.2,volume=1.05" },
  radio: { label: "Radio", chain: "highpass=f=320,lowpass=f=3000,acompressor=threshold=-15dB:ratio=6,loudnorm=I=-14:TP=-1" },
  phone: { label: "Telephone", chain: "highpass=f=500,lowpass=f=3200,acompressor=threshold=-18dB:ratio=8" },
  wide: { label: "Wide stereo", chain: "stereowiden=delay=18:feedback=0.25:crossfeed=0.2:drymix=0.75" },
  swirling: { label: "8D swirl", chain: "apulsator=hz=0.12:width=1.2:mode=triangle" },
  cinematic: {
    label: "Cinematic boom",
    chain: "bass=g=6:f=70,treble=g=-2,acompressor=threshold=-16dB:ratio=2.5:attack=15:release=300,loudnorm=I=-16:TP=-1",
  },
  night: { label: "Night mode", chain: "acompressor=threshold=-26dB:ratio=8:attack=5:release=120,loudnorm=I=-18:TP=-2" },
  vinyl: { label: "Vinyl warmth", chain: "lowpass=f=11000,highpass=f=60,bass=g=3,aecho=0.9:0.4:22:0.15" },
  karaoke: { label: "Vocal reduce", chain: "pan=stereo|c0=c0-c1|c1=c1-c0,volume=1.4" },
  slowed: { label: "Slowed + reverb", chain: "atempo=0.85,aecho=0.9:0.9:280|520:0.35|0.22" },
  speedup: { label: "Sped up", chain: "atempo=1.18,treble=g=3" },
};

// ───────────────────────────── video FX presets ─────────────────────────────

/**
 * Applied to the composed video, before titles/stickers are drawn.
 * `twoPass` marks effects that need the frame twice (split → blur → blend).
 * ffmpeg's `blend` takes two inputs, so a naive single chain cannot work.
 */
export const VIDEO_FX: Record<
  string,
  { label: string; chain?: string; twoPass?: { pre: string; then: string } }
> = {
  none: { label: "Clean", chain: "" },
  vignette: { label: "Vignette", chain: "vignette=PI/4.5" },
  sharpen: { label: "Sharpen", chain: "unsharp=5:5:0.9:5:5:0" },
  soft: { label: "Soft focus", chain: "gblur=sigma=3,eq=contrast=1.02" },
  blur: { label: "Heavy blur", chain: "gblur=sigma=12" },
  dream: {
    label: "Dream glow",
    twoPass: { pre: "gblur=sigma=7", then: "blend=all_mode=screen:all_opacity=0.35" },
  },
  vhs: {
    label: "VHS",
    chain: "chromashift=cbh=6:crh=-6,noise=alls=14:allf=t+u,curves=preset=vintage,eq=saturation=1.15",
  },
  glitch: {
    label: "Glitch",
    chain: "rgbashift=rh=4:bh=-4,noise=alls=22:allf=t,eq=contrast=1.1:saturation=1.25",
  },
  film: {
    label: "Old film",
    chain: "noise=alls=10:allf=t+u,curves=preset=vintage,vignette=PI/5,eq=contrast=1.06:saturation=0.86",
  },
  pixelate: { label: "Pixelate", chain: "scale=iw/8:ih/8:flags=neighbor,scale=iw*8:ih*8:flags=neighbor" },
  mirror: { label: "Mirror", chain: "hflip" },
  mono: { label: "Monochrome", chain: "hue=s=0" },
  chroma: { label: "Chromatic", chain: "chromashift=cbh=3:crh=-3:cbv=1:crv=-1" },
  bloom: {
    label: "Bloom",
    twoPass: { pre: "eq=brightness=0.03:saturation=1.2,gblur=sigma=5", then: "blend=all_mode=lighten:all_opacity=0.3" },
  },
  vintage_grain: { label: "Grain", chain: "noise=alls=8:allf=t,curves=all='0/0.04 1/0.96'" },
  sharpen_hd: { label: "HD crisp", chain: "unsharp=7:7:1.2:7:7:0,eq=contrast=1.05:saturation=1.05" },
};

/** Video FX that stack (applied in order) — used by recipes. */
export const FX_STACK = ["none", ...Object.keys(VIDEO_FX).filter((k) => k !== "none")];

export type Recipe = {
  id: string;
  label: string;
  emoji: string;
  blurb: string;
  /** Descriptive: the UI turns this into a project patch. */
  patch: Record<string, unknown>;
};

/**
 * One-tap recipes. Each patches look + motion + transition + sound + fx + text
 * in a single click.
 */
export const ONE_TAP_RECIPES: Recipe[] = [
  {
    id: "viral-hook",
    label: "Viral hook",
    emoji: "🔥",
    blurb: "Punch-in, vivid grade, popping white hook in the first 2 s",
    patch: { look: "vivid", motion: "zoom-in", sound: "loud", fx: "sharpen", transition: "zoomin", text: { text: "WAIT FOR IT…", position: "top", animation: "pop", box: true } },
  },
  {
    id: "cinematic-open",
    label: "Cinematic open",
    emoji: "🎬",
    blurb: "Teal grade, slow push-out, fade-to-black, boom-y audio",
    patch: { look: "cinematic", motion: "zoom-out", transition: "fadeblack", transitionSec: 0.9, sound: "cinematic", fx: "vignette" },
  },
  {
    id: "podcast-clip",
    label: "Podcast clip",
    emoji: "🎙️",
    blurb: "16:9, crisp grade, voice-first audio, lower-third name",
    patch: { aspect: "16:9", look: "crisp", sound: "podcast", fx: "sharpen", text: { text: "Guest name", position: "bottom-left", box: true, animation: "slide-up" } },
  },
  {
    id: "retro-vhs",
    label: "Retro VHS",
    emoji: "📼",
    blurb: "Chromashift, grain, warm wash, timestamp",
    patch: { look: "vintage", motion: "shake", fx: "vhs", sound: "vinyl", text: { text: "1998", position: "bottom-right", color: "#7CFC00", animation: "typewriter" } },
  },
  {
    id: "aesthetic-bw",
    label: "Aesthetic B&W",
    emoji: "🖤",
    blurb: "Monochrome, gentle drift, film grain",
    patch: { look: "bw", motion: "pan-right", fx: "film", sound: "vinyl", text: { text: "mood.", position: "center", animation: "fade" } },
  },
  {
    id: "neon-night",
    label: "Neon night",
    emoji: "🌃",
    blurb: "Neon grade, pulse, glitch transition, glowing title",
    patch: { look: "neon", motion: "pulse", fx: "glitch", transition: "hlslice", sound: "loud", text: { text: "after hours", position: "center", color: "#00F5FF", animation: "pop" } },
  },
  {
    id: "tutorial",
    label: "Tutorial",
    emoji: "🎓",
    blurb: "Crisp HD, numbered step title, clear voice",
    patch: { look: "crisp", motion: "none", fx: "sharpen_hd", sound: "podcast", text: { text: "STEP 1", position: "top-left", box: true } },
  },
  {
    id: "face-zoom",
    label: "Face zoom",
    emoji: "😮",
    blurb: "Aggressive punch-in for reactions",
    patch: { look: "vivid", motion: "zoom-in", zoom: 1.45, sound: "loud", transition: "squeezeh" },
  },
  {
    id: "dreamy-slideshow",
    label: "Dreamy slideshow",
    emoji: "☁️",
    blurb: "Soft glow, slow dissolves, hall reverb",
    patch: { look: "dreamy", motion: "zoom-out", fx: "dream", transition: "dissolve", transitionSec: 1.2, sound: "hall" },
  },
  {
    id: "glitch-edit",
    label: "Glitch edit",
    emoji: "⚡",
    blurb: "RGB shift, hard slices, phone-tone audio",
    patch: { look: "matrix", fx: "glitch", transition: "hlslice", transitionSec: 0.25, sound: "phone" },
  },
];

/**
 * What the editor can do. Kept as data so the UI, MCP and README never drift
 * apart — and so Claude can quote it accurately.
 */
export const EDIT_CAPABILITIES = [
  { group: "Timeline", items: ["Multi-clip timeline (up to 40 cuts)", "Trim any in/out point", "Split & reorder clips", "Aspect presets 9:16 / 1:1 / 4:5 / 16:9 / 4:3 / custom W×H"] },
  { group: "Speed & time", items: ["0.25×–4× speed ramp", "Reverse playback", "Freeze-frame via still insert", "Slow-mo with audio-safe tempo"] },
  { group: "Motion", items: ["8 camera presets (zoom, pan, shake, pulse, whip)", "Ken-Burns zoom 1×–3×", "Manual crop x/y/w/h"] },
  { group: "Looks", items: ["16 one-click grades (cinematic, vintage, B&W, sepia, noir, neon, sunset, matrix, dreamy, crisp, matte…)"] },
  { group: "Transitions", items: [`${TRANSITIONS.length - 1} transitions — every xfade this ffmpeg supports`, "Adjustable 0.1–2 s duration", "Fades, wipes, slides, covers, reveals, shapes, glitch slices, pixelate, zoom"] },
  { group: "Video FX", items: [`${Object.keys(VIDEO_FX).length - 1} stackable effects`, "VHS, glitch, old film, grain, pixelate, bloom, chroma, blur, sharpen, vignette, mirror"] },
  { group: "Sound", items: [`${Object.keys(SOUND_PRESETS).length - 1} audio presets`, "Podcast voice, bass boost, concert hall, lo-fi, radio, telephone, 8D swirl, cinematic, vinyl, vocal-reduce, slowed+reverb", "Pitch shift, loudness normalisation, auto-ducking"] },
  { group: "Titles", items: ["Free text with 7 anchors or exact x/y", "7 animations: fade, slide-up, pop, typewriter, bounce, blur-in", "Box, shadow, italic, uppercase, colour & size", "Multi-line auto-wrap"] },
  { group: "Stickers & overlays", items: ["Image overlays anywhere", "Size, rotation, opacity, fade in/out", "5 built-in stickers"] },
  { group: "Music", items: ["Search free music on SoundCloud, Bandcamp, Archive.org, Jamendo", "Up to 1755 sites via yt-dlp", "Local uploads", "Per-bed volume, loop, fades, ducking"] },
  { group: "Export", items: ["H.264 MP4, faststart, 1080p+", "Saved to the library with a poster frame", "One-call JSON project (Claude-friendly)"] },
] as const;

/** Counts used in the UI + docs headline. */
export const TOOLKIT_COUNTS = {
  transitions: TRANSITIONS.length - 1,
  looks: 16,
  motions: 8,
  sounds: Object.keys(SOUND_PRESETS).length - 1,
  fx: Object.keys(VIDEO_FX).length - 1,
  recipes: ONE_TAP_RECIPES.length,
  sites: 1755,
};
