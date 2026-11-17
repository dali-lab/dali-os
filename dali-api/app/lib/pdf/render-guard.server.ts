import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const SCRIPT_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com"];
export const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
const ALLOWED_HOSTS = new Set([...SCRIPT_HOSTS, ...FONT_HOSTS]);
const OPEN_PROTOCOLS = new Set(["data:", "blob:", "about:"]);
const MEDIA_TYPES = new Set(["image", "media"]);
const BLOCKED_SUFFIXES = [".internal", ".flycast", ".local", ".localhost", ".localdomain", ".lan", ".home.arpa"];

function privateV4(parts: number[]): boolean {
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function parseV6(ip: string): number[] | null {
  let text = ip;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = text.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

const embeddedV4 = (hi: number, lo: number) => privateV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);

/** Whether an IP literal is loopback, private, link-local, carrier-grade NAT, multicast or otherwise not a public address. */
export function isPrivateAddress(input: string): boolean {
  const ip = input.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const kind = isIP(ip);
  if (kind === 4) return privateV4(ip.split(".").map(Number));
  if (kind !== 6) return true;
  const g = parseV6(ip);
  if (!g) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) return embeddedV4(g6, g7);
  if (g0 === 0x64 && g1 === 0xff9b) return g2 === 1 || (g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && embeddedV4(g6, g7));
  if (g0 === 0x2002) return embeddedV4(g1, g2);
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) return true;
  return (g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xff00) === 0xff00;
}

export type Resolver = (host: string) => Promise<string[]>;

const resolveAll: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

export interface RequestGuard {
  allow(url: string, resourceType: string): Promise<boolean>;
}

/**
 * Decides which requests a server render of author HTML may make: inline data, the script and font CDNs, and
 * images or media from hosts that resolve only to public addresses. Everything else is refused. Answers are
 * cached per host for the life of one render.
 */
export function createRequestGuard(resolve: Resolver = resolveAll): RequestGuard {
  const publicHosts = new Map<string, Promise<boolean>>();
  const isPublicHost = (host: string) => {
    let known = publicHosts.get(host);
    if (!known) {
      known = resolve(host).then(
        (addresses) => addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a)),
        () => false,
      );
      publicHosts.set(host, known);
    }
    return known;
  };
  return {
    async allow(rawUrl, resourceType) {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        return false;
      }
      if (OPEN_PROTOCOLS.has(url.protocol)) return true;
      if (url.protocol !== "https:") return false;
      const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
      if (!host || host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return false;
      if (isIP(host)) return !isPrivateAddress(host) && MEDIA_TYPES.has(resourceType);
      if (ALLOWED_HOSTS.has(host)) return true;
      if (!MEDIA_TYPES.has(resourceType)) return false;
      return isPublicHost(host);
    },
  };
}

interface RouteLike {
  request(): { url(): string; resourceType(): string };
  continue(): Promise<void>;
  abort(reason?: string): Promise<void>;
}

export interface RoutableContext {
  route(url: string, handler: (route: RouteLike) => Promise<void>): Promise<void>;
}

/** Puts the guard in front of every request a render context makes. Install it before loading any content. */
export async function guardContext(context: RoutableContext, guard: RequestGuard = createRequestGuard()): Promise<void> {
  await context.route("**/*", async (route) => {
    const request = route.request();
    let ok = false;
    try {
      ok = await guard.allow(request.url(), request.resourceType());
    } catch {
      ok = false;
    }
    await (ok ? route.continue() : route.abort("blockedbyclient")).catch(() => {});
  });
}

export const PDF_HARD_TIMEOUT_MS = 15_000;
export const PNG_HARD_TIMEOUT_MS = 5_000;

export class RenderTimeoutError extends Error {
  constructor(ms: number) {
    super(`Render did not finish within ${ms}ms`);
  }
}
