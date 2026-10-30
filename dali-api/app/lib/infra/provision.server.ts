// Optional infra for a brand-new project (Admin only, from the New project
// form): a Neon database and/or an empty Fly app in an org another project
// already uses, linked to the new project and swept at once. Each step fails on
// its own; the project itself is already created.

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import type { AuditAction } from "~/lib/audit-actions";
import { refreshProjectInfra } from "~/jobs/infra-snapshot.server";
import * as fly from "./fly.server";
import * as neon from "./neon.server";
import { getProjectInfraCreds, inheritFlyTokens, listInfraProjects } from "./project-infra.server";

export const FLY_APP_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export type ProvisionTargets = { neonOrgs: string[]; flyOrgs: string[] };

/** Orgs a new project can create in: Neon needs the shared key, Fly a write token on some project. */
export async function listProvisionTargets(): Promise<ProvisionTargets> {
  const configured = await listInfraProjects();
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  return {
    neonOrgs: neon.neonConfigured() ? uniq(configured.map((p) => p.neonOrgId)) : [],
    flyOrgs: uniq(configured.filter((p) => p.hasFlyWriteToken).map((p) => p.flyOrgSlug)),
  };
}

export type ProvisionRequest = {
  neon?: { orgId: string; name: string };
  fly?: { orgSlug: string; appName: string };
};

export function provisionRequestFromForm(form: FormData, projectName: string, slug: string): ProvisionRequest {
  const str = (k: string) => ((form.get(k) as string | null) ?? "").trim();
  const req: ProvisionRequest = {};
  if (form.get("createNeon") != null && str("neonOrgId")) {
    req.neon = { orgId: str("neonOrgId"), name: str("neonName") || projectName };
  }
  if (form.get("createFly") != null && str("flyOrgSlug")) {
    req.fly = { orgSlug: str("flyOrgSlug"), appName: str("flyAppName") || slug };
  }
  return req;
}

export async function provisionProjectInfra(opts: {
  userId: string;
  projectId: string;
  request: Request;
  want: ProvisionRequest;
}): Promise<{ errors: string[] }> {
  const { userId, projectId, request, want } = opts;
  const errors: string[] = [];
  const audit = (action: AuditAction, targetId: string | null, metadata: Record<string, unknown>) =>
    logAuditEvent({ action, userId, targetId, metadata: { projectId, ...metadata }, request });

  if (want.neon) {
    try {
      const { projectId: neonId, operations } = await neon.createProject(want.neon.orgId, want.neon.name);
      if (!neonId) throw new Error("Neon returned no project id");
      await neon.pollOperations(neonId, operations).catch(() => {});
      await prisma.project.update({
        where: { id: projectId },
        data: { neonOrgId: want.neon.orgId, neonProjectIds: { push: neonId } },
      });
      await audit("infra.neon.project.create", neonId, { name: want.neon.name, orgId: want.neon.orgId });
    } catch (err) {
      errors.push(`Neon database: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  if (want.fly) {
    const { orgSlug, appName } = want.fly;
    try {
      if (!FLY_APP_NAME.test(appName)) {
        throw new Error("app names use lowercase letters, numbers, and hyphens (3 to 63 characters)");
      }
      const donor = (await listInfraProjects()).find((p) => p.flyOrgSlug === orgSlug && p.hasFlyWriteToken);
      const token = donor ? (await getProjectInfraCreds(donor.projectId))?.flyWriteToken : null;
      if (!token) throw new Error(`no project has a Fly write token for ${orgSlug}`);
      await fly.createApp(token, orgSlug, appName);
      const data = await inheritFlyTokens(projectId, { flyOrgSlug: orgSlug });
      await prisma.project.update({
        where: { id: projectId },
        data: { ...data, flyAppNames: { push: appName } },
      });
      await audit("infra.fly.app.create", appName, { orgSlug });
    } catch (err) {
      errors.push(`Fly app: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  if (want.neon || want.fly) await refreshProjectInfra(projectId);
  return { errors };
}
