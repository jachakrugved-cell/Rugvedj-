"use client";

import { useMemo, useState } from "react";
import ClipCard from "@/components/ClipCard";
import { Chip } from "@/components/ui";
import type { ClipRecord, Task } from "@/lib/types";

type Sort = "new" | "short" | "long" | "big";
type Filter = "all" | "vertical" | "captions";

export default function LibraryView({
  clips,
  tasks,
  onDeleteClip,
  onReclip,
  onRefresh,
}: {
  clips: ClipRecord[];
  tasks: Task[];
  onDeleteClip: (id: string) => Promise<void>;
  onReclip: (c: ClipRecord) => void;
  onRefresh: () => void;
}) {
  const [sort, setSort] = useState<Sort>("new");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const list = clips.filter((c) => {
      if (q && !`${c.title} ${c.fileName} ${c.sourceUrl}`.toLowerCase().includes(q.toLowerCase()))
        return false;
      if (filter === "vertical" && c.aspect !== "9:16" && c.aspect !== "4:5") return false;
      if (filter === "captions" && !c.captions) return false;
      return true;
    });
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sort === "new") return b.createdAt - a.createdAt;
      if (sort === "short") return a.durationSec - b.durationSec;
      if (sort === "long") return b.durationSec - a.durationSec;
      return b.sizeBytes - a.sizeBytes;
    });
    return sorted;
  }, [clips, sort, filter, q]);

  const totalBytes = clips.reduce((a, c) => a + c.sizeBytes, 0);
  const failed = tasks.filter((t) => t.state === "error").slice(0, 3);

  return (
    <main className="mt-5 space-y-5">
      <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
        <div>
          <h2 className="text-sm font-semibold">Library</h2>
          <p className="mt-0.5 text-[11px] text-muted">
            {clips.length} clip{clips.length === 1 ? "" : "s"} · {(totalBytes / 1e6).toFixed(1)} MB on
            this machine · nothing in the cloud
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clips…"
            className="input !w-56 !py-1.5 !text-xs"
          />
          <div className="flex gap-1 rounded-full border border-line bg-black/30 p-1">
            {(
              [
                ["all", "All"],
                ["vertical", "Vertical"],
                ["captions", "Captioned"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className="pill-tab !text-[11px]" data-active={filter === k} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="input !w-auto !py-1.5 !text-xs"
          >
            <option value="new">Newest</option>
            <option value="short">Shortest</option>
            <option value="long">Longest</option>
            <option value="big">Largest</option>
          </select>
          <button className="btn btn-ghost !py-1.5 text-xs" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </div>

      {failed.length > 0 && (
        <div className="card border-rose-500/25 p-3">
          <h3 className="mb-1 text-xs font-semibold text-rose-200">Recent errors</h3>
          <ul className="space-y-1 text-[11px] text-muted">
            {failed.map((t) => (
              <li key={t.id}>
                <span className="mono text-rose-300">{t.kind}</span> — {t.title}: {t.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="grid-lines flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-2xl border border-line">
          <p className="text-sm font-medium text-muted">No clips yet</p>
          <p className="text-xs text-[#5d6479]">Cut your first clip in the Studio tab.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((c) => (
            <ClipCard key={c.id} clip={c} onDelete={onDeleteClip} onReclip={onReclip} />
          ))}
        </div>
      )}

      <div className="card p-4 text-[11px] text-muted">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="brand">on disk</Chip>
          <span>
            Clips live in <code className="mono text-ink">.data/clips</code> and are indexed in{" "}
            <code className="mono text-ink">.data/library.json</code>. Delete them here or with the MCP
            tool <code className="mono text-ink">delete_clip</code>.
          </span>
        </div>
      </div>
    </main>
  );
}
