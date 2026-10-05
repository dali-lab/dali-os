import { readdirSync } from "node:fs";
import { join } from "node:path";
import { useMemo, useState } from "react";
import {
  Link,
  redirect,
  useLoaderData,
} from "react-router";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import type { Route } from "./+types/partners";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { currentTerm, isCore } from "~/lib/roles";
import { setApplicationStatus } from "../lib/partner-activity.server";
import {
  isPartnerApplicationStatus,
  type PartnerApplicationStatus,
} from "../lib/partner-application";
import { ContactsRail, type ContactsRailOrg } from "../components/pr-hub/ContactsRail";
import { Pipeline, type PipelineCard } from "../components/pr-hub/Pipeline";
import { LooseEnds, type LooseEnd } from "../components/pr-hub/LooseEnds";
import { TermRibbon, type RibbonTerm } from "../components/pr-hub/TermRibbon";
import { ProjectStats } from "../components/pr-hub/ProjectStats";
import { TermMatrix, type TermMatrixRow } from "../components/pr-hub/TermMatrix";
import { ProjectDrawer, type DrawerApplication } from "../components/pr-hub/ProjectDrawer";
import { FloatingLogos } from "../components/pr-hub/FloatingLogos";
import "../components/pr-hub/partner-hub.css";

const LOGO_EXTS = new Set([".svg", ".png", ".webp", ".jpg", ".jpeg", ".gif", ".avif"]);
const LOGO_DIR = join(process.cwd(), "public", "partners");

// Reads up to `max` image filenames from /public/partners/. No DB coupling,
// no slug matching: the hero scatter shows whatever's actually in the folder.
function readPartnerLogoFiles(max: number): string[] {
  try {
    return readdirSync(LOGO_DIR)
      .filter((f) => LOGO_EXTS.has(("." + f.split(".").pop()?.toLowerCase()) as string))
      .sort()
      .slice(0, max)
      .map((f) => `/partners/${f}`);
  } catch {
    return [];
  }
}

// Same `handle` the current partners.tsx carried: this surface hosts its own
// subnav (Hub / Organizations / Applications), so the shell leaves room for it
// above the title row regardless of the current shell flag.
export const handle = { areaSubnav: true };

export const meta: Route.MetaFunction = () => [
  { title: "Partner Relations · DALI OS" },
];

const REJECTION_STAGES = [
  "Intake",
  "Interview",
  "Scoping",
  "Funding",
  "Other",
] as const;

type RejectionStage = (typeof REJECTION_STAGES)[number];

function isRejectionStage(v: unknown): v is RejectionStage {
  return typeof v === "string" && (REJECTION_STAGES as readonly string[]).includes(v);
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");

  const viewerIsCore = await isCore(auth.user.sub, request);
  // Partner Relations hub is Core-only; non-core members hitting the URL go home.
  if (!viewerIsCore) return redirect("/");

  // The hub's three center panes plus the term ribbon fetch together. The
  // kanban cards reuse the same selection the Applications board uses so the
  // two surfaces agree on what "in the funnel" means.
  const nowTerm = await currentTerm(request);
  const nearbyWhere = nowTerm
    ? { sortKey: { gte: nowTerm.sortKey - 2, lte: nowTerm.sortKey + 4 } }
    : {};

  // Hero scatter: just the first N image files from /public/partners/, no DB
  // linkage. Rendered as-is so dropping a new logo into the folder is enough.
  const heroLogos = readPartnerLogoFiles(9);

  const [orgs, applications, todos, terms, projectTerms] = await Promise.all([
    prisma.partnerOrg.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        faviconChar: true,
        createdAt: true,
        projects: { select: { id: true } },
        applications: {
          select: { updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.partnerApplication.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        source: true,
        updatedAt: true,
        summary: true,
        decisionReason: true,
        interviewRating: true,
        ambiguityRating: true,
        fundingModel: true,
        assignedMeeterId: true,
        formSubmissionId: true,
        rejectionStageAt: true,
        rejectionRationale: true,
        partnerOrgId: true,
        partnerOrg: { select: { name: true, faviconChar: true } },
        applicantContact: { select: { name: true, email: true } },
        targetTerms: { select: { term: { select: { code: true } } } },
        domains: { select: { domain: { select: { displayName: true } } } },
      },
    }),
    // The signed-in viewer's own loose-end list.
    prisma.partnerRelationsTodo.findMany({
      where: { userId: auth.user.sub },
      orderBy: [{ done: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        text: true,
        done: true,
        createdAt: true,
        project: { select: { id: true, name: true, iconEmoji: true } },
        partnerOrg: { select: { id: true, name: true, faviconChar: true } },
      },
    }),
    prisma.term.findMany({
      where: nearbyWhere,
      orderBy: { sortKey: "asc" },
      select: {
        id: true,
        code: true,
        sortKey: true,
        projectAssignments: { select: { projectId: true } },
        projectTerms: { select: { projectId: true } },
      },
    }),
    // Project ↔ term linkage: used to count projects per term in the ribbon
    // and to project the TermMatrix rows. One pass, mapped twice.
    prisma.projectTerm.findMany({
      where: nowTerm
        ? { term: { sortKey: { gte: nowTerm.sortKey - 2, lte: nowTerm.sortKey + 4 } } }
        : {},
      select: {
        termId: true,
        project: {
          select: {
            id: true,
            name: true,
            iconEmoji: true,
            partners: {
              select: { partnerOrg: { select: { name: true } } },
            },
            roleRequests: {
              select: {
                termId: true,
                slots: true,
                domain: { select: { displayName: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const railOrgs: ContactsRailOrg[] = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    faviconChar: o.faviconChar,
    projectCount: o.projects.length,
    lastTouchISO: (o.applications[0]?.updatedAt ?? o.createdAt).toISOString(),
  }));

  const pipelineCards: PipelineCard[] = applications
    // Promoted applications live on project pages, drop them from the hub.
    .filter((a) => a.status !== "Promoted")
    .map((a) => ({
      applicationId: a.id,
      title: a.title,
      partnerName: a.partnerOrg?.name ?? a.applicantContact?.name ?? "Unknown",
      faviconChar: a.partnerOrg?.faviconChar ?? null,
      updatedAt: a.updatedAt.toISOString(),
      status: a.status as PartnerApplicationStatus,
      rejection:
        a.rejectionStageAt || a.rejectionRationale
          ? { stage: a.rejectionStageAt, rationale: a.rejectionRationale }
          : null,
    }));

  const looseEnds: LooseEnd[] = todos.map((t) => ({
    id: t.id,
    text: t.text,
    done: t.done,
    createdAt: t.createdAt.toISOString(),
    project: t.project
      ? { id: t.project.id, name: t.project.name, iconEmoji: t.project.iconEmoji }
      : null,
    partnerOrg: t.partnerOrg
      ? { id: t.partnerOrg.id, name: t.partnerOrg.name, faviconChar: t.partnerOrg.faviconChar }
      : null,
  }));

  // Per-term projection: count distinct projects on either ProjectAssignment
  // (confirmed staff) or ProjectTerm (planned), and partner-orgs reachable
  // from those projects. One pass per term, no N+1.
  const projectsByTerm = new Map<string, Set<string>>();
  for (const t of terms) {
    const set = new Set<string>();
    for (const a of t.projectAssignments) set.add(a.projectId);
    for (const pt of t.projectTerms) set.add(pt.projectId);
    projectsByTerm.set(t.id, set);
  }
  const partnersByProject = new Map<string, Set<string>>();
  for (const pt of projectTerms) {
    const existing = partnersByProject.get(pt.project.id) ?? new Set<string>();
    for (const p of pt.project.partners) existing.add(p.partnerOrg.name);
    partnersByProject.set(pt.project.id, existing);
  }
  const ribbonTerms: RibbonTerm[] = terms.map((t) => {
    const projIds = projectsByTerm.get(t.id) ?? new Set<string>();
    const partners = new Set<string>();
    for (const pid of projIds) {
      const names = partnersByProject.get(pid);
      if (names) for (const n of names) partners.add(n);
    }
    return {
      id: t.id,
      code: t.code,
      sortKey: t.sortKey,
      isCurrent: nowTerm?.id === t.id,
      projectCount: projIds.size,
      partnerCount: partners.size,
    };
  });

  // Pre-build matrix rows per term so the modal doesn't fetch again on open.
  const matrixByTerm = new Map<string, TermMatrixRow[]>();
  for (const t of terms) {
    const rows: TermMatrixRow[] = [];
    const seen = new Set<string>();
    for (const pt of projectTerms) {
      if (pt.termId !== t.id || seen.has(pt.project.id)) continue;
      seen.add(pt.project.id);
      const partners = [...new Set(pt.project.partners.map((p) => p.partnerOrg.name))];
      const rolesForTerm = pt.project.roleRequests.filter((r) => r.termId === t.id);
      rows.push({
        projectId: pt.project.id,
        projectName: pt.project.name,
        iconEmoji: pt.project.iconEmoji,
        partnerNames: partners,
        roles: rolesForTerm.map((r) => ({
          domainName: r.domain.displayName,
          slots: r.slots,
        })),
      });
    }
    matrixByTerm.set(t.id, rows);
  }

  // Dominant domain per project (highest total slots across all terms in the
  // ribbon window). Projects without any role requests are skipped — the
  // breakdown is a shape of *staffed* work, not every row in the hub.
  const dominantDomainByProject = new Map<string, string>();
  const slotTotalsByProject = new Map<string, Map<string, number>>();
  for (const pt of projectTerms) {
    const perDomain = slotTotalsByProject.get(pt.project.id) ?? new Map<string, number>();
    for (const r of pt.project.roleRequests) {
      const name = r.domain.displayName;
      perDomain.set(name, (perDomain.get(name) ?? 0) + r.slots);
    }
    slotTotalsByProject.set(pt.project.id, perDomain);
  }
  for (const [projectId, perDomain] of slotTotalsByProject) {
    let best: { name: string; slots: number } | null = null;
    for (const [name, slots] of perDomain) {
      if (!best || slots > best.slots) best = { name, slots };
    }
    if (best) dominantDomainByProject.set(projectId, best.name);
  }
  const domainCounts = new Map<string, number>();
  for (const name of dominantDomainByProject.values()) {
    domainCounts.set(name, (domainCounts.get(name) ?? 0) + 1);
  }
  const domainBreakdown: { name: string; count: number }[] = [...domainCounts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Per-term projection: the dominant domain of every project planned in the
  // term. Sorted by the global domain order so cubes stack as a rainbow (all
  // of one color together, in the same sequence across every term) instead of
  // a scattered mix. Feeds both the per-cube color on the term chart and the
  // right-hand "projects per domain" bars for the selected term.
  const globalDomainOrder = new Map<string, number>();
  domainBreakdown.forEach((d, i) => globalDomainOrder.set(d.name, i));
  const projectDomainsByTerm: Record<string, string[]> = {};
  const domainBreakdownByTerm: Record<string, { name: string; count: number }[]> = {};
  for (const [termId, projIds] of projectsByTerm) {
    const domains: string[] = [];
    const perDomain = new Map<string, number>();
    for (const pid of projIds) {
      const name = dominantDomainByProject.get(pid);
      if (!name) continue;
      domains.push(name);
      perDomain.set(name, (perDomain.get(name) ?? 0) + 1);
    }
    const rank = (name: string) => globalDomainOrder.get(name) ?? Number.MAX_SAFE_INTEGER;
    domains.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    projectDomainsByTerm[termId] = domains;
    domainBreakdownByTerm[termId] = [...perDomain]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  return {
    heroLogos,
    railOrgs,
    pipelineCards,
    applicationDetails: applications.map((application) => ({
      id: application.id,
      summary: application.summary,
      source: application.source,
      decisionReason: application.decisionReason,
      interviewRating: application.interviewRating,
      ambiguityRating: application.ambiguityRating,
      fundingModel: application.fundingModel,
      assignedMeeterId: application.assignedMeeterId,
      formSubmissionId: application.formSubmissionId,
      contactName: application.applicantContact?.name ?? null,
      contactEmail: application.applicantContact?.email ?? null,
      partnerOrgId: application.partnerOrgId,
      targetTermCodes: application.targetTerms.map((t) => t.term.code),
      domainNames: application.domains.map((d) => d.domain.displayName),
    })),
    looseEnds,
    ribbonTerms,
    domainBreakdown,
    projectDomainsByTerm,
    domainBreakdownByTerm,
    matrixByTerm: Object.fromEntries(matrixByTerm),
    canEditPipeline: viewerIsCore,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    console.warn("[partners/action] unauthenticated");
    return redirectToLogin(request);
  }
  const form = await request.formData();
  const intent = String(form.get("_intent") ?? "");
  console.warn(`[partners/action] intent=${intent} user=${auth.user.sub}`);

  // Loose-end CRUD is per-user: any authenticated lab member can manage their
  // own list; permission checks for pipeline/favicon live below.
  if (intent === "todo/create") {
    const text = String(form.get("text") ?? "").trim();
    if (!text) return { ok: false, error: "Text required." };
    const projectId = String(form.get("projectId") ?? "") || null;
    const partnerOrgId = String(form.get("partnerOrgId") ?? "") || null;
    try {
      const row = await prisma.partnerRelationsTodo.create({
        data: { userId: auth.user.sub, text, projectId, partnerOrgId },
      });
      console.warn(`[partners/action] todo/create ok id=${row.id}`);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[partners/action] todo/create FAILED", message);
      return { ok: false, error: message };
    }
  }
  if (intent === "todo/toggle") {
    const id = String(form.get("id") ?? "");
    const done = form.get("done") === "1";
    if (!id) return { ok: false, error: "Missing id." };
    // Scope the update to the current user so one viewer can't flip someone
    // else's row.
    await prisma.partnerRelationsTodo.updateMany({
      where: { id, userId: auth.user.sub },
      data: { done },
    });
    return { ok: true };
  }
  if (intent === "todo/delete") {
    const id = String(form.get("id") ?? "");
    if (!id) return { ok: false, error: "Missing id." };
    await prisma.partnerRelationsTodo.deleteMany({
      where: { id, userId: auth.user.sub },
    });
    return { ok: true };
  }

  // The rest require Core (same gate as the Applications board drag API).
  if (!(await isCore(auth.user.sub))) {
    return { ok: false, error: "You don't have permission to update applications." };
  }

  if (intent === "favicon/set") {
    const orgId = String(form.get("orgId") ?? "");
    const char = String(form.get("char") ?? "").slice(0, 8);
    if (!orgId) return { ok: false, error: "Missing orgId." };
    await prisma.partnerOrg.update({
      where: { id: orgId },
      data: { faviconChar: char || null },
    });
    return { ok: true };
  }

  if (intent === "pipeline/move") {
    const applicationId = String(form.get("applicationId") ?? "");
    const statusRaw = String(form.get("status") ?? "");
    if (!applicationId || !isPartnerApplicationStatus(statusRaw)) {
      return { ok: false, error: "Invalid pipeline move." };
    }
    const extraData: {
      rejectionStageAt?: RejectionStage | null;
      rejectionRationale?: string | null;
    } = {};
    if (statusRaw === "Rejected") {
      const stage = form.get("rejectionStage");
      const rationale = String(form.get("rejectionRationale") ?? "").trim();
      if (isRejectionStage(stage)) extraData.rejectionStageAt = stage;
      extraData.rejectionRationale = rationale || null;
    } else {
      // Moving back out of Rejected clears the stashed note so a later re-reject
      // can't inherit a stale rationale.
      extraData.rejectionStageAt = null;
      extraData.rejectionRationale = null;
    }
    const prev = await setApplicationStatus(prisma, {
      applicationId,
      to: statusRaw,
      actorUserId: auth.user.sub,
      data: extraData,
    });
    if (prev === null) return { ok: false, error: "Application not found." };
    return { ok: true };
  }

  return { ok: false, error: "Unknown intent." };
}

export default function PartnersHub() {
  const data = useLoaderData<typeof loader>();
  const [openTerm, setOpenTerm] = useState<string | null>(null);
  const [openApplicationId, setOpenApplicationId] = useState<string | null>(null);

  const current = data.ribbonTerms.find((term) => term.isCurrent);
  // Default the per-domain breakdown to the current term so the right panel
  // is useful on first paint without a click.
  const [selectedTermId, setSelectedTermId] = useState<string | null>(current?.id ?? null);
  const activeOpportunities = data.pipelineCards.filter((card) => card.status !== "Rejected").length;

  const openApplication = useMemo<DrawerApplication | null>(() => {
    if (!openApplicationId) return null;
    const card = data.pipelineCards.find((c) => c.applicationId === openApplicationId);
    if (!card) return null;
    const details = data.applicationDetails.find((application) => application.id === openApplicationId);
    // The drawer only needs the display fields the hub already fetched.
    return {
      id: card.applicationId,
      title: card.title,
      status: card.status,
      partnerName: card.partnerName,
      faviconChar: card.faviconChar,
      summary: details?.summary ?? null,
      source: details?.source ?? null,
      decisionReason: details?.decisionReason ?? null,
      interviewRating: details?.interviewRating ?? null,
      ambiguityRating: details?.ambiguityRating ?? null,
      fundingModel: details?.fundingModel ?? null,
      formSubmissionId: details?.formSubmissionId ?? null,
      updatedAt: card.updatedAt,
      contactName: details?.contactName ?? null,
      contactEmail: details?.contactEmail ?? null,
      partnerOrgId: details?.partnerOrgId ?? null,
      targetTermCodes: details?.targetTermCodes ?? [],
      domainNames: details?.domainNames ?? [],
    };
  }, [openApplicationId, data.pipelineCards, data.applicationDetails]);

  return (
    <div className="partner-hub">
      <nav className="hub-nav" aria-label="Partner Relations">
        <Link to="/partners" aria-current="page">Overview</Link>
        <Link to="/partners/organizations">Organizations <ArrowUpRight aria-hidden /></Link>
        <Link to="/partners/applications">Applications <ArrowUpRight aria-hidden /></Link>
      </nav>

      <header className="hub-hero">
        <div className="hub-hero-top">
          <div className="hub-hero-copy">
            <FloatingLogos urls={data.heroLogos} />
            <h1>Partner<br />Relations<span className="hub-title-dot">.</span></h1>
          </div>
          <div className="hub-hero-loose" id="partner-followups">
            <LooseEnds todos={data.looseEnds} />
          </div>
        </div>
        <div className="hub-brief hub-brief-row-layout" aria-label="Workspace overview">
          <a href="#partner-planning" className="hub-brief-row">
            <span className="hub-brief-number hub-teal">{current?.code ?? "—"}</span>
            <div><strong>{current ? "This term, in focus" : "Make room for what’s next"}</strong><span>{current ? `${current.projectCount} projects · ${current.partnerCount} partners this term.` : "Explore project plans across the terms."}</span></div>
            <ArrowDown aria-hidden />
          </a>
          <a href="#partner-pipeline" className="hub-brief-row">
            <span className="hub-brief-number hub-coral">{String(activeOpportunities).padStart(2, "0")}</span>
            <div><strong>Conversations in motion</strong><span>Active opportunities, from first hello to a yes.</span></div>
            <ArrowDown aria-hidden />
          </a>
          <a href="#partner-contacts" className="hub-brief-row">
            <span className="hub-brief-number hub-yellow">{String(data.railOrgs.length).padStart(2, "0")}</span>
            <div><strong>Partners on the wall</strong><span>Jump straight to any organization.</span></div>
            <ArrowDown aria-hidden />
          </a>
        </div>
      </header>

      <div className="hub-content">
        <section id="partner-planning" className="hub-planning" aria-label="Term and project planning">
          <div className="hub-section-heading"><div><h2>Terms & project mix</h2><p>What we’re building, and where the next term takes us.</p></div><span className="hub-section-note">{data.ribbonTerms.length} terms in view</span></div>
          <ProjectStats
            terms={data.ribbonTerms}
            domainsAll={data.domainBreakdown}
            projectDomainsByTerm={data.projectDomainsByTerm}
            domainBreakdownByTerm={data.domainBreakdownByTerm}
            selectedTermId={selectedTermId}
            onSelectTerm={setSelectedTermId}
            onOpenTerm={setOpenTerm}
          />
          <TermRibbon terms={data.ribbonTerms} onPick={setOpenTerm} />
        </section>
        <Pipeline cards={data.pipelineCards} canEdit={data.canEditPipeline} onOpen={setOpenApplicationId} />
        <div id="partner-contacts" className="hub-people-grid hub-people-grid-single">
          <ContactsRail orgs={data.railOrgs} canEdit={data.canEditPipeline} />
        </div>
        <footer className="hub-footer"><span className="hub-diamond" /> Built on relationships. Made at DALI.</footer>
      </div>

      <TermMatrix
        open={openTerm !== null}
        termCode={openTerm ? (data.ribbonTerms.find((t) => t.id === openTerm)?.code ?? "") : ""}
        rows={openTerm ? (data.matrixByTerm[openTerm] ?? []) : []}
        onClose={() => setOpenTerm(null)}
      />

      <ProjectDrawer
        application={openApplication}
        onClose={() => setOpenApplicationId(null)}
      />
    </div>
  );
}
