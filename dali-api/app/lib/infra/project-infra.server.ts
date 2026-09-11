// Per-project cloud infra config lives on the Project row (schema.prisma:
// flyOrgSlug / neonOrgId / flyReadTokenEnc / flyWriteTokenEnc / infraEnabled).
// This module reads/decrypts that config for the sweep + console actions, and
// builds the Project update for the config editor. Fly tokens are decrypted only
// here and never returned to the client.

import { prisma } from "~/lib/db";
import { decryptSecret, encryptSecret } from "./crypto.server";

const CONFIG_SELECT = {
  id: true,
  name: true,
  flyOrgSlug: true,
  neonOrgId: true,
  flyReadTokenEnc: true,
  flyWriteTokenEnc: true,
  infraEnabled: true,
} as const;

type ConfigRow = {
  id: string;
  name: string;
  flyOrgSlug: string | null;
  neonOrgId: string | null;
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
  neonOrgId: string | null;
  flyReadToken: string | null;
  flyWriteToken: string | null;
  infraEnabled: boolean;
};

function toCreds(r: ConfigRow): InfraProjectCreds {
  return {
    projectId: r.id,
    name: r.name,
    flyOrgSlug: r.flyOrgSlug,
    neonOrgId: r.neonOrgId,
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
  neonOrgId: string | null;
  infraEnabled: boolean;
  hasFlyReadToken: boolean;
  hasFlyWriteToken: boolean;
};

export async function listInfraProjects(): Promise<InfraProjectInfo[]> {
  const rows = await prisma.project.findMany({
    where: {
      OR: [
        { flyOrgSlug: { not: null } },
        { neonOrgId: { not: null } },
        { flyReadTokenEnc: { not: null } },
      ],
    },
    select: CONFIG_SELECT,
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({
    projectId: r.id,
    name: r.name,
    flyOrgSlug: r.flyOrgSlug,
    neonOrgId: r.neonOrgId,
    infraEnabled: r.infraEnabled,
    hasFlyReadToken: !!r.flyReadTokenEnc,
    hasFlyWriteToken: !!r.flyWriteTokenEnc,
  }));
}

// Whether a project has enough infra config to show/sweep anything.
export function hasInfraConfig(p: {
  flyOrgSlug: string | null;
  neonOrgId: string | null;
}): boolean {
  return Boolean(p.flyOrgSlug || p.neonOrgId);
}

// Build the Project update for the config editor (the project "details" intent).
// Token fields are write-only: undefined/empty = leave unchanged; non-empty =
// set (encrypted). Never logs plaintext.
export function buildInfraConfigUpdate(input: {
  flyOrgSlug?: string | null;
  neonOrgId?: string | null;
  infraEnabled?: boolean;
  flyReadToken?: string;
  flyWriteToken?: string;
}): {
  flyOrgSlug?: string | null;
  neonOrgId?: string | null;
  infraEnabled?: boolean;
  flyReadTokenEnc?: string;
  flyWriteTokenEnc?: string;
} {
  const data: {
    flyOrgSlug?: string | null;
    neonOrgId?: string | null;
    infraEnabled?: boolean;
    flyReadTokenEnc?: string;
    flyWriteTokenEnc?: string;
  } = {};
  if (input.flyOrgSlug !== undefined) data.flyOrgSlug = input.flyOrgSlug || null;
  if (input.neonOrgId !== undefined) data.neonOrgId = input.neonOrgId || null;
  if (input.infraEnabled !== undefined) data.infraEnabled = input.infraEnabled;
  if (input.flyReadToken) data.flyReadTokenEnc = encryptSecret(input.flyReadToken);
  if (input.flyWriteToken) data.flyWriteTokenEnc = encryptSecret(input.flyWriteToken);
  return data;
}
