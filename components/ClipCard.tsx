"use client";

import { useState } from "react";
import type { ClipRecord } from "@/lib/types";
import { fmtTime } from "@/lib/time";

export default function ClipCard({
  clip,
  onDelete,
  onReclip,
}: {
  clip: ClipRecord;
  onDelete: (id: string) => void;
  onReclip: (clip: ClipRecord) => void;
}) {
  const [busy, setBusy] = useState(false);
  const aspect = (clip.meta?.width && clip.meta?.height
    ? `${clip.meta.width}×${clip.meta.height}`
    : clip.aspect) as string;

  return (
    <div className="card group fade-in overflow-hidden">
      <div className="relative aspect-video bg-black">
        <video
          src={`/api/clips/${clip.id}/file`}
          controls
          preload="metadata"
          playsInline
          className="h-full w-full object-contain"
        />
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h4 className="line-clamp-2 text-sm font-semibold leading-snug">{clip.title}</h4>
          <span className="chip shrink-0">{aspect}</span>
        </div>
        <div className="mono flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span>{fmtTime(clip.durationSec)}</span>
          <span>{(clip.sizeBytes / 1e6).toFixed(1)} MB</span>
          <span>
            in {fmtTime(clip.startSec)} – out {fmtTime(clip.endSec)}
          </span>
          {clip.captions && <span className="text-brand-2">captions</span>}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <a
            className="btn btn-ghost !px-2.5 !py-1.5 text-xs"
            href={`/api/clips/${clip.id}/file?download=1`}
            download={clip.fileName}
          >
            Download
          </a>
          <button className="btn btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => onReclip(clip)}>
            Re-clip
          </button>
          <button
            className="btn btn-ghost !px-2.5 !py-1.5 text-xs text-rose-300 hover:!border-rose-500/40"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onDelete(clip.id);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
