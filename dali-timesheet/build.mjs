// Bundles the two entry points (service worker + content script) into dist/ and
// copies the static manifest alongside them. Deliberately minimal — one esbuild
// pass, no framework runtime — so the injected content bundle stays small.
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(root, "dist");
const watch = process.argv.includes("--watch");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp(resolve(root, "manifest.json"), resolve(outdir, "manifest.json"));

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  format: "iife",
  target: "chrome110",
  logLevel: "info",
  legalComments: "none",
};

const ctx = await esbuild.context({
  ...shared,
  entryPoints: {
    background: resolve(root, "src/background.ts"),
    content: resolve(root, "src/content.ts"),
  },
  outdir,
});

if (watch) {
  await ctx.watch();
  console.log("[dali-timesheet] watching…");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("[dali-timesheet] built → dist/");
}
