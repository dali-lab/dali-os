import { randomUUID } from "node:crypto";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { markdownImageAlt, markdownImageTag } from "~/components/doc/schema/media";
import { categorize, resolveContentType } from "~/lib/file-type";
import { isBlockedUpload, isReservedUploadKey, MAX_UPLOAD_BYTES } from "~/lib/file-validation";
import { createRequestGuard, type Resolver } from "~/lib/pdf/render-guard.server";
import { putObject } from "~/lib/s3";
import { RAW_UPLOAD_PATH, rawUploadSrc } from "~/lib/upload-src";
import { parseVideoEmbed } from "~/lib/video-embed";

export const MAX_IMPORT_IMAGES = 50;
export const MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 10_000;
const CONCURRENCY = 4;

export interface ImageDeps {
  fetch: typeof fetch;
  putObject: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
  resolveHost?: Resolver;
  timeoutMs?: number;
}

export interface ImageOptions {
  uploadPrefix: string;
  maxImages: number;
  files?: Map<string, Uint8Array>;
  baseDir?: string;
  ownOrigin?: string;
  deps?: Partial<ImageDeps>;
}

export interface ImagePassResult {
  markdown: string;
  skipped: number;
  notes: string[];
}

interface MdNode {
  type: string;
  children?: MdNode[];
  position?: { start: { offset: number }; end: { offset: number } };
  url?: string;
  alt?: string | null;
  identifier?: string;
  value?: string;
}

interface Found {
  identifier?: string;
  width?: string;
  embedded?: boolean;
  alt: string;
  url: string;
  html?: boolean;
  sole: boolean;
  start: number;
  end: number;
  container: string;
  topEnd: number;
  topType: string;
}

type Outcome = { url: string; note?: string } | { fail: string };

const offsets = (node: MdNode) => ({ start: node.position!.start.offset, end: node.position!.end.offset });
const isBlank = (node: MdNode) => node.type === "text" && !node.value?.trim();

function collect(root: MdNode) {
  const found: Found[] = [];
  const definitions = new Map<string, MdNode>();
  const imageRefs = new Set<string>();
  const linkRefs = new Set<string>();

  const visit = (node: MdNode, ancestors: MdNode[]) => {
    if (node.type === "definition") definitions.set(node.identifier!, node);
    if (node.type === "linkReference") linkRefs.add(node.identifier!);
    if (node.type === "html") {
      const parent = ancestors[ancestors.length - 1]!;
      const { start: nodeStart } = offsets(node);
      const tags = [...node.value!.matchAll(/<img\b[^>]*>/gi)];
      for (const tag of tags) {
        const attributes = imageTagAttributes(tag[0]);
        if (attributes.src === undefined) continue;
        const embedded = tags.length > 1 || node.value!.trim() !== tag[0];
        const soleInParagraph =
          parent.type === "paragraph" && parent.children!.filter((child) => !isBlank(child)).length === 1;
        const start = nodeStart + tag.index!;
        found.push({
          width: attributes.width,
          embedded: embedded && parent.type === "root",
          alt: attributes.alt ?? "",
          url: attributes.src,
          html: true,
          sole: parent.type === "root" || soleInParagraph,
          start,
          end: start + tag[0].length,
          container: parent.type,
          topEnd: (ancestors[1] ?? node).position!.end.offset,
          topType: (ancestors[1] ?? node).type,
        });
      }
      return;
    }
    if (node.type === "image" || node.type === "imageReference") {
      const parent = ancestors[ancestors.length - 1]!;
      const linked = parent.type === "link" && parent.children!.length === 1;
      const wrapper = linked ? parent : node;
      const container = linked ? ancestors[ancestors.length - 2]! : parent;
      const top = ancestors[1] ?? node;
      const sole =
        container.type === "paragraph" &&
        container.children!.filter((child) => !isBlank(child)).length === 1;
      const inCell = ancestors.some((a) => a.type === "tableCell");
      found.push({
        identifier: node.type === "imageReference" ? node.identifier : undefined,
        alt: node.alt ?? "",
        url: node.url ?? "",
        sole,
        ...offsets(wrapper),
        container: inCell ? "tableCell" : container.type,
        topEnd: top.position!.end.offset,
        topType: top.type,
      });
      if (node.type === "imageReference") imageRefs.add(node.identifier!);
      return;
    }
    for (const child of node.children ?? []) visit(child, [...ancestors, node]);
  };
  visit(root, []);
  return { found, definitions, imageRefs, linkRefs };
}

function pathSegments(path: string): string[] | null {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (!out.pop()) return null;
    } else out.push(segment);
  }
  return out;
}

export function zipPath(baseDir: string, url: string): string | null {
  let path = url.split(/[?#]/)[0]!.replaceAll("\\", "/");
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  const segments = pathSegments(path.startsWith("/") ? path : `${baseDir}/${path}`);
  return segments && segments.length ? segments.join("/").normalize("NFC") : null;
}

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/svg+xml": "svg", "image/x-icon": "ico" };

function fileNameFor(rawName: string, contentType: string): string {
  const base = rawName.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^[._]+/, "") || "image";
  if (/\.[A-Za-z0-9]{2,5}$/.test(base)) return base;
  const subtype = contentType.split("/")[1]?.split(";")[0] ?? "";
  return `${base}.${EXTENSIONS[contentType] ?? (subtype.replace(/[^a-z0-9]/g, "") || "bin")}`;
}

function urlName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    return "";
  }
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };

function imageTagAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [, name, double, single] of tag.matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[name!.toLowerCase()] = (double ?? single ?? "").replace(/&(?:amp|quot|#39|lt|gt);/g, (e) => ENTITIES[e]!);
  }
  return attributes;
}

const hasScheme = (url: string) => /^[a-z][a-z0-9+.-]*:/i.test(url);

function ownUpload(url: string, ownOrigin?: string): { key: string; relative: boolean } | null {
  if (url.startsWith("//")) return null;
  let parsed: URL;
  try {
    parsed = new URL(url, "http://relative.invalid");
  } catch {
    return null;
  }
  const relative = parsed.origin === "http://relative.invalid";
  if (!relative && parsed.origin !== ownOrigin) return null;
  const key = parsed.searchParams.get("key");
  return parsed.pathname === RAW_UPLOAD_PATH && key?.startsWith("uploads/") ? { key, relative } : null;
}

async function readCapped(res: Response): Promise<Uint8Array | null> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_UPLOAD_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

class Resolution {
  private guard;
  private deps: ImageDeps;

  constructor(private options: ImageOptions) {
    this.deps = { fetch: (input, init) => fetch(input, init), putObject, ...options.deps };
    this.guard = createRequestGuard(this.deps.resolveHost);
  }

  private async upload(bytes: Uint8Array, fileName: string, contentType: string): Promise<Outcome> {
    if (bytes.length === 0) return { fail: "the file is empty" };
    if (bytes.length > MAX_UPLOAD_BYTES) return { fail: "the file is too large" };
    if (isBlockedUpload(fileName, contentType)) return { fail: "the file type is not allowed" };
    const key = `${this.options.uploadPrefix}${randomUUID()}-${fileName}`;
    try {
      await this.deps.putObject(key, bytes, contentType);
    } catch {
      return { fail: "it could not be stored" };
    }
    return { url: rawUploadSrc(key), note: "was copied into DALI" };
  }

  private async fromDataUri(url: string): Promise<Outcome> {
    const match = /^data:(image\/[a-z0-9.+-]+)(?:;[a-z0-9=.+-]+)*;base64,(.*)$/is.exec(url);
    if (!match) return { fail: "the data link is not a base64 image" };
    const contentType = match[1]!.toLowerCase();
    if (match[2]!.length > Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 4) return { fail: "the file is too large" };
    return this.upload(Buffer.from(match[2]!, "base64"), fileNameFor("image", contentType), contentType);
  }

  private async fromZip(url: string): Promise<Outcome> {
    const { files, baseDir = "" } = this.options;
    if (!files) return { fail: "there is no file to read it from" };
    const path = zipPath(baseDir, url);
    const bytes = path ? files.get(path) : undefined;
    if (!path || !bytes) return { fail: "it is not in the .zip" };
    const fileName = fileNameFor(path.split("/").pop()!, "");
    const category = categorize({ fileName });
    if (category !== "image" && category !== "video") return { fail: "it is not an image" };
    return this.upload(bytes, fileName, resolveContentType(fileName));
  }

  private async fromWeb(rawUrl: string): Promise<Outcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.timeoutMs ?? FETCH_TIMEOUT_MS);
    try {
      let current = rawUrl;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const parsed = new URL(current);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { fail: "the link type is not supported" };
        const checked = new URL(parsed);
        checked.protocol = "https:";
        if (!(await this.guard.allow(checked.toString(), "image"))) return { fail: "the address is not allowed" };
        const res = await this.deps.fetch(parsed.toString(), {
          redirect: "manual",
          signal: controller.signal,
          headers: { accept: "image/*,video/*" },
        });
        const location = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && location) {
          await res.body?.cancel().catch(() => {});
          current = new URL(location, parsed).toString();
          continue;
        }
        if (!res.ok) return { fail: `HTTP ${res.status}` };
        if (Number(res.headers.get("content-length")) > MAX_UPLOAD_BYTES) return { fail: "the file is too large" };
        const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
        const name = urlName(parsed.toString());
        const isImage = contentType.startsWith("image/");
        const isVideo = contentType.startsWith("video/") && categorize({ fileName: name }) === "video";
        if (!isImage && !isVideo) return { fail: "it is not an image" };
        const bytes = await readCapped(res);
        if (!bytes) return { fail: "the file is too large" };
        return await this.upload(bytes, fileNameFor(name, contentType), contentType);
      }
      return { fail: "it redirected too many times" };
    } catch {
      return { fail: controller.signal.aborted ? "it timed out" : "the request failed" };
    } finally {
      clearTimeout(timer);
    }
  }

  async resolve(rawUrl: string): Promise<Outcome> {
    const url = rawUrl.trim();
    const own = ownUpload(url, this.options.ownOrigin);
    if (own) {
      if (isReservedUploadKey(own.key)) return { fail: "it is not available" };
      return { url: own.relative ? url : rawUploadSrc(own.key) };
    }
    if (/^data:/i.test(url)) return this.fromDataUri(url);
    if (url.startsWith("//")) return this.fromWeb(`https:${url}`);
    if (!hasScheme(url)) return this.fromZip(url);
    if (!/^https?:/i.test(url)) return { fail: "the link type is not supported" };
    return parseVideoEmbed(url) ? { url } : this.fromWeb(url);
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const needsWork = (url: string, ownOrigin?: string) => {
  const trimmed = url.trim();
  const own = ownUpload(trimmed, ownOrigin);
  return !(own && !isReservedUploadKey(own.key)) && !(/^https?:/i.test(trimmed) && parseVideoEmbed(trimmed));
};

const markdownUrl = (url: string) => (/[\s()<>]/.test(url) ? `<${url.replace(/</g, "%3C").replace(/>/g, "%3E")}>` : url);
const imageText = (alt: string, url: string) => `![${markdownImageAlt(alt)}](${markdownUrl(url)})`;

function linkText(alt: string, url: string): string {
  const label = markdownImageAlt(alt) || markdownImageAlt(urlName(url)) || url;
  return `[${label}](${markdownUrl(url)})`;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * Brings every image in a Markdown document into DALI: uploads data, zip and external images, moves
 * images out of sentences and table cells into their own blocks, and unwraps linked and
 * reference-style images. The text is edited by source offset, so everything else is untouched.
 */
export async function rewriteMarkdownImages(markdown: string, options: ImageOptions): Promise<ImagePassResult> {
  if (!/!\[|<img\b/i.test(markdown)) return { markdown, skipped: 0, notes: [] };
  const root = unified().use(remarkParse).use(remarkGfm).parse(markdown) as unknown as MdNode;
  const { found, definitions, imageRefs, linkRefs } = collect(root);
  const images = found
    .map((image) => ({ ...image, url: image.identifier ? definitions.get(image.identifier)?.url ?? "" : image.url }))
    .filter((image) => image.url !== "" || !image.identifier);
  if (images.length === 0) return { markdown, skipped: 0, notes: [] };

  const resolution = new Resolution(options);
  let budget = options.maxImages;
  const queue = images.map((image) => ({
    image,
    allowed: !needsWork(image.url, options.ownOrigin) || budget-- > 0,
    outcome: undefined as Outcome | undefined,
  }));
  await mapLimit(queue, CONCURRENCY, async (entry) => {
    entry.outcome = entry.allowed
      ? await resolution.resolve(entry.image.url)
      : { fail: `the limit of ${options.maxImages} images was reached` };
  });

  const notes: string[] = [];
  let skipped = 0;
  const edits: Edit[] = [];
  const appended = new Map<number, string[]>();
  for (const { image, outcome } of queue) {
    const label = image.alt || "image";
    let text = "";
    let keepTag = false;
    if ("url" in outcome!) {
      text = image.html || image.width ? markdownImageTag(outcome.url, image.alt, image.width) : imageText(image.alt, outcome.url);
      if (outcome.note) notes.push(`Image "${label}" ${outcome.note}`);
    } else {
      skipped++;
      const web = /^https?:/i.test(image.url.trim());
      keepTag = web && !!image.embedded;
      if (web) text = linkText(image.alt, image.url.trim());
      notes.push(
        `Image "${label}" could not be ${web ? "fetched" : "added"} (${outcome!.fail}) and was ${web ? (keepTag ? "kept as it was" : "written as a link") : "left out"}`,
      );
    }
    if (keepTag) continue;
    if (image.sole) {
      const unchanged = image.html
        ? "url" in outcome! && outcome.url === image.url
        : !image.identifier && text === markdown.slice(image.start, image.end);
      if (unchanged) continue;
      edits.push({ start: image.start, end: image.end, text });
      continue;
    }
    const where = image.container === "tableCell" ? "a table cell" : image.container === "paragraph" ? "a paragraph" : "text";
    notes.push(`Image "${label}" was inside ${where} and was moved to its own block after ${image.topType === "table" ? "the table" : "it"}`);
    edits.push({ start: image.start, end: image.end, text: "" });
    if (text) appended.set(image.topEnd, [...(appended.get(image.topEnd) ?? []), text]);
  }
  for (const [at, texts] of appended) edits.push({ start: at, end: at, text: texts.map((t) => `\n\n${t}`).join("") });
  for (const [id, def] of definitions) {
    if (!imageRefs.has(id) || linkRefs.has(id)) continue;
    const { start, end } = offsets(def);
    edits.push({ start, end: markdown[end] === "\n" ? end + 1 : end, text: "" });
  }

  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let cursor = 0;
  for (const edit of edits) {
    if (edit.start < cursor) continue;
    out += markdown.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return { markdown: out + markdown.slice(cursor), skipped, notes };
}
