// The project registry (InfraProject): one Fly org + one Neon org per lab
// project. Admin-managed. Fly tokens are encrypted at rest; this module is the
// only place they're decrypted, and never returns plaintext to the client.

import { prisma } from "~/lib/db";
import { decryptSecret, encryptSecret } from "./crypto.server";

// Registry view for the admin UI — exposes only whether each token is set.
export type InfraProjectRow = {
  id: string;
  key: string;
  label: string;
  flyOrgSlug: string | null;
  neonOrgId: string | null;
  enabled: boolean;
  hasFlyReadToken: boolean;
  hasFlyWriteToken: boolean;
};

export async function listInfraProjects(): Promise<InfraProjectRow[]> {
  const rows = await prisma.infraProject.findMany({ orderBy: { label: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    flyOrgSlug: r.flyOrgSlug,
    neonOrgId: r.neonOrgId,
    enabled: r.enabled,
    hasFlyReadToken: !!r.flyReadTokenEnc,
    hasFlyWriteToken: !!r.flyWriteTokenEnc,
  }));
}

// Server-side resolved credentials for one project — tokens decrypted for the
// adapters. Never serialize this to the client.
export type InfraProjectCreds = {
  key: string;
  label: string;
  flyOrgSlug: string | null;
  neonOrgId: string | null;
  flyReadToken: string | null;
  flyWriteToken: string | null;
  enabled: boolean;
};

function toCreds(r: {
  key: string;
  label: string;
  flyOrgSlug: string | null;
  neonOrgId: string | null;
  flyReadTokenEnc: string | null;
  flyWriteTokenEnc: string | null;
  enabled: boolean;
}): InfraProjectCreds {
  return {
    key: r.key,
    label: r.label,
    flyOrgSlug: r.flyOrgSlug,
    neonOrgId: r.neonOrgId,
    flyReadToken: r.flyReadTokenEnc ? decryptSecret(r.flyReadTokenEnc) : null,
    flyWriteToken: r.flyWriteTokenEnc ? decryptSecret(r.flyWriteTokenEnc) : null,
    enabled: r.enabled,
  };
}

export async function getInfraProjectCreds(key: string): Promise<InfraProjectCreds | null> {
  const r = await prisma.infraProject.findUnique({ where: { key } });
  return r ? toCreds(r) : null;
}

export async function listEnabledInfraProjectCreds(): Promise<InfraProjectCreds[]> {
  const rows = await prisma.infraProject.findMany({ where: { enabled: true } });
  return rows.map(toCreds);
}

// Upsert a project. Token fields follow tri-state: undefined = leave as-is,
// null = clear, string = set (encrypted).
export async function saveInfraProject(input: {
  key: string;
  label: string;
  flyOrgSlug: string | null;
  neonOrgId: string | null;
  enabled: boolean;
  flyReadToken?: string | null;
  flyWriteToken?: string | null;
}): Promise<void> {
  const tokenData: { flyReadTokenEnc?: string | null; flyWriteTokenEnc?: string | null } = {};
  if (input.flyReadToken !== undefined) {
    tokenData.flyReadTokenEnc = input.flyReadToken ? encryptSecret(input.flyReadToken) : null;
  }
  if (input.flyWriteToken !== undefined) {
    tokenData.flyWriteTokenEnc = input.flyWriteToken ? encryptSecret(input.flyWriteToken) : null;
  }
  const base = {
    label: input.label,
    flyOrgSlug: input.flyOrgSlug,
    neonOrgId: input.neonOrgId,
    enabled: input.enabled,
  };
  await prisma.infraProject.upsert({
    where: { key: input.key },
    create: { key: input.key, ...base, ...tokenData },
    update: { ...base, ...tokenData },
  });
}

export async function deleteInfraProject(key: string): Promise<void> {
  await prisma.infraProject.delete({ where: { key } });
}
