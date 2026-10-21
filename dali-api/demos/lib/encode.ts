// Turns Playwright's demo recordings (demo-results/<test dir>/video.webm) into
// demo-out/<file>.mp4 + <file>.jpg. Run from dali-api/: npx tsx demos/lib/encode.ts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const IN_DIR = 'demo-results';
const OUT_DIR = 'demo-out';
const MAX_BYTES = 3 * 1024 * 1024;

const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

// Playwright trims test directory names to 60 characters, which can cut the demo's
// file name out, so the fixture in demo.ts writes it next to the video instead.
export const DEMO_NAME_FILE = 'demo-name';

export function demoBaseName(testFile: string): string {
  return basename(testFile).replace(/\.demo\.ts$/, '');
}

// A second test in the same file gets a numeric suffix so outputs never overwrite each other.
export function demoName(base: string, seen: Map<string, number>): string {
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

function main() {
  if (!existsSync(IN_DIR)) throw new Error(`${IN_DIR}/ not found: run the demos first`);
  mkdirSync(OUT_DIR, { recursive: true });
  const seen = new Map<string, number>();
  let count = 0;
  for (const dir of readdirSync(IN_DIR).sort()) {
    const webm = join(IN_DIR, dir, 'video.webm');
    const nameFile = join(IN_DIR, dir, DEMO_NAME_FILE);
    if (!existsSync(webm) || !existsSync(nameFile)) continue;
    const name = demoName(readFileSync(nameFile, 'utf8').trim(), seen);
    const mp4 = join(OUT_DIR, `${name}.mp4`);
    ffmpeg([
      '-i', webm,
      '-c:v', 'libx264', '-crf', '28', '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
      mp4,
    ]);
    ffmpeg(['-ss', '1', '-i', mp4, '-frames:v', '1', '-q:v', '3', join(OUT_DIR, `${name}.jpg`)]);
    const size = statSync(mp4).size;
    console.log(`${name}.mp4  ${(size / 1024).toFixed(0)} KB`);
    if (size > MAX_BYTES) console.warn(`::warning::${name}.mp4 is over 3 MB: shorten the demo`);
    count++;
  }
  if (count === 0) throw new Error(`No recordings found in ${IN_DIR}/`);
}

if (process.argv[1]?.endsWith('encode.ts')) main();
