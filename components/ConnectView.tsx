"use client";

import { useState } from "react";
import { Chip, Env } from "@/components/ui";
import type { Health } from "@/lib/types";

const TOOLS = [
  ["probe_video", "Read any link → title, duration, resolution, is-live, playable URL."],
  ["clip_video", "Cut a clip by link or clip id. Aspect, captions, styles, timecodes."],
  ["record_live", "Record N seconds of a live stream to a local MP4."],
  ["list_clips", "Browse the local library."],
  ["delete_clip", "Remove a clip (file + index)."],
  ["get_clip", "Full metadata for one clip."],
  ["check_engine", "Verify ffmpeg/ffprobe/yt-dlp and the engine URL."],
];

const MCP_JSON = `{
  "mcpServers": {
    "clipforge": {
      "command": "npx",
      "args": ["-y", "tsx", "mcp/server.ts"],
      "cwd": "<THIS_REPO>",
      "env": {
        "CLIPFORGE_ENGINE_URL": "http://127.0.0.1:3000",
        "CLIPFORGE_AUTOSTART": "1"
      }
    }
  }
}`;

const PROMPTS = [
  "Connect to ClipForge, then clip 00:12–00:48 of https://youtu.be/… as a 9:16 clip with bold captions.",
  "Record 90 seconds of this live stream, then cut the best 20 seconds and caption it: <m3u8 link>",
  "List my ClipForge clips, show their durations, and delete any older than a week.",
  "Make three vertical clips from this video at the timestamps I list, using karaoke captions.",
];

export default function ConnectView({ health }: { health: Health | null }) {
  const [repo, setRepo] = useState("<THIS_REPO>");
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window === "undefined" ? "http://127.0.0.1:3000" : window.location.origin;

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* blocked */
    }
  };

  const json = MCP_JSON.replace("<THIS_REPO>", repo);
  const cli = "claude mcp add clipforge -- npx -y tsx mcp/server.ts";
  const run = "npm install && npm run setup && npm run dev";

  const engineHost = origin.replace(/^https?:\/\//, "");
  const isLocalhost = /^(localhost|127\.0\.0\.1|\[::1\])/.test(engineHost.split(":")[0]);

  return (
    <main className="mt-5 grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="min-w-0 space-y-5">
        <div className="glass rounded-2xl p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Connect Claude Code in 2 minutes</h2>
              <p className="mt-0.5 text-xs text-muted">
                ClipForge ships an MCP server. Claude gets the clipper as tools — paste a link in
                chat, get an MP4 on your disk.
              </p>
            </div>
            <Chip tone="brand">MCP · stdio</Chip>
          </div>

          <ol className="space-y-4">
            <Step n={1} title="Run the studio on this machine">
              <CopyBlock text={run} copied={copied === "run"} onCopy={() => copy(run, "run")} />
              <p className="mt-1.5 text-[11px] text-muted">
                Requires Node 20+. <code className="mono text-ink">npm run setup</code> downloads a
                portable ffmpeg + yt-dlp into <code className="mono text-ink">.tools/bin</code> — no
                system installs, no accounts, no API keys.
              </p>
            </Step>

            <Step n={2} title="Register the MCP server with Claude Code">
              <div className="mb-2">
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Absolute path to this repo
                </label>
                <input
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  className="input mono !text-xs"
                  placeholder="/Users/you/code/Rugvedj-"
                />
              </div>
              <CopyBlock text={cli} copied={copied === "cli"} onCopy={() => copy(cli, "cli")} />
              <p className="mt-1.5 text-[11px] text-muted">or paste this into your MCP config:</p>
              <div className="mt-1.5">
                <CopyBlock text={json} copied={copied === "json"} onCopy={() => copy(json, "json")} multiline />
              </div>
            </Step>

            <Step n={3} title="Tell Claude to connect">
              <CopyBlock
                text="Connect to ClipForge and check the engine."
                copied={copied === "say"}
                onCopy={() => copy("Connect to ClipForge and check the engine.", "say")}
              />
              <p className="mt-1.5 text-[11px] text-muted">
                Claude will call <code className="mono text-ink">check_engine</code>. If the studio
                isn&apos;t running, the MCP server starts it automatically (
                <code className="mono text-ink">CLIPFORGE_AUTOSTART=1</code>).
              </p>
            </Step>

            <Step n={4} title="Paste any video link and ask for a clip">
              <div className="space-y-1.5">
                {PROMPTS.map((p) => (
                  <div
                    key={p}
                    className="flex items-start justify-between gap-3 rounded-xl border border-line bg-black/25 p-2.5"
                  >
                    <p className="text-[11.5px] leading-relaxed">
                      <span className="mr-1.5 text-brand">›</span>
                      {p}
                    </p>
                    <button
                      className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[10px] text-muted hover:text-ink"
                      onClick={() => copy(p, p)}
                    >
                      {copied === p ? "✓" : "Copy"}
                    </button>
                  </div>
                ))}
              </div>
            </Step>
          </ol>
        </div>

        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold">MCP tools Claude gets</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TOOLS.map(([name, desc]) => (
              <div key={name} className="rounded-xl border border-line bg-black/20 p-2.5">
                <p className="mono text-[11.5px] font-semibold text-brand-2">{name}</p>
                <p className="mt-0.5 text-[11px] text-muted">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className="min-w-0 space-y-5">
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">Engine status</h3>
          <ul className="space-y-1.5 text-[11px]">
            <Env ok={health?.ffmpeg.ok} label="ffmpeg" detail={health?.ffmpeg.version} />
            <Env ok={health?.ffprobe.ok} label="ffprobe" detail={health?.ffprobe.version} />
            <Env ok={health?.ytdlp.ok} label="yt-dlp" detail={health?.ytdlp.version ?? "optional"} />
          </ul>
          <div className="mt-3 space-y-1 text-[11px] text-muted">
            <p>
              Engine URL for MCP:{" "}
              <code className="mono break-all text-ink">{origin}</code>
            </p>
            {!isLocalhost && (
              <p className="rounded-lg bg-amber-500/10 p-2 text-amber-200/90">
                You&apos;re viewing a remote preview. Claude Code runs on your machine, so point the
                MCP env at a locally running engine (default{" "}
                <code className="mono">http://127.0.0.1:3000</code>).
              </p>
            )}
          </div>
        </div>

        <div className="card p-4 text-[11px] leading-relaxed text-muted">
          <h3 className="mb-2 text-sm font-semibold text-ink">Why this is &quot;free&quot;</h3>
          <ul className="space-y-1.5">
            <li>• No SaaS, no credits, no watermark, no upload.</li>
            <li>• ffmpeg does the cutting — the same tool studios use.</li>
            <li>• You only pay for your own Claude Code subscription; the MCP server itself is free and MIT-licensed.</li>
            <li>• Works offline once ffmpeg/yt-dlp are downloaded.</li>
          </ul>
        </div>

        <div className="card p-4 text-[11px] text-muted">
          <h3 className="mb-1.5 text-sm font-semibold text-ink">Prefer HTTP?</h3>
          <p>
            Everything Claude can do over MCP is also a plain endpoint — see the API table in the
            Studio tab. Use <code className="mono text-ink">{origin}/api/probe</code> as the entry
            point.
          </p>
        </div>
      </aside>
    </main>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="relative rounded-2xl border border-line bg-black/20 p-3.5 pl-12">
      <span className="absolute left-3 top-3.5 grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-brand to-brand-2 text-xs font-black text-[#0a0a12]">
        {n}
      </span>
      <p className="mb-2 text-xs font-semibold">{title}</p>
      {children}
    </li>
  );
}

function CopyBlock({
  text,
  onCopy,
  copied,
  multiline,
}: {
  text: string;
  onCopy: () => void;
  copied: boolean;
  multiline?: boolean;
}) {
  return (
    <div className="relative rounded-xl border border-line bg-[#070910]">
      <pre
        className={`mono overflow-x-auto p-3 pr-16 text-[11px] leading-relaxed text-emerald-200/90 ${
          multiline ? "max-h-52 whitespace-pre-wrap break-all" : "whitespace-pre-wrap break-all"
        }`}
      >
        {text}
      </pre>
      <button
        onClick={onCopy}
        className="absolute right-2 top-2 rounded-md border border-line bg-white/5 px-2 py-1 text-[10px] font-semibold text-ink hover:bg-white/10"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}
