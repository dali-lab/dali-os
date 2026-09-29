// One-off asset generator for the wallet-pass block band (the colorful DALI
// motif along the pass). Renders geometric brand tiles — colored squares each
// holding a contrasting circle, plus a couple of asterisks — on the pass navy,
// then screenshots them to PNG with Playwright (a devDependency already used for
// e2e, so nothing new ships at runtime).
//
// Run from dali-api/:  node scripts/generate-wallet-pattern.mjs
// Commit the PNGs it writes under public/. Re-run to tweak the design.

import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "..", "public");

// Pass navy — must match backgroundColor in wallet-apple.server.ts and
// hexBackgroundColor in wallet-google.server.ts so the band blends into the card.
const NAVY = "#0C2C47";

// Curated square+circle pairs in DALI brand colors (deterministic order, no
// randomness so the asset is reproducible). "*" marks an asterisk tile.
const TILES = [
  { sq: "#E68FC0", c: "#0C4A73" }, // pink / navy
  { sq: "#12557A", c: "#9FD870" }, // blue / green
  { sq: "#3F8F7A", c: "#3F8F7A", plain: true }, // solid teal-green (no circle)
  { sq: "#F7C070", c: "#0C2333" }, // orange / dark
  { sq: "#E68FC0", c: "#B24DA0" }, // pink / magenta
  "*teal",
  { sq: "#FCEFA0", c: "#0C2333" }, // yellow / dark
  { sq: "#A5DB7A", c: "#17A2A5" }, // green / teal
  { sq: "#F08B6E", c: "#F5C0A6" }, // salmon / light
  { sq: "#17A2A5", c: "#0C2333" }, // teal / dark
  { sq: "#E45163", c: "#F3A6B0" }, // red / light
  { sq: "#0C4A73", c: "#0C4A73", plain: true }, // solid navy
  { sq: "#ADE6D9", c: "#0C2333" }, // mint / dark
  { sq: "#FFFFFF", c: "#0C2C47" }, // white / navy
  { sq: "#FCEFA0", c: "#E9C64A" }, // yellow / gold
  "*yellow",
  { sq: "#E68FC0", c: "#C24DA8" }, // pink / magenta
  { sq: "#12557A", c: "#12557A", plain: true }, // solid blue
];

function asterisk(color, size) {
  // Six-armed asterisk built from three rotated bars (an original geometric mark).
  const bar = `<div style="position:absolute;top:50%;left:50%;width:${size * 0.72}px;height:${size * 0.16}px;background:${color};border-radius:${size * 0.08}px;transform:translate(-50%,-50%) rotate(ROT);"></div>`;
  return [0, 60, 120].map((r) => bar.replace("ROT", `${r}deg`)).join("");
}

function tileHtml(tile, size) {
  if (tile === "*teal" || tile === "*yellow") {
    const color = tile === "*teal" ? "#7FD4CE" : "#FCEFA0";
    return `<div style="position:relative;width:${size}px;height:${size}px;background:${NAVY};">
      <div style="position:absolute;inset:0;">${asterisk(color, size)}</div>
    </div>`;
  }
  const circle = tile.plain
    ? ""
    : `<div style="position:absolute;top:50%;left:50%;width:${size * 0.52}px;height:${size * 0.52}px;background:${tile.c};border-radius:50%;transform:translate(-50%,-50%);"></div>`;
  return `<div style="position:relative;width:${size}px;height:${size}px;background:${tile.sq};">${circle}</div>`;
}

function buildHtml(width, height, rows, bandFrac, anchor) {
  const bandHeight = Math.round(height * bandFrac);
  const size = Math.ceil(bandHeight / rows);
  const cols = Math.ceil(width / size) + 1;
  let cells = "";
  let i = 0;
  for (let r = 0; r < rows; r++) {
    let row = "";
    for (let c = 0; c < cols; c++) {
      // Offset each row's starting tile so columns don't line up identically.
      row += tileHtml(TILES[(i + r * 3) % TILES.length], size);
      i++;
    }
    cells += `<div style="display:flex;">${row}</div>`;
  }
  const justify = anchor === "top" ? "flex-start" : "flex-end";
  return `<!doctype html><html><body style="margin:0;">
    <div style="width:${width}px;height:${height}px;background:${NAVY};overflow:hidden;display:flex;flex-direction:column;justify-content:${justify};">
      ${cells}
    </div>
  </body></html>`;
}

const TARGETS = [
  // Apple storeCard strip (3.05:1). One tile row anchored to the TOP; navy fills
  // the lower ~45%. The primary field (member name) overlays the strip's
  // lower-left, so navy has to back the name for it to stay legible.
  { file: "wallet-strip.png", w: 375, h: 123, rows: 1, bandFrac: 0.55, anchor: "top" },
  { file: "wallet-strip-2x.png", w: 750, h: 246, rows: 1, bandFrac: 0.55, anchor: "top" },
  { file: "wallet-strip-3x.png", w: 1125, h: 369, rows: 1, bandFrac: 0.55, anchor: "top" },
  // Google Wallet hero banner (~3.07:1) — two full tile rows on navy (no text overlays it).
  { file: "wallet-hero.png", w: 1032, h: 336, rows: 2, bandFrac: 1, anchor: "bottom" },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of TARGETS) {
  await page.setViewportSize({ width: t.w, height: t.h });
  await page.setContent(buildHtml(t.w, t.h, t.rows, t.bandFrac, t.anchor), { waitUntil: "load" });
  await page.screenshot({ path: path.join(PUBLIC, t.file), clip: { x: 0, y: 0, width: t.w, height: t.h } });
  console.log("wrote", t.file, `${t.w}x${t.h}`);
}
await browser.close();
