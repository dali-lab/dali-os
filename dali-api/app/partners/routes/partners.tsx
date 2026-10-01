import { useMemo, useState } from "react";
import {
  Link,
  redirect,
  useLoaderData,
  useNavigate,
} from "react-router";
import { FileText, LayoutGrid, Plus } from "lucide-react";
import type { Route } from "./+types/partners";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { canViewStaffing, currentTerm, isCore, isLabMember } from "~/lib/roles";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { setApplicationStatus } from "../lib/partner-activity.server";
import {
  isPartnerApplicationStatus,
  type PartnerApplicationStatus,
} from "../lib/partner-application";
import { ContactsRail, type ContactsRailOrg } from "../components/pr-hub/ContactsRail";
import { Pipeline, type PipelineCard } from "../components/pr-hub/Pipeline";
import { LooseEnds, type LooseEnd } from "../components/pr-hub/LooseEnds";
import { TermRibbon, type RibbonTerm } from "../components/pr-hub/TermRibbon";
import { TermMatrix, type TermMatrixRow } from "../components/pr-hub/TermMatrix";
import { ProjectDrawer, type DrawerApplication } from "../components/pr-hub/ProjectDrawer";

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

  const [labMember, canViewApplications, viewerIsCore] = await Promise.all([
    isLabMember(auth.user.sub, request),
    canViewStaffing(auth.user.sub, request),
    isCore(auth.user.sub, request),
  ]);
  if (!labMember && !canViewApplications) return redirect("/");

  // The hub's three center panes plus the term ribbon fetch together. The
  // kanban cards reuse the same selection the Applications board uses so the
  // two surfaces agree on what "in the funnel" means.
  const nowTerm = await currentTerm(request);
  const nearbyWhere = nowTerm
    ? { sortKey: { gte: nowTerm.sortKey - 2, lte: nowTerm.sortKey + 4 } }
    : {};

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
        updatedAt: true,
        summary: true,
        rejectionStageAt: true,
        rejectionRationale: true,
        partnerOrgId: true,
        partnerOrg: { select: { name: true, faviconChar: true } },
        applicantContact: { select: { name: true, email: true } },
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

  return {
    railOrgs,
    pipelineCards,
    looseEnds,
    ribbonTerms,
    matrixByTerm: Object.fromEntries(matrixByTerm),
    canEditPipeline: viewerIsCore,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const form = await request.formData();
  const intent = String(form.get("_intent") ?? "");

  // Loose-end CRUD is per-user: any authenticated lab member can manage their
  // own list; permission checks for pipeline/favicon live below.
  if (intent === "todo/create") {
    const text = String(form.get("text") ?? "").trim();
    if (!text) return { ok: false, error: "Text required." };
    const projectId = String(form.get("projectId") ?? "") || null;
    const partnerOrgId = String(form.get("partnerOrgId") ?? "") || null;
    await prisma.partnerRelationsTodo.create({
      data: { userId: auth.user.sub, text, projectId, partnerOrgId },
    });
    return { ok: true };
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
  const navigate = useNavigate();
  const [openTerm, setOpenTerm] = useState<string | null>(null);
  const [openApplicationId, setOpenApplicationId] = useState<string | null>(null);

  const areaTabs = [
    {
      label: "Hub",
      icon: LayoutGrid,
      active: true,
      onClick: () => navigate("/partners"),
    },
    {
      label: "Organizations",
      icon: LayoutGrid,
      active: false,
      onClick: () => navigate("/partners/organizations"),
    },
    {
      label: "Applications",
      icon: FileText,
      active: false,
      onClick: () => navigate("/partners/applications"),
    },
  ];

  const openApplication = useMemo<DrawerApplication | null>(() => {
    if (!openApplicationId) return null;
    const card = data.pipelineCards.find((c) => c.applicationId === openApplicationId);
    if (!card) return null;
    // The drawer only needs the display fields the hub already fetched.
    return {
      id: card.applicationId,
      title: card.title,
      status: card.status,
      partnerName: card.partnerName,
      faviconChar: card.faviconChar,
      summary: null,
      updatedAt: card.updatedAt,
      contactName: null,
      contactEmail: null,
      partnerOrgId: null,
    };
  }, [openApplicationId, data.pipelineCards]);

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <h1 className="font-heading text-foreground text-4xl font-medium">
          Partner Relations
        </h1>
        <Link
          to="/partners/applications"
          className="os-add-btn"
        >
          <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
          Log new opportunity
        </Link>
      </header>

      <div className="flex items-center gap-4">
        <SegmentedTabButtons label="Partners" items={areaTabs} />
      </div>

      <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_300px] gap-3">
        <ContactsRail orgs={data.railOrgs} />
        <Pipeline cards={data.pipelineCards} />
        <LooseEnds todos={data.looseEnds} />
      </main>

      <TermRibbon terms={data.ribbonTerms} onPick={setOpenTerm} />

      {openTerm && (
        <TermMatrix
          termCode={data.ribbonTerms.find((t) => t.id === openTerm)?.code ?? ""}
          rows={data.matrixByTerm[openTerm] ?? []}
          onClose={() => setOpenTerm(null)}
        />
      )}

      {openApplication && (
        <ProjectDrawer
          application={openApplication}
          onClose={() => setOpenApplicationId(null)}
        />
      )}
    </div>
  );
}
