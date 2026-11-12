#!/usr/bin/env node
// Moves domain clusters out of app/lib. Rerunnable on a clean, fresh staging checkout:
//   node dali-api/scripts/codemods/move-lib-domains.mjs            (one commit per cluster)
//   node dali-api/scripts/codemods/move-lib-domains.mjs --no-commit
//   node dali-api/scripts/codemods/move-lib-domains.mjs --only=wallet,rooms
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.chdir(ROOT);
const args = process.argv.slice(2);
const COMMIT = !args.includes("--no-commit");
const ONLY = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
const TRAILER = "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>";

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28 }).trim();

// [old stem in app/lib, new stem]; a bare string keeps its name. Both .ts and .tsx are looked up.
const CLUSTERS = [
  {
    name: "wallet",
    dir: "app/wallet/lib",
    files: [
      "wallet-apns.server", "wallet-apple.server", "wallet-broadcast.server", "wallet-google.server",
      "wallet-pass-fields.server", "wallet-scan.server", ["wallet-token", "wallet-token.server"],
    ],
    extraTests: { "app/lib/wallet-token.test.ts": "app/wallet/lib/__tests__/wallet-token.server.auth-token.test.ts" },
  },
  { name: "rooms", dir: "app/rooms/lib", files: ["rooms.server", "room-display.server"] },
  {
    name: "forms",
    dir: "app/forms/lib",
    files: ["form-answers", "form-logic", "form-pages"],
    extraTests: {
      "app/lib/__tests__/form-access.server.can-create.test.ts": "app/forms/lib/__tests__/form-access.server.can-create.test.ts",
    },
  },
  {
    name: "blog",
    dir: "app/blog/lib",
    files: ["blog-ai", "blog-engagement", "blog-engagement.server", "blog-post.server", "blog-preview"],
  },
  {
    name: "calendar-infra",
    dir: "app/calendar/lib",
    files: [
      ["google-calendar", "google-calendar.server"], "general-calendar", ["calendar-crypto", "calendar-crypto.server"],
      "calendar-schemas", ["availability", "availability.server"], "time-entries.server", "timesheet-mirror.server",
    ],
  },
  {
    name: "notebooks",
    dir: "app/calendar/lib",
    files: [
      "notebooks.server", "notebook-choice", "notebook-suggest", "notebook-default.server", "notebook-listing.server",
      "notebook-series.server", ["meeting-notebook", "meeting-notebook.server"],
    ],
  },
  {
    name: "meetings",
    dir: "app/calendar/lib",
    files: [
      ["scheduled-meeting", "scheduled-meeting.server"], "meeting-occurrences", "meeting-optimizer", "meeting-shares.server",
      "meeting-note-template", "upcoming-meetings.server", ["upcoming-meetings", "upcoming-meetings-list.server"],
    ],
  },
  {
    name: "meeting-recording",
    dir: "app/calendar/lib",
    files: [
      "meeting-recording.server", "meeting-transcript", "meeting-notes-apply.server", "meeting-notes-enhance.server",
      "meeting-notes-verify",
    ],
  },
  {
    name: "drive",
    dir: "app/drive/lib",
    files: [
      "drive-roots", "drive-roots.server", "drive-receivers", "drive-receivers.server", "drive-spaces", "drive-tags",
      "drive-crumbs", "drive-crumbs.server", "drive-notices", "drive-scopes.server", "drive-shared.server",
      "drive-counts.server", "drive-hub.server", "drive-download.server", "drive-reveal.server", "drive-templates.server",
      "drive-page-trail.server", "drive.server", "page-href", "page-link", "page-title", "page-scroll", "page-typography",
      "page-audience", "page-audience.server", "page-names.server", "page-templates.server", "page-copy.server",
      "page-move.server", "page-ancestry.server", ["page-doc-sections", "page-doc-sections.server"],
    ],
    extraSources: { "app/lib/drive-page-trail.tsx": "app/components/drive/drive-page-trail.tsx" },
  },
];

const stripExt = (f) => f.replace(/\.(tsx?|mjs|js)$/, "");
const exists = (f) => fs.existsSync(f);
function findSource(stem) {
  for (const ext of [".ts", ".tsx"]) if (exists(`app/lib/${stem}${ext}`)) return `app/lib/${stem}${ext}`;
  throw new Error(`missing app/lib/${stem}.ts(x)`);
}

function planCluster(cluster) {
  const moves = new Map();
  const add = (from, to) => {
    if (exists(to) || [...moves.values()].includes(to)) throw new Error(`target exists: ${to}`);
    moves.set(from, to);
  };
  const entries = cluster.files.map((f) => (Array.isArray(f) ? f : [f, f]));
  for (const [oldStem, newStem] of entries) {
    const from = findSource(oldStem);
    add(from, `${cluster.dir}/${newStem}${path.extname(from)}`);
  }
  for (const [from, to] of Object.entries(cluster.extraSources ?? {})) add(from, to);

  const tests = [];
  for (const d of ["app/lib/__tests__", "app/lib"]) {
    for (const f of fs.readdirSync(d)) if (/\.test\.tsx?$/.test(f)) tests.push(`${d}/${f}`);
  }
  const extra = cluster.extraTests ?? {};
  for (const [from, to] of Object.entries(extra)) add(from, to);
  for (const t of tests) {
    if (extra[t] || [...moves.keys()].includes(t)) continue;
    const base = path.basename(t);
    const T = base.replace(/\.test\.tsx?$/, "");
    const ext = base.slice(T.length);
    let best = null;
    for (const [oldStem, newStem] of entries) {
      if (oldStem === T) { best = { oldStem, newStem, exact: true }; break; }
      const B = oldStem.replace(/\.server$/, "");
      if (T === B || T.startsWith(`${B}.`) || T.startsWith(`${B}-`)) {
        if (!best || B.length > best.B.length) best = { oldStem, newStem, B };
      }
    }
    if (!best) continue;
    if (path.dirname(t) === "app/lib") continue;
    let rest = best.exact ? "" : T.slice(best.B.length);
    let nb = best.newStem;
    if (rest.startsWith("-") || rest.includes(".server")) nb = nb.replace(/\.server$/, "");
    add(t, `${cluster.dir}/__tests__/${nb}${rest}${ext}`);
  }
  return moves;
}

function trackedCode() {
  return git("ls-files", "--", "*.ts", "*.tsx", "*.mts", "*.mjs", "*.js")
    .split("\n")
    .filter((f) => f && !f.startsWith("app/generated/") && !f.includes("node_modules/"));
}

const SPEC_RE = /(["'])((?:~\/|\.\.?\/)[^"'\n]*)\1/g;
const CANDIDATE_EXTS = ["", ".ts", ".tsx", ".mjs", ".js"];

function resolveOld(base, moves) {
  const noJs = base.replace(/\.js$/, "");
  for (const c of [base, ...CANDIDATE_EXTS.slice(1).map((e) => noJs + e)]) {
    if (moves.has(c) || (exists(c) && fs.statSync(c).isFile())) return c;
  }
  return null;
}

function newSpecifier(orig, fromNew, target) {
  const hadJs = orig.endsWith(".js");
  const hadExt = /\.(tsx?|mjs)$/.test(orig);
  let t = target;
  if (!hadExt && !hadJs) t = stripExt(t);
  else if (hadJs) t = stripExt(t) + ".js";
  if (orig.startsWith("~/")) return "~/" + t.replace(/^app\//, "");
  let rel = path.posix.relative(path.posix.dirname(fromNew), t);
  if (!rel.startsWith(".")) rel = "./" + rel;
  if (rel.startsWith("../../") && t.startsWith("app/") && fromNew.startsWith("app/")) return "~/" + t.replace(/^app\//, "");
  return rel;
}

function rewriteImports(moves) {
  const reverse = new Map([...moves].map(([a, b]) => [b, a]));
  let changed = 0;
  for (const file of trackedCode()) {
    if (!exists(file)) continue;
    const oldLoc = reverse.get(file) ?? file;
    const src = fs.readFileSync(file, "utf8");
    const out = src.replace(SPEC_RE, (m, q, spec) => {
      const base = spec.startsWith("~/")
        ? "app/" + spec.slice(2)
        : path.posix.normalize(path.posix.join(path.posix.dirname(oldLoc), spec));
      const resolved = resolveOld(base, moves);
      if (!resolved) return m;
      const target = moves.get(resolved) ?? resolved;
      if (target === resolved && oldLoc === file) return m;
      if (/\/index\.tsx?$/.test(resolved) && !/index(\.\w+)?$/.test(spec)) return m;
      const next = newSpecifier(spec, file, target);
      return next === spec ? m : `${q}${next}${q}`;
    });
    if (out !== src) {
      fs.writeFileSync(file, out);
      changed++;
    }
  }
  return changed;
}

function shrinkAllowlist(moved) {
  const f = "app/__tests__/architecture.test.ts";
  const lines = fs.readFileSync(f, "utf8").split("\n");
  const gone = new Set(moved.map((m) => m.replace(/\.tsx?$/, "")));
  const keep = lines.filter((l) => {
    const m = l.match(/^\s*"(app\/lib\/[^"]+?)\.tsx? -> /);
    return !(m && gone.has(m[1]));
  });
  fs.writeFileSync(f, keep.join("\n"));
}

const STALE_TWO_WAY = ["admin <-> core"];
const NEW_TWO_WAY = ["calendar <-> drive", "drive <-> education", "hiring <-> rooms"];

function addTwoWayEntries() {
  const f = "app/__tests__/architecture.test.ts";
  const lines = fs.readFileSync(f, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("const TWO_WAY_DOMAIN_ALLOWLIST"));
  const end = lines.findIndex((l, i) => i > start && l === "];");
  const entries = lines.slice(start + 1, end).filter((l) => !STALE_TWO_WAY.includes(l.match(/"([^"]+)"/)?.[1]));
  const known = new Set(entries.map((l) => l.match(/"([^"]+)"/)?.[1]));
  for (const e of NEW_TWO_WAY) if (!known.has(e)) entries.push(`  "${e}", // surfaced by the domain moves; split or redirect-table follow-up`);
  entries.sort((a, b) => a.match(/"([^"]+)"/)[1].localeCompare(b.match(/"([^"]+)"/)[1]));
  lines.splice(start + 1, end - start - 1, ...entries);
  fs.writeFileSync(f, lines.join("\n"));
}

if (git("status", "--porcelain", "--", ".")) {
  console.error("working tree under dali-api is not clean; commit or stash first");
  process.exit(1);
}

const allMoved = [];
for (const cluster of CLUSTERS) {
  if (ONLY.length && !ONLY.includes(cluster.name)) continue;
  const moves = planCluster(cluster);
  for (const [from, to] of moves) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    git("mv", from, to);
    allMoved.push(from);
  }
  const changed = rewriteImports(moves);
  console.log(`${cluster.name}: ${moves.size} files moved, ${changed} files rewritten`);
  for (const [a, b] of moves) console.log(`  ${a} -> ${b}`);
  if (COMMIT) {
    git("add", "-A", ".");
    git("commit", "-m", `Move ${cluster.name} out of app/lib into ${cluster.dir}\n\nGenerated by scripts/codemods/move-lib-domains.mjs.\n\n${TRAILER}`);
  }
}
shrinkAllowlist(allMoved);
addTwoWayEntries();
if (COMMIT) {
  git("add", "-A", ".");
  git("commit", "-m", `Update the architecture guard allowlists for the moved files\n\n${TRAILER}`);
}
