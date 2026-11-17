import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { isPrivateAddress } from "~/lib/pdf/render-guard.server";
import { putObject } from "~/lib/s3.server";

export type ResolvedJobLink = {
  url: string;
  companyName: string | null;
  companyDomain: string | null;
  role: string | null;
  location: string | null;
  jobType: string | null;
  logoSourceUrl: string | null;
};

export type JobLinkDeps = {
  fetch?: typeof fetch;
  lookup?: (host: string) => Promise<{ address: string }[]>;
};

export type CopyLogoDeps = JobLinkDeps & {
  putObject?: typeof putObject;
  uuid?: () => string;
};

export type LinkStatus = "alive" | "dead" | "unknown";

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 5000;
export const MAX_HTML_BYTES = 1024 * 1024;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const JOB_SITE_HOSTS = [
  "ashbyhq.com",
  "greenhouse.io",
  "lever.co",
  "myworkdayjobs.com",
  "smartrecruiters.com",
  "workable.com",
  "linkedin.com",
];

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

const hostMatches = (host: string, suffix: string) => host === suffix || host.endsWith(`.${suffix}`);
export const isJobSiteHost = (host: string) => JOB_SITE_HOSTS.some((s) => hostMatches(host, s));

const defaultLookup = (host: string) => dnsLookup(host, { all: true });

async function isSafeUrl(raw: string, deps: JobLinkDeps): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isPrivateAddress(host) ? null : url;
  try {
    const addrs = await (deps.lookup ?? defaultLookup)(host);
    if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) return null;
  } catch {
    return null;
  }
  return url;
}

type Fetched = { url: string; status: number; contentType: string; bytes: Uint8Array };

async function readCapped(res: Response, maxBytes: number, truncate: boolean): Promise<Uint8Array | null> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length <= maxBytes) return buf;
    return truncate ? buf.slice(0, maxBytes) : null;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      if (!truncate) return null;
      chunks.push(value.slice(0, value.length - (total - maxBytes)));
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function safeFetch(
  raw: string,
  deps: JobLinkDeps,
  opts: { maxBytes: number; truncate: boolean; readBody?: boolean; accept?: string },
): Promise<Fetched | null> {
  const doFetch = deps.fetch ?? fetch;
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await isSafeUrl(current, deps);
    if (!url) return null;
    let res: Response;
    try {
      res = await doFetch(url.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: opts.accept ?? "text/html,application/json;q=0.9,*/*;q=0.5", "user-agent": "Mozilla/5.0 (compatible; DALIBot/1.0)" },
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      try {
        current = new URL(res.headers.get("location")!, url).href;
      } catch {
        return null;
      }
      continue;
    }
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (opts.readBody === false || res.status >= 400) {
      await res.body?.cancel().catch(() => {});
      return { url: url.href, status: res.status, contentType, bytes: new Uint8Array() };
    }
    try {
      const bytes = await readCapped(res, opts.maxBytes, opts.truncate);
      return bytes ? { url: url.href, status: res.status, contentType, bytes } : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchText(raw: string, deps: JobLinkDeps): Promise<{ url: string; text: string } | null> {
  const res = await safeFetch(raw, deps, { maxBytes: MAX_HTML_BYTES, truncate: true });
  if (!res || res.status >= 400) return null;
  return { url: res.url, text: new TextDecoder().decode(res.bytes) };
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', lt: "<", gt: ">", apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

function tagAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

function metaMap(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = tagAttrs(m[0]);
    const key = (a.property ?? a.name ?? "").toLowerCase();
    if (key && a.content && !(key in out)) out[key] = a.content.trim();
  }
  return out;
}

type LdObject = Record<string, unknown>;

function findJobPosting(html: string): LdObject | null {
  const visit = (node: unknown): LdObject | null => {
    if (Array.isArray(node)) {
      for (const n of node) {
        const hit = visit(n);
        if (hit) return hit;
      }
      return null;
    }
    if (!node || typeof node !== "object") return null;
    const obj = node as LdObject;
    const type = obj["@type"];
    if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return obj;
    return visit(obj["@graph"]);
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const hit = visit(JSON.parse(m[1].trim()));
      if (hit) return hit;
    } catch {
      continue;
    }
  }
  return null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? decode(v.trim()) : null);
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

function imageUrl(v: unknown): string | null {
  const one = first(v);
  if (typeof one === "string") return one.trim() || null;
  if (one && typeof one === "object") return str((one as LdObject).url);
  return null;
}

function absolute(href: string | null, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

export function mapJobType(value: unknown): string | null {
  const raw = (Array.isArray(value) ? value[0] : value) as unknown;
  if (typeof raw !== "string") return null;
  const v = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (v === "fulltime") return "Full time";
  if (v === "parttime") return "Part time";
  if (v === "intern" || v === "internship") return "Internship";
  if (v === "contractor" || v === "contract" || v === "temporary") return "Contract";
  return null;
}

function ldLocation(ld: LdObject): string | null {
  const loc = first(ld.jobLocation) as LdObject | undefined;
  const addr = loc && typeof loc === "object" ? (first(loc.address) as LdObject | undefined) : undefined;
  if (!addr || typeof addr !== "object") return null;
  const parts = [str(addr.addressLocality), str(addr.addressRegion)].filter((p): p is string => !!p);
  return parts.length ? parts.join(", ") : null;
}

const titleCase = (slug: string) =>
  slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

export function cleanLegalName(raw: string, fallbackSlug: string | null): string | null {
  const cleaned = raw
    .replace(/^\s*\d+\s+/, "")
    .replace(/(\s+(usa|us|inc\.?|llc|ltd\.?|corp\.?|corporation|co\.?|incorporated))+\s*$/i, "")
    .trim();
  if (cleaned) return cleaned;
  return fallbackSlug ? titleCase(fallbackSlug) : null;
}

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "edu", "gov"]);

export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const take = labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-take).join(".");
}

function websiteHost(sameAs: unknown): string | null {
  const one = str(first(sameAs));
  if (!one) return null;
  try {
    return new URL(one.includes("://") ? one : `https://${one}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function bestIcon(html: string, base: string): string | null {
  let best: { href: string; size: number } | null = null;
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = tagAttrs(m[0]);
    const rel = (a.rel ?? "").toLowerCase();
    if (!a.href || !/(^|\s)(apple-touch-icon(-precomposed)?|icon|shortcut)(\s|$)/.test(rel)) continue;
    const href = absolute(a.href, base);
    if (!href) continue;
    const sizeMatch = /(\d+)x\d+/.exec(a.sizes ?? "");
    const size = sizeMatch ? Number(sizeMatch[1]) : rel.includes("apple-touch-icon") ? 180 : 0;
    if (!best || size > best.size) best = { href, size };
  }
  return best?.href ?? null;
}

const EMPTY = {
  companyName: null,
  companyDomain: null,
  role: null,
  location: null,
  jobType: null,
  logoSourceUrl: null,
};

function jobFacts(ld: LdObject | null, meta: Record<string, string>) {
  return {
    role: (ld && str(ld.title)) ?? str(meta["og:title"]),
    location: ld ? ldLocation(ld) : null,
    jobType: ld ? mapJobType(ld.employmentType) : null,
  };
}

function orgOf(ld: LdObject | null): LdObject | null {
  const org = ld?.hiringOrganization;
  return org && typeof org === "object" ? (first(org) as LdObject) : null;
}

export async function resolveJobLink(rawUrl: string, deps: JobLinkDeps = {}): Promise<ResolvedJobLink | null> {
  const safe = await isSafeUrl(rawUrl, deps);
  if (!safe) return null;
  const url = safe.href;
  const host = safe.hostname.toLowerCase();
  const slug = safe.pathname.split("/").filter(Boolean)[0] ?? null;

  if (hostMatches(host, "linkedin.com")) return { url, ...EMPTY };

  const page = await fetchText(url, deps);
  const html = page?.text ?? "";
  const base = page?.url ?? url;
  const ld = findJobPosting(html);
  const meta = metaMap(html);
  const org = orgOf(ld);
  const orgName = org ? str(org.name) : null;
  const facts = jobFacts(ld, meta);
  const sameAsHost = org ? websiteHost(org.sameAs) : null;
  const ogImage = absolute(meta["og:image"] ?? null, base);

  if (hostMatches(host, "ashbyhq.com")) {
    return {
      url,
      companyName: orgName ?? (slug ? titleCase(slug) : null),
      companyDomain: sameAsHost,
      ...facts,
      logoSourceUrl: org ? absolute(imageUrl(org.logo), base) : null,
    };
  }

  if (hostMatches(host, "lever.co")) {
    return {
      url,
      companyName: orgName ?? (slug ? titleCase(slug) : null),
      companyDomain: sameAsHost,
      ...facts,
      logoSourceUrl: org ? absolute(imageUrl(org.logo), base) : null,
    };
  }

  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    let name: string | null = null;
    if (slug && /^[a-z0-9_-]+$/i.test(slug)) {
      const api = await fetchText(`https://boards-api.greenhouse.io/v1/boards/${slug}`, deps);
      try {
        name = api ? str((JSON.parse(api.text) as LdObject).name) : null;
      } catch {
        name = null;
      }
    }
    return {
      url,
      companyName: name ?? (slug ? titleCase(slug) : null),
      companyDomain: null,
      ...facts,
      logoSourceUrl: ogImage,
    };
  }

  if (hostMatches(host, "myworkdayjobs.com")) {
    const sub = host.split(".")[0];
    return {
      url,
      companyName: cleanLegalName(orgName ?? "", sub),
      companyDomain: sameAsHost,
      ...facts,
      logoSourceUrl: ogImage,
    };
  }

  if (isJobSiteHost(host)) {
    return { url, companyName: orgName, companyDomain: sameAsHost, ...facts, logoSourceUrl: null };
  }

  const icon = bestIcon(html, base);
  const iconHost = icon ? new URL(icon).hostname.toLowerCase() : null;
  const usableIcon = icon && iconHost && !isJobSiteHost(iconHost) ? icon : null;
  return {
    url,
    companyName: orgName ?? str(meta["og:site_name"]),
    companyDomain: sameAsHost ?? registrableDomain(host),
    ...facts,
    logoSourceUrl: usableIcon ?? (org ? absolute(imageUrl(org.logo), base) : null),
  };
}

export async function copyLogoToS3(logoSourceUrl: string, deps: CopyLogoDeps = {}): Promise<string | null> {
  const res = await safeFetch(logoSourceUrl, deps, { maxBytes: MAX_IMAGE_BYTES, truncate: false, accept: "image/*" });
  if (!res || res.status >= 400 || res.bytes.length === 0) return null;
  const ext = IMAGE_EXT[res.contentType];
  if (!ext) return null;
  const key = `uploads/opportunities/logos/${(deps.uuid ?? randomUUID)()}.${ext}`;
  try {
    await (deps.putObject ?? putObject)(key, res.bytes, res.contentType);
  } catch {
    return null;
  }
  return key;
}

export async function checkJobLinkAlive(url: string, deps: JobLinkDeps = {}): Promise<LinkStatus> {
  const res = await safeFetch(url, deps, { maxBytes: 0, truncate: true, readBody: false });
  if (!res) return "unknown";
  if (res.status === 404 || res.status === 410) return "dead";
  if (res.status >= 200 && res.status < 300) return "alive";
  return "unknown";
}

export function logoUrlForKey(key: string | null): string | null {
  return key ? `/api/upload/raw?key=${encodeURIComponent(key)}` : null;
}
