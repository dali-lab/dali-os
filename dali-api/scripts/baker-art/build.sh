#!/bin/sh
# Regenerates the alumni Home art (app/assets/landing/baker/<season>-<day|night>.svg).
# The clock hands are drawn live by BakerHero, so they are stripped from the files.
set -e
cd "$(dirname "$0")"
python3 -I tower.py 4 10 base-day.svg
python3 -I tower.py 11 40 base-night.svg
python3 -I seasons.py
for f in p-*.svg; do
  n=${f#p-}
  sed -E 's#<line x1="0" y1="0"[^>]*stroke-linecap="round"/>##g' "$f" > "../../app/assets/landing/baker/$n"
done
rm -f base-day.svg base-night.svg p-*.svg tower-*.svg
