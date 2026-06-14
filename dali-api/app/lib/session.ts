import { createHash, randomBytes } from "node:crypto";
import { prisma } from "~/lib/db";
import { SESSION_TTL_SECONDS } from "./cookies";

// 30 days rolling expiry; same value as the absolute cap so a session
// can be extended for up to 30 days from creation. Matches the prior
// `RefreshToken.familyCreatedAt + SESSION_MAX_AGE_MS` behavior.
export const ROLLING_TTL_MS = SESSION_TTL_SECONDS * 1000;
export const ABSOLUTE_TTL_MS = SESSION_TTL_SECONDS * 1000;

export function hashSessionId(raw: string): string {
  return createHash("sha256").update(raw).digest("base64url");
}

function generateRawSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export interface IssueSessionParams {
  userId: string;
  grantId?: string;
  ttlMs?: number;
  absoluteTtlMs?: number;
  userAgent?: string;
  ip?: string;
}

export interface IssueSessionResult {
  rawId: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export async function issueSession(params: IssueSessionParams): Promise<IssueSessionResult> {
  const rawId = generateRawSessionId();
  const ttlMs = params.ttlMs ?? ROLLING_TTL_MS;
  const absoluteTtlMs = params.absoluteTtlMs ?? ABSOLUTE_TTL_MS;
  const now = Date.now();
  const expiresAt = new Date(now + ttlMs);
  const absoluteExpiresAt = new Date(now + absoluteTtlMs);

  await prisma.session.create({
    data: {
      id: hashSessionId(rawId),
      userId: params.userId,
      grantId: params.grantId,
      expiresAt,
      absoluteExpiresAt,
      userAgent: params.userAgent,
      ip: params.ip,
    },
  });

  return { rawId, expiresAt, absoluteExpiresAt };
}

export interface LookupSessionResult {
  id: string; // hashed id (PK)
  userId: string;
  grantId: string | null;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  user: {
    id: string;
    daliEmail: string | null;
    dartmouthEmail: string | null;
    netId: string | null;
    firstName: string;
    lastName: string;
  };
}

export async function lookupSession(raw: string): Promise<LookupSessionResult | null> {
  if (!raw) return null;
  const id = hashSessionId(raw);
  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          daliEmail: true,
          dartmouthEmail: true,
          netId: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });
  if (!session) return null;
  return session;
}

// Extends the rolling expiry. Never advances past absoluteExpiresAt.
// Fire-and-forget from request handlers — a failed roll doesn't break
// the request that's already authenticated.
export async function rollSession(hashedId: string, ttlMs = ROLLING_TTL_MS): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: hashedId },
    select: { absoluteExpiresAt: true },
  });
  if (!session) return;

  const nextExpiry = new Date(Date.now() + ttlMs);
  const capped =
    nextExpiry > session.absoluteExpiresAt ? session.absoluteExpiresAt : nextExpiry;

  await prisma.session.update({
    where: { id: hashedId },
    data: { lastUsedAt: new Date(), expiresAt: capped },
  });
}

export async function revokeSession(rawOrHashed: string, opts: { hashed?: boolean } = {}): Promise<void> {
  const id = opts.hashed ? rawOrHashed : hashSessionId(rawOrHashed);
  await prisma.session.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllForUser(userId: string): Promise<number> {
  const res = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

// Ships now; takes effect once OAuthGrant lands and grantId is populated.
export async function revokeAllForGrant(grantId: string): Promise<number> {
  const res = await prisma.session.updateMany({
    where: { grantId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}
