"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import { fmtTime } from "@/lib/time";

type Track = {
  id: string;
  title: string;
  artist: string;
  durationSec: number | null;
  url: string;
  source: string;
  license: string;
};

type Catalogue = {
  sources: { id: string; label: string; blurb: string; license: string }[];
  note: string;
  soundKit: { id: string; label: string; emoji: string; fileName: string }[];
};

const SOURCE_EMOJI: Record<string, string> = {
  soundcloud: "🟠",
  bandcamp: "🔵",
  archive: "🏛",
  jamendo: "🟢",
};

/**
 * Free music browser. Searches the CC/public-domain sources and the generated
 * sound kit, then hands a /api/media path back to the editor as a music bed.
 */
export default function MusicPanel({ onPick }: { onPick: (src: string, label: string) => void }) {
  const [cat, setCat] = useState<Catalogue | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [errors, setErrors] = useState<{ source: string; error: string }[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [tab, setTab] = useState<"search" | "kit">("kit");

  useEffect(() => {
    fetch("/api/music")
      .then((r) => r.json())
      .then(setCat)
      .catch(() => setCat(null));
  }, []);

  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/music", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "search", query: q.trim(), limit: 12 }),
      });
      const json = await res.json();
      setTracks(json.tracks ?? []);
      setErrors(json.errors ?? []);
      setNote(json.note ?? null);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const use = async (t: Track) => {
    setDownloading(t.id);
    setNote(null);
    try {
      const res = await fetch("/api/music", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "download", url: t.url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Download failed");
      onPick(`/api/media/${encodeURIComponent(json.fileName)}`, `${t.artist} – ${t.title}`.slice(0, 30));
      setNote(`Added "${t.title}" to the timeline as a music bed.`);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <button type="button" className={`btn-ghost px-2.5 py-1 text-xs ${tab === "kit" ? "!border-brand/60 !text-brand-2" : ""}`} onClick={() => setTab("kit")}>
          🔊 Sound kit
        </button>
        <button type="button" className={`btn-ghost px-2.5 py-1 text-xs ${tab === "search" ? "!border-brand/60 !text-brand-2" : ""}`} onClick={() => setTab("search")}>
          🔎 Free music
        </button>
      </div>

      {tab === "kit" && (
        <div className="grid grid-cols-2 gap-1.5">
          {cat?.soundKit?.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(`/api/media/${encodeURIComponent(s.fileName)}`, s.label)}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.02] px-2 py-1.5 text-left text-[11px] transition hover:border-brand/50 hover:bg-white/[0.05]"
            >
              <span>{s.emoji}</span>
              <span className="truncate">{s.label}</span>
            </button>
          ))}
          {!cat && <p className="col-span-2 text-[11px] text-muted">Loading sound kit…</p>}
        </div>
      )}

      {tab === "search" && (
        <>
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="lofi study beat, epic trailer…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
            />
            <button type="button" className="btn-primary shrink-0 px-2.5 py-1 text-xs" onClick={search} disabled={busy}>
              {busy ? <Spinner /> : "Search"}
            </button>
          </div>

          <p className="text-[10px] leading-relaxed text-muted">
            {cat?.sources?.map((s) => s.label).join(" · ")} — free & CC catalogues. Spotify is not included: playback
            needs Premium and its terms forbid downloading.
          </p>

          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {tracks.map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-lg border border-line bg-white/[0.02] p-1.5">
                <span className="text-xs">{SOURCE_EMOJI[t.source] ?? "🎵"}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-medium">{t.title}</div>
                  <div className="truncate text-[10px] text-muted">
                    {t.artist}
                    {t.durationSec ? ` · ${fmtTime(t.durationSec)}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost shrink-0 px-2 py-1 text-[10px]"
                  onClick={() => use(t)}
                  disabled={downloading === t.id}
                >
                  {downloading === t.id ? <Spinner size={10} /> : "+ Use"}
                </button>
              </div>
            ))}
            {!tracks.length && !busy && (
              <p className="rounded-lg border border-dashed border-line p-3 text-center text-[10.5px] text-muted">
                {errors.length ? errors.map((e) => `${e.source}: ${e.error}`).join(" · ") : "Search a genre or mood."}
              </p>
            )}
          </div>
        </>
      )}

      {note && <p className="rounded-lg border border-brand/30 bg-brand/10 px-2 py-1.5 text-[10.5px] text-brand-2">{note}</p>}
      <p className="text-[10px] leading-relaxed text-muted/70">
        Check each track&rsquo;s licence before publishing — the editor shows the source and CC note for every result.
      </p>
    </div>
  );
}
