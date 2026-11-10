// Per-project cloud infra config lives on the Project row (schema.prisma:
// flyOrgSlug / neonOrgId / neonProjectIds / flyReadTokenEnc / flyWriteTokenEnc / infraEnabled).
// This module reads/decrypts that config for the sweep + console actions, and
// builds the Project update for the config editor. Fly tokens are decrypted only
// here and never returned to the client.

import { prisma } from "~/lib/db.server";
import { decryptSecret, encryptSecret } from "./crypto.server";

const CONFIG_SELECT = {
  id: true,
  name: true,
  flyOrgSlug: true,
  flyAppNames: true,
  neonOrgId: true,
  neonProjectIds: true,
  flyReadTokenEnc: true,
  flyWriteTokenEnc: true,
  infraEnabled: true,
} as const;

type ConfigRow = {
  id: string;
  name: string;
  flyOrgSlug: string | null;
  flyAppNames: string[];
  neonOrgId: string | null;
  neonProjectIds: string[];
  flyReadTokenEnc: string | null;
  flyWriteTokenEnc: string | null;
  infraEnabled: boolean;
};

// Server-side resolved credentials — tokens decrypted for the adapters. Never
// serialize this to the client.
export type InfraProjectCreds = {
  projectId: string;
  name: string;
  flyOrgSlug: string | null;
  flyAppNames: string[];
  neonOrgId: string | null;
  neonProjectIds: string[];
  flyReadToken: string | null;
  flyWriteToken: string | null;
  infraEnabled: boolean;
};

function toCreds(r: ConfigRow): InfraProjectCreds {
  return {
    projectId: r.id,
    name: r.name,
    flyOrgSlug: r.flyOrgSlug,
    flyAppNames: r.flyAppNames,
    neonOrgId: r.neonOrgId,
    neonProjectIds: r.neonProjectIds,
    flyReadToken: r.flyReadTokenEnc ? decryptSecret(r.flyReadTokenEnc) : null,
    flyWriteToken: r.flyWriteTokenEnc ? decryptSecret(r.flyWriteTokenEnc) : null,
    infraEnabled: r.infraEnabled,
  };
}

export async function getProjectInfraCreds(projectId: string): Promise<InfraProjectCreds | null> {
  const r = await prisma.project.findUnique({ where: { id: projectId }, select: CONFIG_SELECT });
  return r ? toCreds(r) : null;
}

// Projects with infra configured AND enabled — the sweep + fleet set.
export async function listEnabledInfraProjectCreds(): Promise<InfraProjectCreds[]> {
  const rows = await prisma.project.findMany({
    where: {
      infraEnabled: true,
      OR: [{ flyOrgSlug: { not: null } }, { neonOrgId: { not: null } }],
    },
    select: CONFIG_SELECT,
  });
  return rows.map(toCreds);
}

// Config-presence view for the fleet console (no token plaintext).
export type InfraProjectInfo = {
  projectId: string;
  name: string;
  flyOrgSlug: string | null;
  flyAppNames: string[];
  neonOrgId: string | null;
  neonProjectIds: string[];
  infraEnabled: boolean;
  hasFlyReadToken: boolean;
  hasFlyWriteToken: boolean;
};

const CONFIGURED = {
  OR: [{ flyOrgSlug: { not: null } }, { neonOrgId: { not: null } }, { flyReadTokenEnc: { not: null } }],
};

/**
 * Config-presence view for the fleet console (no token plaintext). By default
 * only configured projects; `all` lists every project, optionally scoped to
 * one term, so the console can show which ones still need setting up.
 */
export async function listInfraProjects(
  opts: { all?: boolean; termId?: string | null } = {},
): Promise<InfraProjectInfo[]> {
  const rows = await prisma.project.findMany({
    where: opts.all
      ? opts.termId
        ? { OR: [{ projectTerms: { some: { termId: opts.termId } } }, CONFIGURED] }
        : undefined
      : CONFIGURED,
    select: CONFIG_SELECT,
    orderBy: { name: "asc" },
  });
  return rows.map(toInfo);
}

export async function getInfraProjectInfo(projectId: string): Promise<InfraProjectInfo | null> {
  const r = await prisma.project.findUnique({ where: { id: projectId }, select: CONFIG_SELECT });
  return r ? toInfo(r) : null;
}

function toInfo(r: ConfigRow): InfraProjectInfo {
  return {
    projectId: r.id,
    name: r.name,
    flyOrgSlug: r.flyOrgSlug,
    flyAppNames: r.flyAppNames,
    neonOrgId: r.neonOrgId,
    neonProjectIds: r.neonProjectIds,
    infraEnabled: r.infraEnabled,
    hasFlyReadToken: !!r.flyReadTokenEnc,
    hasFlyWriteToken: !!r.flyWriteTokenEnc,
  };
}

// Whether a project has enough infra config to show/sweep anything.
export function hasInfraConfig(p: {
  flyOrgSlug: string | null;
  neonOrgId: string | null;
}): boolean {
  return Boolean(p.flyOrgSlug || p.neonOrgId);
}

type InfraConfigData = {
  flyOrgSlug?: string | null;
  flyAppNames?: string[];
  neonOrgId?: string | null;
  neonProjectIds?: string[];
  infraEnabled?: boolean;
  flyReadTokenEnc?: string;
  flyWriteTokenEnc?: string;
};

function cleanIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

// Build the Project update for the config editor. Token fields are write-only:
// undefined/empty = leave unchanged; non-empty = set (encrypted). Never logs
// plaintext.
export function buildInfraConfigUpdate(input: {
  flyOrgSlug?: string | null;
  flyAppNames?: string[];
  neonOrgId?: string | null;
  neonProjectIds?: string[];
  infraEnabled?: boolean;
  flyReadToken?: string;
  flyWriteToken?: string;
}): InfraConfigData {
  const data: InfraConfigData = {};
  if (input.flyOrgSlug !== undefined) data.flyOrgSlug = input.flyOrgSlug || null;
  if (input.flyAppNames !== undefined) data.flyAppNames = cleanIds(input.flyAppNames);
  if (input.neonOrgId !== undefined) data.neonOrgId = input.neonOrgId || null;
  if (input.neonProjectIds !== undefined) data.neonProjectIds = cleanIds(input.neonProjectIds);
  if (input.infraEnabled !== undefined) data.infraEnabled = input.infraEnabled;
  if (input.flyReadToken) data.flyReadTokenEnc = encryptSecret(input.flyReadToken);
  if (input.flyWriteToken) data.flyWriteTokenEnc = encryptSecret(input.flyWriteToken);
  return data;
}

export function infraConfigFromForm(form: FormData): Parameters<typeof buildInfraConfigUpdate>[0] {
  const str = (k: string) => ((form.get(k) as string | null) ?? "").trim();
  return {
    flyOrgSlug: str("flyOrgSlug"),
    flyAppNames: form.getAll("flyAppNames").map(String),
    neonOrgId: str("neonOrgId"),
    neonProjectIds: form.getAll("neonProjectIds").map(String),
    infraEnabled: form.get("infraEnabled") != null,
    flyReadToken: str("flyReadToken") || undefined,
    flyWriteToken: str("flyWriteToken") || undefined,
  };
}

/**
 * Fly tokens for a project joining an org another project already uses: when
 * none were typed and the project has none for this org, reuse the other
 * project's encrypted tokens (copied as ciphertext, never decrypted here).
 */
export async function inheritFlyTokens(
  projectId: string,
  data: InfraConfigData,
): Promise<InfraConfigData> {
  if (!data.flyOrgSlug || data.flyReadTokenEnc || data.flyWriteTokenEnc) return data;
  const current = await prisma.project.findUnique({
    where: { id: projectId },
    select: { flyOrgSlug: true, flyReadTokenEnc: true },
  });
  if (current?.flyOrgSlug === data.flyOrgSlug && current.flyReadTokenEnc) return data;
  const donor = await prisma.project.findFirst({
    where: { id: { not: projectId }, flyOrgSlug: data.flyOrgSlug, flyReadTokenEnc: { not: null } },
    select: { flyReadTokenEnc: true, flyWriteTokenEnc: true },
    orderBy: { name: "asc" },
  });
  if (!donor) return data;
  return {
    ...data,
    flyReadTokenEnc: donor.flyReadTokenEnc ?? undefined,
    ...(donor.flyWriteTokenEnc ? { flyWriteTokenEnc: donor.flyWriteTokenEnc } : {}),
  };
}
