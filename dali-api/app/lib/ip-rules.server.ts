import { BlockList, isIP } from "node:net";
import { logAuditEvent } from "~/lib/audit";
import { cachedForTtl, clearTtlCache } from "~/lib/ttl-cache";

export type IpRuleKind = "block" | "trust";

export const AUTO_BLOCK_MS = 24 * 60 * 60_000;

// Other machines pick up a new rule when their cached copy expires.
const CACHE_KEY = "ipRules:active";
const CACHE_TTL_MS = 30_000;

type ActiveRule = { kind: string; cidr: string };
type Matchers = { block: BlockList; trust: BlockList };

function family(address: string): "ipv4" | "ipv6" | null {
  const v = isIP(address);
  return v === 4 ? "ipv4" : v === 6 ? "ipv6" : null;
}

// Node reports IPv4 clients on a dual-stack socket as ::ffff:a.b.c.d.
function unmap(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m ? m[1] : ip;
}

/** "1.2.3.4" → "1.2.3.4/32"; validates prefix length; null when unparseable. */
export function normalizeCidr(input: string): string | null {
  const [rawAddr, rawPrefix, extra] = input.trim().split("/");
  if (extra !== undefined || !rawAddr) return null;
  const address = unmap(rawAddr.toLowerCase());
  const fam = family(address);
  if (!fam) return null;
  const max = fam === "ipv4" ? 32 : 128;
  if (rawPrefix === undefined) return `${address}/${max}`;
  if (!/^\d+$/.test(rawPrefix)) return null;
  const prefix = Number(rawPrefix);
  if (prefix < 0 || prefix > max) return null;
  return `${address}/${prefix}`;
}

export function buildMatchers(rules: ActiveRule[]): Matchers {
  const block = new BlockList();
  const trust = new BlockList();
  for (const rule of rules) {
    const cidr = normalizeCidr(rule.cidr);
    if (!cidr) continue;
    const [address, prefix] = cidr.split("/");
    const list = rule.kind === "trust" ? trust : rule.kind === "block" ? block : null;
    list?.addSubnet(address, Number(prefix), family(address)!);
  }
  return { block, trust };
}

export function matches(list: BlockList, ip: string): boolean {
  const address = unmap(ip.trim().toLowerCase());
  const fam = family(address);
  return fam ? list.check(address, fam) : false;
}

async function loadMatchers(): Promise<Matchers> {
  return cachedForTtl(CACHE_KEY, CACHE_TTL_MS, async () => {
    const { prisma } = await import("~/lib/db.server");
    const rules = await prisma.ipRule.findMany({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { kind: true, cidr: true },
    });
    return buildMatchers(rules);
  });
}

// Both fail open: a broken rules read must not lock everyone out of sign-in.
export async function isIpBlocked(ip: string): Promise<boolean> {
  try {
    return matches((await loadMatchers()).block, ip);
  } catch (err) {
    console.error("[ip-rules] block check failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

export async function isIpTrusted(ip: string): Promise<boolean> {
  try {
    return matches((await loadMatchers()).trust, ip);
  } catch (err) {
    console.error("[ip-rules] trust check failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

function rangeContains(cidr: string, ip: string): boolean {
  return matches(buildMatchers([{ kind: "trust", cidr }]).trust, ip);
}

/** Two CIDR ranges overlap exactly when one contains the other's base address. */
export function rangesOverlap(a: string, b: string): boolean {
  const na = normalizeCidr(a);
  const nb = normalizeCidr(b);
  if (!na || !nb) return false;
  return rangeContains(na, nb.split("/")[0]) || rangeContains(nb, na.split("/")[0]);
}

/** The trusted range `cidr` overlaps, if any. */
export async function findOverlappingTrust(cidr: string): Promise<string | null> {
  const { prisma } = await import("~/lib/db.server");
  const trusted = await prisma.ipRule.findMany({ where: { kind: "trust" }, select: { cidr: true } });
  return trusted.find((t) => rangesOverlap(t.cidr, cidr))?.cidr ?? null;
}

export async function addIpRule(args: {
  kind: IpRuleKind;
  cidr: string;
  reason?: string | null;
  source?: "manual" | "auto";
  expiresAt?: Date | null;
  createdByUserId?: string | null;
}): Promise<{ id: string; cidr: string }> {
  const cidr = normalizeCidr(args.cidr);
  if (!cidr) throw new Error(`Invalid IP or range: ${args.cidr}`);
  const { prisma } = await import("~/lib/db.server");
  const data = {
    reason: args.reason ?? null,
    source: args.source ?? "manual",
    expiresAt: args.expiresAt ?? null,
    createdByUserId: args.createdByUserId ?? null,
  };
  const row = await prisma.ipRule.upsert({
    where: { kind_cidr: { kind: args.kind, cidr } },
    create: { kind: args.kind, cidr, ...data },
    update: data,
    select: { id: true, cidr: true },
  });
  clearTtlCache(CACHE_KEY);
  return row;
}

export async function removeIpRule(id: string): Promise<{ kind: string; cidr: string } | null> {
  const { prisma } = await import("~/lib/db.server");
  const row = await prisma.ipRule.findUnique({ where: { id }, select: { kind: true, cidr: true } });
  if (!row) return null;
  await prisma.ipRule.delete({ where: { id } });
  clearTtlCache(CACHE_KEY);
  return row;
}

/** Block `ip` for 24h on behalf of the system. Never touches a trusted address. */
export async function autoBlockIp(ip: string, reason: string): Promise<boolean> {
  if (await isIpTrusted(ip)) return false;
  const cidr = normalizeCidr(ip);
  if (!cidr) return false;
  await addIpRule({
    kind: "block",
    cidr,
    reason,
    source: "auto",
    expiresAt: new Date(Date.now() + AUTO_BLOCK_MS),
  });
  await logAuditEvent({ action: "security.ip.autoblock", metadata: { cidr, reason }, ip });
  return true;
}

// One audit row per address per minute per machine, so a blocked flood can't
// flood the audit log too.
const lastBlockedLog = new Map<string, number>();

export async function auditBlockedHit(ip: string, path: string, userAgent: string | null): Promise<void> {
  const now = Date.now();
  if ((lastBlockedLog.get(ip) ?? 0) > now - 60_000) return;
  lastBlockedLog.set(ip, now);
  if (lastBlockedLog.size > 5_000) lastBlockedLog.clear();
  await logAuditEvent({ action: "security.ip.blocked", metadata: { path }, ip, userAgent });
}

export function _resetBlockedLogForTests(): void {
  lastBlockedLog.clear();
}
