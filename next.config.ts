import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the studio to be opened from hosted preview domains / LAN addresses.
  allowedDevOrigins: ["*.e2b.app", "*.arena.ai", "*.ngrok-free.app", "*.trycloudflare.com", "localhost"],

  // Never bundle the ffprobe binary — it is resolved at runtime from disk.
  serverExternalPackages: ["@ffprobe-installer/ffprobe"],

  // The service report is a standalone HTML file served from public/docs/.
  async rewrites() {
    return [{ source: "/report", destination: "/docs/report.html" }];
  },
};

export default nextConfig;
