#!/usr/bin/env node
/**
 * Cross-platform launcher for the ClipForge studio.
 *   node scripts/serve.mjs dev
 *   node scripts/serve.mjs start
 * Honors PORT (default 3000) and CLIPFORGE_HOST (default 0.0.0.0 so LAN /
 * container previews can reach it).
 */
import { spawn } from "node:child_process";

const mode = process.argv[2] === "start" ? "start" : "dev";
const port = process.env.PORT ?? "3000";
const hostname = process.env.CLIPFORGE_HOST ?? "0.0.0.0";

const args = [mode, "--hostname", hostname, "--port", String(port)];

const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", ...args], {
  stdio: "inherit",
  env: process.env,
});

const forward = (sig) => () => {
  child.kill(sig);
  process.exit(0);
};
process.on("SIGINT", forward("SIGINT"));
process.on("SIGTERM", forward("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
