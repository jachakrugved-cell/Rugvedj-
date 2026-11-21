"use client";

import { useState } from "react";

const MCP_CONFIG = `{
  "mcpServers": {
    "clipforge": {
      "command": "npx",
      "args": ["-y", "tsx", "mcp/server.ts"],
      "cwd": "<path-to-this-repo>"
    }
  }
}`;

const CLI_ONE_LINER =
  'claude mcp add clipforge -- npx -y tsx mcp/server.ts   # run from the repo root';

const PROMPTS = [
  "Connect to ClipForge at http://127.0.0.1:3000 and clip 00:12–00:48 of this video as a 9:16 clip with bold captions: <link>",
  "Record 90 seconds of this live stream and then cut the best 20 seconds: <link>",
  "List my clips, delete the oldest one, then make a 1:1 clip of <link> from 1:05 to 1:25 with pink highlight captions.",
];

export default function ConnectPanel({ port }: { port?: number }) {
  const [tab, setTab] = useState<"claude" | "http" | "cli">("claude");
  const [copied, setCopied] = useState<string | null>(null);
  const repoPath = "<path-to-this-repo>";

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  const config = MCP_CONFIG.replace("<path-to-this-repo>", repoPath);
  const base = `http://127.0.0.1:${port ?? 3000}`;

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Connect Claude Code</h3>
          <p className="mt-0.5 text-xs text-muted">
            One command. Claude then gets 7 tools to probe, clip, record and manage your library.
          </p>
        </div>
        <span className="chip !border-brand/40 !text-brand">MCP</span>
      </div>

      <div className="mb-3 flex gap-1">
        {(
          [
            ["claude", "Claude Code"],
            ["http", "HTTP API"],
            ["cli", "Terminal"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className="pill-tab"
            data-active={tab === k}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "claude" && (
        <div className="space-y-3 text-xs">
          <p className="text-muted">
            Run this once from the repo root (or paste the config into{" "}
            <code className="mono text-ink">.mcp.json</code>):
          </p>
          <CopyBlock text={CLI_ONE_LINER} onCopy={() => copy(CLI_ONE_LINER, "cli")} copied={copied === "cli"} />
          <p className="text-muted">
            Then start Claude Code in this repo and say:{" "}
            <span className="text-ink">“connect to the ClipForge server and clip this link”</span>.
            The server is already checked in at <code className="mono text-ink">mcp/server.ts</code>.
          </p>
          <CopyBlock text={config} onCopy={() => copy(config, "json")} copied={copied === "json"} multiline />
        </div>
      )}

      {tab === "http" && (
        <div className="space-y-2 text-xs">
          <table className="w-full text-left">
            <tbody className="[&_td]:border-t [&_td]:border-line [&_td]:py-1.5 [&_td]:pr-2 [&_td]:align-top">
              <Row m="POST" path="/api/probe" desc="Any link → duration, live?, playable URL" />
              <Row m="POST" path="/api/clips" desc="Cut a clip (blocks until done)" />
              <Row m="GET" path="/api/clips" desc="Library" />
              <Row m="POST" path="/api/live" desc="Record a live stream for N seconds" />
              <Row m="GET" path="/api/tasks?stream=1" desc="SSE progress feed" />
              <Row m="GET" path="/api/frame?url=&t=" desc="Preview frame JPEG" />
              <Row m="GET" path="/api/health" desc="Binaries + data dir" />
            </tbody>
          </table>
          <p className="pt-1 text-muted">
            Base URL <code className="mono text-ink">{base}</code>
          </p>
        </div>
      )}

      {tab === "cli" && (
        <div className="space-y-2 text-xs">
          <CopyBlock
            text={`curl -s ${base}/api/probe -H 'content-type: application/json' -d '{"url":"https://youtu.be/VIDEO"}'`}
            onCopy={() => copy(`curl -s ${base}/api/probe -H 'content-type: application/json' -d '{"url":"https://youtu.be/VIDEO"}'`, "c1")}
            copied={copied === "c1"}
            multiline
          />
          <CopyBlock
            text={`curl -s ${base}/api/clips -H 'content-type: application/json' -d '{"source":"https://youtu.be/VIDEO","start":"0:12","end":"0:48","aspect":"9:16","captionStyle":"bold"}'`}
            onCopy={() =>
              copy(
                `curl -s ${base}/api/clips -H 'content-type: application/json' -d '{"source":"https://youtu.be/VIDEO","start":"0:12","end":"0:48","aspect":"9:16","captionStyle":"bold"}'`,
                "c2",
              )
            }
            copied={copied === "c2"}
            multiline
          />
          <CopyBlock
            text={`curl -s ${base}/api/live -H 'content-type: application/json' -d '{"url":"https://example.com/live.m3u8","durationSec":60}'`}
            onCopy={() =>
              copy(
                `curl -s ${base}/api/live -H 'content-type: application/json' -d '{"url":"https://example.com/live.m3u8","durationSec":60}'`,
                "c3",
              )
            }
            copied={copied === "c3"}
            multiline
          />
        </div>
      )}

      <div className="mt-4 rounded-xl border border-line bg-black/30 p-3 text-[11px] text-muted">
        <p className="mb-1.5 font-semibold text-ink">Try saying to Claude:</p>
        <ul className="space-y-1">
          {PROMPTS.map((p) => (
            <li key={p} className="flex gap-1.5">
              <span className="text-brand">›</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Row({ m, path, desc }: { m: string; path: string; desc: string }) {
  const color = m === "GET" ? "text-brand-2" : "text-brand";
  return (
    <tr>
      <td className={`mono w-12 font-bold ${color}`}>{m}</td>
      <td className="mono whitespace-nowrap text-ink">{path}</td>
      <td className="text-muted">{desc}</td>
    </tr>
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
    <div className="group relative rounded-xl border border-line bg-[#070910]">
      <pre
        className={`mono overflow-x-auto p-3 pr-16 text-[11px] leading-relaxed text-emerald-200/90 ${
          multiline ? "max-h-56 whitespace-pre-wrap break-all" : "whitespace-pre-wrap break-all"
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
