// Turns a lab's files into one runnable HTML document for a sandboxed iframe
// (no allow-same-origin, so learner code can't reach the app's cookies or DOM).
// The frames report back over postMessage, tagged with LAB_MESSAGE_SOURCE and
// the run id so a stale frame's messages are ignored.

import type { LabFiles, LabStep } from "./types";
import { ENTRY_FILE } from "./file-tree";

export const LAB_MESSAGE_SOURCE = "dali-lab";

const IMPORT_PATTERN =
  /(import\s+(?:[\w*{}\s,$]+\s+from\s+)?|export\s+[\w*{}\s,$]+\s+from\s+|import\s*\(\s*)(['"])([^'"]+)\2/g;

function escapeTag(code: string, tag: "script" | "style"): string {
  return code.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function resolvePath(fromFile: string, spec: string): string {
  const raw = spec.startsWith("/") ? spec.slice(1) : [dirname(fromFile), spec].filter(Boolean).join("/");
  const out: string[] = [];
  for (const seg of raw.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

function findFile(files: LabFiles, path: string): string | null {
  const candidates = [path, `${path}.js`, `${path}.mjs`, `${path}/index.js`];
  return candidates.find((c) => c in files) ?? null;
}

function isExternal(spec: string): boolean {
  return /^(https?:|data:|blob:|\/\/)/i.test(spec);
}

/** A JS module (and everything it imports) as a self-contained data: URL. */
function moduleUrl(files: LabFiles, path: string, cache: Map<string, string>, stack: Set<string>): string {
  const cached = cache.get(path);
  if (cached) return cached;
  if (stack.has(path)) throw new Error(`Circular import involving ${path} isn't supported in labs.`);
  stack.add(path);
  const code = files[path].replace(IMPORT_PATTERN, (match, prefix: string, quote: string, spec: string) => {
    if (isExternal(spec)) return match;
    if (!spec.startsWith(".") && !spec.startsWith("/")) return `${prefix}${quote}https://esm.sh/${spec}${quote}`;
    const target = findFile(files, resolvePath(path, spec));
    if (!target) return match;
    return `${prefix}${quote}${moduleUrl(files, target, cache, stack)}${quote}`;
  });
  stack.delete(path);
  // encodeURIComponent leaves ' alone, and the URL is spliced back into a
  // quoted import specifier, so a quote in the module would end it early.
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(`${code}\n//# sourceURL=${path}`).replace(/'/g, "%27")}`;
  cache.set(path, url);
  return url;
}

function consoleBridge(runId: number): string {
  return `(function(){var RUN=${runId};function fmt(a){try{if(typeof a==='string')return a;if(a instanceof Error)return a.name+': '+a.message;if(typeof Element!=='undefined'&&a instanceof Element)return '<'+a.tagName.toLowerCase()+'>';if(typeof a==='function')return 'function '+(a.name||'anonymous');var j=JSON.stringify(a);return j===undefined?String(a):j}catch(e){return String(a)}}function send(level,args){parent.postMessage({source:'${LAB_MESSAGE_SOURCE}',runId:RUN,type:'console',level:level,text:Array.prototype.map.call(args,fmt).join(' ')},'*')}['log','info','warn','error'].forEach(function(l){var o=console[l];console[l]=function(){send(l,arguments);o.apply(console,arguments)}});window.addEventListener('error',function(e){var f=(e.filename||'').indexOf('data:')===0?'':(e.filename||'');send('error',[e.message+(e.lineno?' (line '+e.lineno+')':'')+(f?' in '+f:'')])});window.addEventListener('unhandledrejection',function(e){send('error',['Unhandled promise rejection: '+fmt(e.reason)])})})();`;
}

function checkRunner(runId: number, steps: LabStep[]): string {
  const tests = JSON.stringify(steps.map((s) => ({ id: s.id, test: s.check }))).replace(/</g, "\\u003c");
  return `(function(){var RUN=${runId};var tests=${tests};function evaluate(){var results={};tests.forEach(function(t){try{results[t.id]=!!(new Function('return ('+t.test+');'))()}catch(e){results[t.id]=false}});parent.postMessage({source:'${LAB_MESSAGE_SOURCE}',runId:RUN,type:'checks',results:results},'*')}if(document.readyState==='complete'){setTimeout(evaluate,120)}else{window.addEventListener('load',function(){setTimeout(evaluate,120)})}})();`;
}

interface BuildOptions {
  runId: number;
  mode: "preview" | "test";
  steps?: LabStep[];
}

/**
 * index.html is the entry. Local stylesheet links and script srcs are inlined;
 * module scripts can import each other by relative path and bare specifiers
 * load from esm.sh. A fragment index.html with no links or scripts gets every
 * .css and .js file included automatically.
 */
export function buildLabDocument(files: LabFiles, { runId, mode, steps = [] }: BuildOptions): string {
  const html = files[ENTRY_FILE] ?? "<p>Add an index.html file to see a preview.</p>";
  const cache = new Map<string, string>();
  const paths = Object.keys(files).sort();

  let body = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel=["']?stylesheet/i.test(tag)) return tag;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href || isExternal(href)) return tag;
    const target = resolvePath(ENTRY_FILE, href);
    if (!(target in files)) return tag;
    return `<style data-file="${target}">${escapeTag(files[target], "style")}</style>`;
  });

  body = body.replace(
    /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    (tag, before: string, src: string, after: string) => {
      if (isExternal(src)) return tag;
      const target = findFile(files, resolvePath(ENTRY_FILE, src));
      if (!target) return `<script>console.error(${JSON.stringify(`Couldn't find ${src}`)})</script>`;
      if (/type=["']?module/i.test(before + after)) {
        try {
          return `<script type="module" src="${moduleUrl(files, target, cache, new Set())}"></script>`;
        } catch (err) {
          return `<script>console.error(${JSON.stringify((err as Error).message)})</script>`;
        }
      }
      return `<script>${escapeTag(files[target], "script")}\n//# sourceURL=${target}</script>`;
    },
  );

  const autoCss = /<link\b[^>]*stylesheet/i.test(html)
    ? ""
    : paths
        .filter((p) => p.endsWith(".css"))
        .map((p) => `<style data-file="${p}">${escapeTag(files[p], "style")}</style>`)
        .join("");
  const autoJs = /<script\b/i.test(html)
    ? ""
    : paths
        .filter((p) => /\.(m?js)$/.test(p))
        .map((p) => `<script>${escapeTag(files[p], "script")}\n//# sourceURL=${p}</script>`)
        .join("");

  const headInject = `<meta charset="utf-8">${mode === "preview" ? `<script>${consoleBridge(runId)}</script>` : ""}${autoCss}`;
  const tailInject = `${autoJs}${mode === "test" ? `<script>${checkRunner(runId, steps)}</script>` : ""}`;

  if (/<html[\s>]|<head[\s>]|<body[\s>]/i.test(html)) {
    let doc = /<head[^>]*>/i.test(body) ? body.replace(/<head[^>]*>/i, (m) => m + headInject) : headInject + body;
    doc = /<\/body>/i.test(doc) ? doc.replace(/<\/body>/i, `${tailInject}</body>`) : doc + tailInject;
    return doc;
  }
  return `<!doctype html><html><head>${headInject}</head><body>${body}${tailInject}</body></html>`;
}
