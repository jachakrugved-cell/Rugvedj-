"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  live?: boolean;
  className?: string;
  onTime?: (t: number) => void;
  onDuration?: (d: number) => void;
  seekRequest?: number; // when this number changes, jump to it
};

/**
 * <video> wrapper that transparently plays HLS via hls.js,
 * falls back to native HLS (Safari), and reports time updates up.
 */
export default function HlsPlayer({
  src,
  live = false,
  className,
  onTime,
  onDuration,
  seekRequest,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSeek = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    setError(null);
    let destroyed = false;
    let hls: import("hls.js").default | null = null;

    const isHls = /\.m3u8(\?|#|$)/i.test(src) || src.includes("m3u8");

    (async () => {
      if (isHls) {
        const HlsMod = await import("hls.js");
        const Hls = HlsMod.default;
        if (destroyed) return;
        if (Hls.isSupported()) {
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            maxBufferLength: live ? 20 : 30,
            backBufferLength: 30,
          });
          hls.loadSource(src);
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal) {
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                hls?.startLoad();
              } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                hls?.recoverMediaError();
              } else {
                setError(`Playback error: ${data.details}`);
              }
            }
          });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = src;
        } else {
          setError("This browser cannot play HLS streams.");
        }
      } else {
        video.src = src;
      }
    })();

    return () => {
      destroyed = true;
      hls?.destroy();
      video.removeAttribute("src");
    };
  }, [src, live]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || seekRequest === undefined || seekRequest === null) return;
    if (lastSeek.current === seekRequest) return;
    const apply = () => {
      try {
        video.currentTime = seekRequest;
        lastSeek.current = seekRequest;
      } catch {
        /* not seekable yet */
      }
    };
    if (video.readyState >= 1) apply();
    else video.addEventListener("loadedmetadata", apply, { once: true });
  }, [seekRequest]);

  return (
    <div className={`relative h-full w-full bg-black ${className ?? ""}`}>
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        className="h-full w-full object-contain"
        onTimeUpdate={(e) => onTime?.((e.target as HTMLVideoElement).currentTime)}
        onLoadedMetadata={(e) => {
          const v = e.target as HTMLVideoElement;
          onDuration?.(Number.isFinite(v.duration) ? v.duration : 0);
        }}
      />
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 p-6 text-center">
          <p className="text-sm font-semibold text-rose-300">{error}</p>
          <p className="max-w-sm text-xs text-muted">
            The clip engine may still be able to cut this source — playback is best-effort for
            protected streams.
          </p>
        </div>
      )}
      {live && (
        <span className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-bold tracking-widest text-rose-300">
          <span className="live-dot" /> LIVE
        </span>
      )}
    </div>
  );
}
