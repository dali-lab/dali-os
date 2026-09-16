#!/usr/bin/env bash
# Builds the Chrome Web Store upload zip: dist/jobx-extension-<version>.zip
# Only ships what the extension loads — no README, no dist, no dotfiles.
set -euo pipefail
cd "$(dirname "$0")"

version=$(node -p "require('./manifest.json').version")
out="dist/jobx-extension-${version}.zip"

rm -rf dist && mkdir -p dist
zip -qr "$out" manifest.json background.js content.js popup.html popup.js icons -x '.*' -x '__MACOSX/*'

echo "$out"
unzip -l "$out"
