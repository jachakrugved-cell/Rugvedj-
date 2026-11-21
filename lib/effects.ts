/**
 * The editor's palettes: transitions, title animations, one-tap recipes and a
 * human-readable capability list (used by the UI, /api/studio and the docs).
 */

export const TRANSITIONS = [
  "none",
  "fade",
  "dissolve",
  "wipeleft",
  "wiperight",
  "slideup",
  "slidedown",
  "circle",
  "smooth",
] as const;

export const TITLE_ANIMATIONS = ["none", "fade", "slide-up", "pop", "typewriter"] as const;

export const POSITIONS = [
  "top",
  "center",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;

export type Recipe = {
  id: string;
  label: string;
  emoji: string;
  blurb: string;
  /** Purely descriptive: the UI turns this into a project patch. */
  patch: Record<string, unknown>;
};

/**
 * One-tap looks that map to CapCut's popular "templates": each is a small
 * project patch the UI applies on top of whatever the user already built.
 */
export const ONE_TAP_RECIPES: Recipe[] = [
  {
    id: "viral-hook",
    label: "Viral hook",
    emoji: "🔥",
    blurb: "Punch-in + white hooked title in the first 2s",
    patch: { look: "vivid", motion: "zoom-in", text: { text: "WAIT FOR IT…", position: "top", animation: "pop", box: true } },
  },
  {
    id: "cinematic-open",
    label: "Cinematic open",
    emoji: "🎬",
    blurb: "Letterboxed feel, teal grade, slow ramp-in",
    patch: { look: "cinematic", motion: "zoom-out", transition: "fade", fadeIn: 0.6 },
  },
  {
    id: "podcast-clip",
    label: "Podcast clip",
    emoji: "🎙️",
    blurb: "16:9, crisp grade, lower-third name",
    patch: { aspect: "16:9", look: "crisp", text: { text: "Guest name", position: "bottom-left", box: true, animation: "slide-up" } },
  },
  {
    id: "retro-vhs",
    label: "Retro VHS",
    emoji: "📼",
    blurb: "Warm scan, shake motion, timestamp text",
    patch: { look: "vintage", motion: "shake", text: { text: "1998", position: "bottom-right", color: "#7CFC00" } },
  },
  {
    id: "aesthetic-bw",
    label: "Aesthetic B&W",
    emoji: "🖤",
    blurb: "Monochrome with centered serif-style caption",
    patch: { look: "bw", motion: "pan-right", text: { text: "mood.", position: "center", animation: "fade" } },
  },
  {
    id: "neon-night",
    label: "Neon night",
    emoji: "🌃",
    blurb: "Neon grade with glowing title",
    patch: { look: "neon", motion: "pulse", text: { text: "after hours", position: "center", color: "#00F5FF", animation: "pop" } },
  },
  {
    id: "tutorial",
    label: "Tutorial",
    emoji: "🎓",
    blurb: "Crisp HD + numbered step title",
    patch: { look: "crisp", motion: "none", text: { text: "STEP 1", position: "top-left", box: true } },
  },
  {
    id: "face-zoom",
    label: "Face zoom",
    emoji: "😮",
    blurb: "Aggressive punch-in for reaction clips",
    patch: { motion: "zoom-in", look: "vivid", zoom: 1.35 },
  },
];

/**
 * What the editor can do. Kept as data so the UI, MCP and README never drift
 * apart — and so Claude can quote it accurately.
 */
export const EDIT_CAPABILITIES = [
  { group: "Timeline", items: ["Multi-clip timeline (up to 40 cuts)", "Trim any in/out point", "Split & reorder clips", "Per-clip duration readout", "Aspect presets 9:16 / 1:1 / 4:5 / 16:9 / 4:3"] },
  { group: "Speed & time", items: ["0.25×–4× speed ramp", "Reverse playback", "Freeze-frame via still insert", "Slow-mo audio-safe tempo"] },
  { group: "Motion", items: ["8 motion presets (zoom, pan, shake, pulse, whip)", "Ken-Burns zoom control 1×–3×", "Manual crop x/y/w/h"] },
  { group: "Looks", items: ["16 one-click grades (warm, cool, cinematic, vintage, B&W, sepia, vivid, noir, neon, sunset, matrix, dreamy, crisp, matte…)"] },
  { group: "Transitions", items: ["9 transitions: fade, dissolve, wipe, slide, circle, smooth", "Adjustable 0.1–2 s duration"] },
  { group: "Titles", items: ["Free text with 7 anchors or exact x/y", "5 animations: fade, slide-up, pop, typewriter", "Box, shadow, italic, uppercase, colour & size", "Multi-line auto-wrap"] },
  { group: "Stickers & overlays", items: ["Image overlays anywhere", "Size, rotation, opacity, fade in/out"] },
  { group: "Audio", items: ["Original clip audio with per-clip volume/mute", "Music & voiceover beds with in/out", "Auto-duck music under dialogue", "Fade in/out, loop"] },
  { group: "Export", items: ["H.264 MP4, faststart, 1080p+", "Saved to the library with poster frame", "One-call JSON project (Claude-friendly)"] },
] as const;
