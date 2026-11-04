/**
 * One-off: convert legacy "Renew: X" PartnerApplications (source = Renewal,
 * created by the old partner-renewal-sweep) now that renewal decisions live on
 * ProjectTermStatus and Core decides them on Core → Partners → Renewals.
 *
 *   Accepted  → ProjectTermStatus(project, decision term, continuing, fee)
 *   Rejected  → ProjectTermStatus(project, decision term, not continuing, reason)
 *   Open      → application closed (Rejected, reason Other) with a timeline note;
 *               the project already shows as Undecided on Renewals.
 *
 * The decision term is the term after the latest one the project had started
 * when the renewal application was created. Existing decisions are never
 * overwritten, so the script is safe to re-run.
 *
 * Dry-run by default. Uses DATABASE_URL, or PROD_DATABASE_URL with --prod.
 *
 * Usage:
 *   npx tsx --env-file .env scripts/convert-renewal-applications.ts
 *   npx tsx --env-file .env scripts/convert-renewal-applications.ts --prod
 *   npx tsx --env-file .env scripts/convert-renewal-applications.ts --prod --commit
 */
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { decisionTermFor, planRenewalConversion, type RenewalStage } from "./lib/renewal-conversion";

const COMMIT = process.argv.includes("--commit");
const USE_PROD = process.argv.includes("--prod");
const connectionString = USE_PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!connectionString) {
  console.error(USE_PROD ? "PROD_DATABASE_URL is not set." : "DATABASE_URL is not set.");
  process.exit(1);
}
try {
  console.log(`Target: ${USE_PROD ? "PROD_DATABASE_URL" : "DATABASE_URL"} (${new URL(connectionString).hostname})\n`);
} catch {
  console.log(`Target: ${USE_PROD ? "PROD_DATABASE_URL" : "DATABASE_URL"}\n`);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const RENEW_PREFIX = "Renew: ";

async function projectIdFor(app: { id: string; title: string }): Promise<string | null> {
  const created = await prisma.partnerActivity.findFirst({
    where: { applicationId: app.id, type: "Created" },
    orderBy: { createdAt: "asc" },
    select: { metadata: true },
  });
  const meta = created?.metadata as { renewalOfProjectId?: unknown } | null | undefined;
  if (typeof meta?.renewalOfProjectId === "string") return meta.renewalOfProjectId;
  if (!app.title.startsWith(RENEW_PREFIX)) return null;
  const matches = await prisma.project.findMany({
    where: { name: app.title.slice(RENEW_PREFIX.length) },
    select: { id: true },
    take: 2,
  });
  return matches.length === 1 ? matches[0]!.id : null;
}

async function main() {
  console.log(COMMIT ? "▶ COMMIT mode: changes WILL be written.\n" : "▶ Dry run: nothing is written. Pass --commit to apply.\n");

  const allTerms = await prisma.term.findMany({ select: { id: true, code: true, sortKey: true, startDate: true } });
  const apps = await prisma.partnerApplication.findMany({
    where: { source: "Renewal" },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, stage: true, rejectReason: true, feeCents: true, createdAt: true, partnerOrgId: true },
  });
  console.log(`${apps.length} renewal applications\n`);

  const tally = { decided: 0, closed: 0, skipped: 0 };
  for (const app of apps) {
    const projectId = await projectIdFor(app);
    const projectTerms = projectId
      ? (await prisma.projectTerm.findMany({
          where: { projectId },
          select: { term: { select: { id: true, code: true, sortKey: true, startDate: true } } },
        })).map((pt) => pt.term)
      : [];
    const decisionTerm = projectId ? decisionTermFor(projectTerms, allTerms, app.createdAt) : null;
    const existingDecision =
      projectId && decisionTerm
        ? (await prisma.projectTermStatus.count({ where: { projectId, termId: decisionTerm.id } })) > 0
        : false;

    const action = planRenewalConversion({
      app: { ...app, stage: app.stage as RenewalStage, rejectReason: app.rejectReason ?? null },
      projectId,
      decisionTerm,
      existingDecision,
    });

    if (action.kind === "skip") {
      tally.skipped += 1;
      console.log(`  skip   ${app.title} (${app.stage}): ${action.why}`);
      continue;
    }

    if (action.kind === "decide") {
      tally.decided += 1;
      console.log(
        `  decide ${app.title} → ${action.termCode} ${action.isContinuing ? "continuing" : `not continuing${action.reason ? ` (${action.reason})` : ""}`}`,
      );
      if (COMMIT) {
        await prisma.projectTermStatus.create({
          data: {
            projectId: projectId!,
            termId: action.termId,
            isContinuing: action.isContinuing,
            reason: action.reason,
            feeCents: action.feeCents,
            setBy: "convert-renewal-applications",
          },
        });
      }
      continue;
    }

    tally.closed += 1;
    console.log(`  close  ${app.title} (${app.stage})`);
    if (COMMIT) {
      await prisma.$transaction([
        prisma.partnerApplication.update({
          where: { id: app.id },
          data: { stage: "Rejected", rejectReason: "Other" },
        }),
        prisma.partnerActivity.create({
          data: {
            applicationId: app.id,
            orgId: app.partnerOrgId,
            type: "Note",
            body: "Closed: renewals are now decided on Core → Partners → Renewals.",
          },
        }),
      ]);
    }
  }

  console.log(`\n${tally.decided} decided, ${tally.closed} closed, ${tally.skipped} skipped${COMMIT ? "" : " (dry run)"}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
