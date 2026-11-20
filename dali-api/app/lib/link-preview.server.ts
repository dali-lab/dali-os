import { isIP } from "node:net";
import { isPrivateAddress } from "~/lib/pdf/render-guard.server";
import { pinnedRequest } from "~/lib/safe-fetch.server";

export interface LinkPreview {
  image: string | null;
  title: string | null;
  description: string | null;
}

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 4000;
const TOTAL_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const BLOCKED_SUFFIXES = [".internal", ".flycast", ".local", ".localhost", ".localdomain", ".lan", ".home.arpa"];

export function isFetchableUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host || BLOCKED_SUFFIXES.some((s) => host === s.slice(1) || host.endsWith(s))) return null;
  if (isIP(host.replace(/^\[|\]$/g, "")) && isPrivateAddress(host.replace(/^\[|\]$/g, ""))) return null;
  return url;
}

const REQUEST_HEADERS = { "user-agent": "Mozilla/5.0 (compatible; DALI-OS link preview)", accept: "text/html,application/xhtml+xml" };

async function get(url: URL, signal: AbortSignal): Promise<{ status: number; location: string | null; contentType: string; body: string }> {
  const res = await pinnedRequest(url, { headers: REQUEST_HEADERS, timeoutMs: TIMEOUT_MS, signal });
  const status = res.statusCode ?? 0;
  const location = typeof res.headers.location === "string" ? res.headers.location : null;
  const contentType = String(res.headers["content-type"] ?? "");
  if (status >= 300 && status < 400) {
    res.resume();
    return { status, location, contentType, body: "" };
  }
  if (!/text\/html|application\/xhtml/i.test(contentType)) {
    res.resume();
    return { status, location: null, contentType, body: "" };
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const done = () => resolve({ status, location: null, contentType, body: Buffer.concat(chunks).toString("utf8") });
    res.on("data", (c: Buffer) => {
      size += c.length;
      chunks.push(c);
      if (size >= MAX_BYTES) {
        res.destroy();
        done();
      }
    });
    res.on("end", done);
    res.on("error", reject);
    signal.addEventListener("abort", () => reject(new Error("Timed out")), { once: true });
  });
}

function decode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function metaContent(html: string, keys: string[]): string | null {
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    const name = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (!name || !keys.includes(name)) continue;
    const content = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
    const value = content?.[1] ?? content?.[2];
    if (value?.trim()) return decode(value);
  }
  return null;
}

export function parseLinkPreview(html: string, pageUrl: string): LinkPreview {
  const head = html.slice(0, MAX_BYTES);
  let image: string | null = null;
  const rawImage = metaContent(head, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]);
  if (rawImage) {
    try {
      const abs = new URL(rawImage, pageUrl);
      if (abs.protocol === "https:") image = abs.toString();
    } catch {
      image = null;
    }
  }
  const title = metaContent(head, ["og:title", "twitter:title"]) ?? (/<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1] ? decode(/<title[^>]*>([^<]*)<\/title>/i.exec(head)![1]!) : null);
  const description = metaContent(head, ["og:description", "twitter:description", "description"]);
  return { image, title: title || null, description: description || null };
}

export async function fetchLinkPreview(raw: string): Promise<LinkPreview | null> {
  let url = isFetchableUrl(raw);
  if (!url) return null;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), TOTAL_TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let res;
      try {
        res = await get(url, deadline.signal);
      } catch {
        return null;
      }
      if (res.status >= 300 && res.status < 400 && res.location) {
        let next: URL | null;
        try {
          next = isFetchableUrl(new URL(res.location, url).toString());
        } catch {
          return null;
        }
        if (!next) return null;
        url = next;
        continue;
      }
      if (res.status < 200 || res.status >= 300 || !res.body) return null;
      return parseLinkPreview(res.body, url.toString());
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
