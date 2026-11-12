import { redirect } from "react-router";
import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { ensureProjectGroup } from "~/lib/groups";
import { saveInfraConfig } from "~/lib/infra/config-save.server";
import {
  recordProjectChartString,
  ChartStringValidationError,
  PROJECT_FUNDING_TYPES,
} from "~/lib/chart-string.server";
import {
  linkProjectPartner,
  unlinkProjectPartner,
  updateProjectPartnerDates,
} from "~/partners/lib/partner-access";
import { setTermPi } from "~/partners/lib/partner-renewals.server";
import { replaceProjectTerms } from "./project-terms.server";
import { PROJECT_STATUSES, type ProjectStatus } from "./project-lifecycle";

export type ProjectActionResult =
  | Response
  | { error: string }
  | { ok: true; chartStringWarnings?: string[] };

export type ProjectActionContext = {
  request: Request;
  projectId: string;
  userId: string;
  core: boolean;
  form: FormData;
};

type ProjectActionHandler = (ctx: ProjectActionContext) => Promise<ProjectActionResult>;

const back = (projectId: string) => redirect(`/projects/${projectId}`);

async function replaceProjectDomains(projectId: string, incoming: string[]) {
  const valid = incoming.length
    ? await prisma.domain.findMany({
        where: { id: { in: incoming }, active: true },
        select: { id: true },
      })
    : [];
  const ids = valid.map((d) => d.id);
  await prisma.$transaction([
    prisma.projectDomain.deleteMany({ where: { projectId } }),
    ...(ids.length
      ? [
          prisma.projectDomain.createMany({
            data: ids.map((domainId) => ({ projectId, domainId })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
}

const pi: ProjectActionHandler = async ({ request, projectId, core, form }) => {
  if (!core) return { error: "Only Core can set the project PI." };
  const termId = String(form.get("termId") ?? "");
  const piUserId = String(form.get("piUserId") ?? "") || null;
  if (!termId) return { error: "Missing term." };
  if (piUserId && !(await isCore(piUserId, request))) {
    return { error: "A PI must be a Core member." };
  }
  if (!(await setTermPi(prisma, { projectId, termId, piUserId }))) {
    return { error: "That project is not active in that term." };
  }
  return back(projectId);
};

const infraConfig: ProjectActionHandler = ({ request, projectId, userId, form }) =>
  saveInfraConfig({ userId, projectId, form, request });

const PARTNER_INTENTS = ["partner-link", "partner-end", "partner-unlink"];

const partnerIntent: ProjectActionHandler = async ({ request, projectId, userId, core, form }) => {
  if (!core) return { error: "Only Core or Admin can manage partner organizations." };
  const intent = form.get("intent");
  const actor = { actorUserId: userId, request };
  if (intent === "partner-link") {
    const partnerOrgId = (form.get("partnerOrgId") as string | null) ?? "";
    if (!partnerOrgId) return { error: "Select an organization." };
    const result = await linkProjectPartner({ projectId, partnerOrgId }, actor);
    return "error" in result ? result : back(projectId);
  }
  const projectPartnerId = (form.get("projectPartnerId") as string | null) ?? "";
  const existing = await prisma.projectPartner.findFirst({
    where: { id: projectPartnerId, projectId },
    select: { id: true, startedAt: true },
  });
  if (!existing) return { error: "Partnership not found." };
  if (intent === "partner-end") {
    const result = await updateProjectPartnerDates(
      { projectPartnerId, startedAt: existing.startedAt, endedAt: new Date() },
      actor,
    );
    return "error" in result ? result : back(projectId);
  }
  const result = await unlinkProjectPartner(projectPartnerId, actor);
  return "error" in result ? result : back(projectId);
};

const chartString: ProjectActionHandler = async ({ projectId, userId, core, form }) => {
  if (!core) return { error: "Only Core can edit payroll chart strings." };

  const chartStringValue = (form.get("chartString") as string | null)?.trim() ?? "";
  const termId = (form.get("termId") as string | null)?.trim() ?? "";
  if (!chartStringValue) return { error: "Chart string is required." };
  if (!termId) return { error: "Pick a term." };

  const typeRaw = (form.get("fundingType") as string | null)?.trim() ?? "";
  const fundingType = PROJECT_FUNDING_TYPES.includes(
    typeRaw as (typeof PROJECT_FUNDING_TYPES)[number],
  )
    ? (typeRaw as (typeof PROJECT_FUNDING_TYPES)[number])
    : null;

  const optional = (name: string) => (form.get(name) as string | null)?.trim() || null;

  try {
    const result = await recordProjectChartString({
      projectId,
      termId,
      chartString: chartStringValue,
      fundingType,
      fpNumber: optional("fpNumber"),
      awardId: optional("awardId"),
      rapportName: optional("rapportName"),
      supersedeReason: optional("supersedeReason"),
      note: optional("note"),
      createdById: userId,
    });
    return { ok: true, chartStringWarnings: result.warnings.map((w) => w.message) };
  } catch (err) {
    if (err instanceof ChartStringValidationError) return { error: err.message };
    throw err;
  }
};

const header: ProjectActionHandler = async ({ projectId, core, form }) => {
  const name = (form.get("name") as string | null)?.trim() ?? "";
  const status = (form.get("status") as string | null) ?? "";
  const iconRaw = (form.get("iconEmoji") as string | null)?.trim() ?? "";
  if (!name) return { error: "Project name is required." };
  if (!PROJECT_STATUSES.includes(status as ProjectStatus)) {
    return { error: "Invalid status." };
  }
  await prisma.project.update({
    where: { id: projectId },
    data: { name, status: status as ProjectStatus, iconEmoji: iconRaw || null },
  });
  await ensureProjectGroup(projectId, name);
  if (core && form.get("hasTerms") === "1") {
    await replaceProjectTerms(projectId, form.getAll("termId").map(String));
  }
  if (core && form.get("hasDomains") === "1") {
    await replaceProjectDomains(projectId, form.getAll("domainId").map(String));
  }
  return back(projectId);
};

const description: ProjectActionHandler = async ({ projectId, form }) => {
  const descriptionRaw = (form.get("description") as string | null)?.trim() ?? "";
  await prisma.project.update({
    where: { id: projectId },
    data: { description: descriptionRaw === "" ? null : descriptionRaw },
  });
  return back(projectId);
};

const updateImage: ProjectActionHandler = async ({ projectId, form }) => {
  const imageUrlRaw = (form.get("imageUrl") as string | null)?.trim() ?? "";
  await prisma.project.update({
    where: { id: projectId },
    data: { imageUrl: imageUrlRaw === "" ? null : imageUrlRaw },
  });
  return back(projectId);
};

const status: ProjectActionHandler = async ({ projectId, form }) => {
  const value = (form.get("status") as string | null) ?? "";
  if (!PROJECT_STATUSES.includes(value as ProjectStatus)) {
    return { error: "Invalid status." };
  }
  await prisma.project.update({
    where: { id: projectId },
    data: { status: value as ProjectStatus },
  });
  return back(projectId);
};

const visibility: ProjectActionHandler = async ({ projectId, form }) => {
  await prisma.project.update({
    where: { id: projectId },
    data: { isPrivate: form.get("isPrivate") === "on" },
  });
  return back(projectId);
};

const recordingPolicy: ProjectActionHandler = async ({ projectId, form }) => {
  await prisma.project.update({
    where: { id: projectId },
    data: { recordingPolicy: form.get("recordingAllowed") === "on" ? "Allowed" : "Disabled" },
  });
  return back(projectId);
};

const scopesBulk: ProjectActionHandler = async ({ projectId, userId, form }) => {
  type CellWrite = { domainId: string; termId: string; scope: string };
  const writes: CellWrite[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("scope:")) continue;
    const [, domainId, termId] = key.split(":");
    if (!domainId || !termId) continue;
    writes.push({ domainId, termId, scope: String(value).trim() });
  }
  if (writes.length === 0) return back(projectId);
  const ops = writes.map(({ domainId, termId, scope }) =>
    scope === ""
      ? prisma.projectDomainScope.deleteMany({ where: { projectId, domainId, termId } })
      : prisma.projectDomainScope.upsert({
          where: { projectId_domainId_termId: { projectId, domainId, termId } },
          update: { scope, updatedById: userId },
          create: { projectId, domainId, termId, scope, updatedById: userId },
        }),
  );
  await prisma.$transaction(ops);
  return back(projectId);
};

const domains: ProjectActionHandler = async ({ projectId, form }) => {
  await replaceProjectDomains(projectId, form.getAll("domainId").map(String));
  return back(projectId);
};

const terms: ProjectActionHandler = async ({ projectId, form }) => {
  await replaceProjectTerms(projectId, form.getAll("termId").map(String));
  return back(projectId);
};

const details: ProjectActionHandler = async ({ projectId, form }) => {
  const calendarEmailRaw = (form.get("calendarEmail") as string | null)?.trim() ?? "";
  const repoUrlsRaw = (form.get("repoUrls") as string | null) ?? "";
  const figmaUrlsRaw = (form.get("figmaUrls") as string | null) ?? "";
  const deploymentUrlRaw = (form.get("deploymentUrl") as string | null)?.trim() ?? "";
  const termCountRaw = (form.get("termCount") as string | null) ?? "";
  const githubTeamRaw = (form.get("githubTeamSlug") as string | null)?.trim() ?? "";
  const slackChannelRaw = (form.get("slackChannelName") as string | null)?.trim() ?? "";

  const githubTeamSlug =
    githubTeamRaw === ""
      ? null
      : githubTeamRaw
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");

  const slackChannelName =
    slackChannelRaw === ""
      ? null
      : slackChannelRaw
          .toLowerCase()
          .replace(/[^a-z0-9-_\s]/g, "")
          .trim()
          .replace(/\s+/g, "-")
          .slice(0, 80);

  const lines = (raw: string) =>
    raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

  const termCount = Math.max(1, Math.floor(Number(termCountRaw)) || 1);

  await prisma.project.update({
    where: { id: projectId },
    data: {
      calendarEmail: calendarEmailRaw === "" ? null : calendarEmailRaw,
      repoUrls: lines(repoUrlsRaw),
      figmaUrls: lines(figmaUrlsRaw),
      deploymentUrl: deploymentUrlRaw === "" ? null : deploymentUrlRaw,
      termCount,
      githubTeamSlug,
      slackChannelName,
    },
  });
  return back(projectId);
};

export const PROJECT_DETAIL_ACTIONS: Record<string, ProjectActionHandler> = {
  pi,
  "infra-config": infraConfig,
  "partner-link": partnerIntent,
  "partner-end": partnerIntent,
  "partner-unlink": partnerIntent,
  "chart-string": chartString,
  header,
  description,
  "update-image": updateImage,
  status,
  visibility,
  recordingPolicy,
  scopesBulk,
  domains,
  terms,
  details,
};

const CORE_ONLY_INTENTS = [
  "scopesBulk",
  "domains",
  "terms",
  "visibility",
  "status",
  "chart-string",
  "recordingPolicy",
];

export async function runProjectDetailAction(ctx: ProjectActionContext): Promise<ProjectActionResult> {
  const intent = (ctx.form.get("intent") as string | null) ?? "details";
  if (CORE_ONLY_INTENTS.includes(intent) && !ctx.core) {
    return { error: "Only Core or Admin can change project settings." };
  }
  const handler = Object.hasOwn(PROJECT_DETAIL_ACTIONS, intent)
    ? PROJECT_DETAIL_ACTIONS[intent]
    : details;
  return handler(ctx);
}
