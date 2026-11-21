#!/usr/bin/env bash
# ClipForge setup — downloads portable ffmpeg + yt-dlp into .tools/bin.
# No sudo, no system packages, no Python knowledge required.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/.tools/bin"
mkdir -p "$BIN"

say() { printf '\033[1;35m▸\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m!\033[0m %s\n' "$*"; }

OS="$(uname -s)"
ARCH="$(uname -m)"

# ── ffmpeg ────────────────────────────────────────────────────────────────
if [ -x "$BIN/ffmpeg" ]; then
  ok "ffmpeg already present ($("$BIN/ffmpeg" -version 2>/dev/null | head -1 | cut -c1-40))"
elif command -v ffmpeg >/dev/null 2>&1; then
  ok "Using system ffmpeg: $(command -v ffmpeg)"
  ln -sf "$(command -v ffmpeg)" "$BIN/ffmpeg"
else
  say "Downloading a portable ffmpeg build…"
  case "$OS-$ARCH" in
    Linux-x86_64)   URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-linux-x64" ;;
    Linux-aarch64)  URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-linux-arm64" ;;
    Darwin-x86_64)  URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-darwin-x64" ;;
    Darwin-arm64)   URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-darwin-arm64" ;;
    MINGW*|MSYS*)   URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-win32-x64" ;;
    *)              URL="" ;;
  esac

  if [ -n "$URL" ] && curl -fL --retry 2 --connect-timeout 20 -o "$BIN/ffmpeg" "$URL"; then
    chmod +x "$BIN/ffmpeg"
    ok "ffmpeg downloaded"
  else
    rm -f "$BIN/ffmpeg"
    case "$OS" in
      Darwin) warn "Install with: brew install ffmpeg" ;;
      *)      warn "Install with: sudo apt install ffmpeg  (or your distro's package manager)" ;;
    esac
    warn "No portable build could be fetched — ClipForge will fall back to any ffmpeg on PATH."
  fi
fi

# ffprobe: prefer the npm-bundled static build, then the system binary.
if [ -x "$BIN/ffprobe" ]; then
  ok "ffprobe already present"
else
  FFPROBE_SRC="$ROOT/node_modules/@ffprobe-installer/linux-x64/ffprobe"
  case "$OS-$ARCH" in
    Darwin-arm64) FFPROBE_SRC="$ROOT/node_modules/@ffprobe-installer/darwin-arm64/ffprobe" ;;
    Darwin-x86_64) FFPROBE_SRC="$ROOT/node_modules/@ffprobe-installer/darwin-x64/ffprobe" ;;
    MINGW*|MSYS*) FFPROBE_SRC="$ROOT/node_modules/@ffprobe-installer/win32-x64/ffprobe.exe" ;;
  esac
  if [ -f "$FFPROBE_SRC" ]; then
    cp "$FFPROBE_SRC" "$BIN/ffprobe" && chmod +x "$BIN/ffprobe"
    ok "ffprobe copied from node_modules"
  elif command -v ffprobe >/dev/null 2>&1; then
    ok "Using system ffprobe: $(command -v ffprobe)"
  else
    warn "ffprobe missing — clip metadata will fall back to ffmpeg's parser."
  fi
fi

# ── yt-dlp ────────────────────────────────────────────────────────────────
# Page links (YouTube, Vimeo, Twitch, …) need yt-dlp. Try, in order:
#   1. an existing download   2. the standalone binary   3. pip / pipx   4. brew
if [ -x "$BIN/yt-dlp" ] && "$BIN/yt-dlp" --version >/dev/null 2>&1; then
  ok "yt-dlp already present ($("$BIN/yt-dlp" --version))"
elif command -v yt-dlp >/dev/null 2>&1; then
  ok "Using system yt-dlp: $(command -v yt-dlp)"
elif command -v curl >/dev/null 2>&1 && curl -fL --retry 2 --connect-timeout 20 \
      -o "$BIN/yt-dlp" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" 2>/dev/null; then
  chmod +x "$BIN/yt-dlp" && ok "yt-dlp downloaded"
elif command -v pipx >/dev/null 2>&1 && pipx install yt-dlp >/dev/null 2>&1; then
  ok "yt-dlp installed with pipx"
elif command -v pip3 >/dev/null 2>&1 && python3 -m venv "$ROOT/.venv" >/dev/null 2>&1 \
      && "$ROOT/.venv/bin/pip" install --quiet yt-dlp >/dev/null 2>&1; then
  cp "$ROOT/.venv/bin/yt-dlp" "$BIN/yt-dlp" 2>/dev/null || ln -sf "$ROOT/.venv/bin/yt-dlp" "$BIN/yt-dlp"
  sed -i.bak "1s|.*|#!$ROOT/.venv/bin/python|" "$BIN/yt-dlp" 2>/dev/null || true
  rm -f "$BIN/yt-dlp.bak"
  ok "yt-dlp installed into .venv"
elif command -v brew >/dev/null 2>&1; then
  say "Installing yt-dlp with Homebrew…" && brew install yt-dlp >/dev/null 2>&1 && ok "yt-dlp installed"
else
  warn "yt-dlp not installed. Direct MP4/HLS links still work; page links need it."
  warn "Install later:  pipx install yt-dlp   (or)   brew install yt-dlp"
fi

# ── summary ───────────────────────────────────────────────────────────────
echo
say "Tool summary"
for tool in ffmpeg ffprobe yt-dlp; do
  if [ -x "$BIN/$tool" ]; then
    printf '  %-8s %s\n' "$tool" "$("$BIN/$tool" --version 2>/dev/null | head -1 || "$BIN/$tool" -version 2>/dev/null | head -1)"
  elif command -v "$tool" >/dev/null 2>&1; then
    printf '  %-8s %s (system)\n' "$tool" "$(command -v "$tool")"
  else
    printf '  %-8s \033[1;33mnot found\033[0m\n' "$tool"
  fi
done
echo
ok "Setup complete. Start the studio with:  npm run dev"
ok "Then in another terminal:             claude mcp add clipforge -- npx -y tsx mcp/server.ts"
