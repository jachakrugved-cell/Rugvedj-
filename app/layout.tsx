import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClipForge — free local video clipper",
  description:
    "Paste any video link — YouTube, Vimeo, Twitch, HLS, MP4 or a live stream — clip it into vertical, square or widescreen clips with captions. 100% local, free, and connected to Claude Code.",
  applicationName: "ClipForge",
  openGraph: {
    title: "ClipForge — free local video clipper",
    description:
      "Any link → any moment → a clean clip. Vertical exports, captions, live streams. Runs locally, connects to Claude Code over MCP.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
