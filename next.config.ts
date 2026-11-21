import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the studio to be opened from hosted preview domains / LAN addresses.
  allowedDevOrigins: ["*.e2b.app", "*.arena.ai", "*.ngrok-free.app", "*.trycloudflare.com", "localhost"],

  // Never bundle the ffprobe binary — it is resolved at runtime from disk.
  serverExternalPackages: ["@ffprobe-installer/ffprobe"],

  // Same-origin media proxy responses can be large; keep generous timeouts.
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
