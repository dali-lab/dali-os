import { defineCsvExport, type CsvExportContext } from "~/lib/csv-export.server";
import { prisma } from "~/lib/db";
import { getUserRoles, hasCycleAccess, isCore } from "~/lib/roles";
import { getPipelineData } from "./pipeline.server";
import { listActiveWaitlistEntries } from "./waitlist.server";
import { loadOnboardingRows } from "./onboarding.server";
import { getCycleConfidentialityState, requireApiSignedOrForbidden } from "./confidentiality";
import { selectActiveCycleForDomainLead } from "./cycle-picker";

const dateStamp = () => new Date().toISOString().slice(0, 10);

// ─── Pipeline drill-down (/hiring) — mirrors hiring.tsx loader: Core or ─────
// DomainLead only. getPipelineData reads its own ?cycleId=/?domain=/?status=
// straight off ctx.request, same as the page loader passing the real Request.

defineCsvExport({
  id: "hiring-pipeline",
  filename: () => `hiring-pipeline-${dateStamp()}.csv`,
  authorize: async (ctx) => {
    const roles = await getUserRoles(ctx.user.sub);
    return roles.isCore || roles.isDomainLead;
  },
  async rows(ctx) {
    const data = await getPipelineData(ctx.user.sub, ctx.request);
    const out: unknown[][] = [["Applicant", "Status", "Domain", "Reviewers", "Interviewers"]];
    for (const r of data.rows) {
      out.push([r.applicantName, r.statusLabel, r.domain, r.reviewers.join("; "), r.interviewers.join("; ")]);
    }
    return out;
  },
});

// ─── Applications database (/hiring/applications) — mirrors applications.tsx
// loader exactly: Core sees every domain in the cycle; a reviewer sees only
// the domains they're a CycleReviewer for IN THAT CYCLE; an interviewer with
// no reviewer/domain-lead/core standing is allowed in only if they're a
// CycleInterviewer on at least one cycle (the same "hard gate" as the page).

async function resolveApplicationsAccess(ctx: CsvExportContext) {
  const { isCore: core, isAdmin, isDomainLead } = await getUserRoles(ctx.user.sub);
  const reviewerRows = await prisma.cycleReviewer.findMany({
    where: { userId: ctx.user.sub },
    select: { applicationCycleId: true, domainId: true },
  });

  if (!core && !isAdmin && !isDomainLead && reviewerRows.length === 0) {
    const interviewer = await prisma.cycleInterviewer.findFirst({
      where: { userId: ctx.user.sub },
      select: { id: true },
    });
    if (!interviewer) return null;
  }

  const reviewerCycleIds = new Set(reviewerRows.map((r) => r.applicationCycleId));
  const cycles = await prisma.applicationCycle.findMany({
    where: core ? {} : { id: { in: [...reviewerCycleIds] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (cycles.length === 0) return null;

  const requested = ctx.searchParams.get("cycle");
  const selectedCycleId = (requested && cycles.find((c) => c.id === requested)?.id) || cycles[0].id;

  const cycleDomainRows = await prisma.domainApplicationCycle.findMany({
    where: { applicationCycleId: selectedCycleId },
    select: { domainId: true },
  });
  const allCycleDomainIds = cycleDomainRows.map((d) => d.domainId);
  const reviewerDomainIdsThisCycle = reviewerRows
    .filter((r) => r.applicationCycleId === selectedCycleId)
    .map((r) => r.domainId);
  const visibleDomainIds = core ? allCycleDomainIds : reviewerDomainIdsThisCycle;

  return { selectedCycleId, visibleDomainIds };
}

defineCsvExport({
  id: "hiring-applications",
  filename: () => `hiring-applications-${dateStamp()}.csv`,
  authorize: async (ctx) => (await resolveApplicationsAccess(ctx)) !== null,
  async rows(ctx) {
    const access = await resolveApplicationsAccess(ctx);
    const out: unknown[][] = [["Applicant", "Email", "Domain", "Status", "Submitted", "Review Count"]];
    if (!access || access.visibleDomainIds.length === 0) return out;

    const domainApps = await prisma.domainApplication.findMany({
      where: {
        application: { applicationCycleId: access.selectedCycleId },
        selected: true,
        OR: [
          { challengeVersion: { domainId: { in: access.visibleDomainIds } } },
          { domainId: { in: access.visibleDomainIds } },
        ],
      },
      select: {
        domain: { select: { displayName: true } },
        challengeVersion: { select: { domain: { select: { displayName: true } } } },
        application: {
          select: {
            user: { select: { firstName: true, lastName: true, daliEmail: true, dartmouthEmail: true } },
            statusUpdates: { orderBy: { createdAt: "desc" }, select: { newStatus: true, createdAt: true } },
          },
        },
        _count: { select: { reviews: true } },
      },
    });

    for (const da of domainApps) {
      const u = da.application.user;
      const updates = da.application.statusUpdates;
      const status = updates[0]?.newStatus ?? "Draft";
      const submittedAt = updates.find((s) => s.newStatus === "Submitted")?.createdAt ?? null;
      out.push([
        `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "—",
        u.daliEmail ?? u.dartmouthEmail ?? "",
        da.domain?.displayName ?? da.challengeVersion?.domain?.displayName ?? "—",
        status,
        submittedAt ? submittedAt.toISOString() : "",
        da._count.reviews,
      ]);
    }
    return out;
  },
});

// ─── Domain Lead dashboard (/hiring/domain-lead) — inherently self-scoped by
// `where: { userId: ctx.user.sub }` against DomainLeadAssignment (a non-lead
// gets zero rows, matching the page). Each domain section is further scoped
// to that domain's single "active" cycle, exactly as domain-lead.tsx's
// loader resolves it (selectActiveCycleForDomainLead) — the page never shows
// every cycle a domain has ever run, only the current/selected one, so an
// export with no cycle filter would hand a domain lead applicant data from
// past cycles the dashboard never displays to them.

type DomainLeadCycleScope = { domainId: string; domainName: string; cycleId: string };

async function myActiveDomainLeadCycles(ctx: CsvExportContext): Promise<DomainLeadCycleScope[]> {
  const assignments = await prisma.domainLeadAssignment.findMany({
    where: { userId: ctx.user.sub },
    select: { domainId: true, domain: { select: { displayName: true } } },
  });
  const requestedCycleId = ctx.searchParams.get("cycle");

  const scopes: DomainLeadCycleScope[] = [];
  for (const a of assignments) {
    const allCycles = await prisma.applicationCycle.findMany({
      where: { domains: { some: { domainId: a.domainId } } },
      include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    const candidateCycles = allCycles.filter((c) => {
      const status = c.statusUpdates[0]?.newStatus;
      return status && ["Open", "UnderReview", "Draft"].includes(status);
    });
    const activeCycle = selectActiveCycleForDomainLead(candidateCycles, requestedCycleId);
    if (activeCycle) {
      scopes.push({ domainId: a.domainId, domainName: a.domain.displayName, cycleId: activeCycle.id });
    }
  }
  return scopes;
}

defineCsvExport({
  id: "hiring-domain-lead-applications",
  filename: () => `hiring-domain-lead-applications-${dateStamp()}.csv`,
  authorize: async () => true, // self-scoped by userId — see comment above
  async rows(ctx) {
    const scopes = await myActiveDomainLeadCycles(ctx);
    const out: unknown[][] = [["Domain", "Applicant", "Status", "Reviews", "Decisions"]];
    for (const s of scopes) {
      const apps = await prisma.domainApplication.findMany({
        where: {
          selected: true,
          OR: [{ challengeVersion: { domainId: s.domainId } }, { domainId: s.domainId }],
          application: {
            applicationCycleId: s.cycleId,
            statusUpdates: { some: { newStatus: "Submitted" } },
          },
        },
        select: {
          application: {
            select: {
              user: { select: { firstName: true, lastName: true } },
              statusUpdates: { orderBy: { createdAt: "desc" }, take: 1, select: { newStatus: true } },
            },
          },
          reviews: { select: { id: true } },
          decisions: { orderBy: { createdAt: "desc" }, take: 1, select: { type: true } },
        },
      });
      for (const app of apps) {
        const u = app.application.user;
        out.push([
          s.domainName,
          `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
          app.application.statusUpdates[0]?.newStatus ?? "",
          app.reviews.length,
          app.decisions[0]?.type ?? "",
        ]);
      }
    }
    return out;
  },
});

defineCsvExport({
  id: "hiring-domain-lead-interviews",
  filename: () => `hiring-domain-lead-interviews-${dateStamp()}.csv`,
  authorize: async () => true, // self-scoped by userId — see comment above
  async rows(ctx) {
    const scopes = await myActiveDomainLeadCycles(ctx);
    const out: unknown[][] = [["Domain", "Applicant", "Start Time", "Status", "Interviewers"]];
    for (const s of scopes) {
      const interviews = await prisma.interview.findMany({
        where: {
          applicationCycleId: s.cycleId,
          status: { in: ["Scheduled", "Completed"] },
          domainApplication: {
            OR: [{ challengeVersion: { domainId: s.domainId } }, { domainId: s.domainId }],
          },
        },
        include: {
          domainApplication: {
            include: { application: { include: { user: { select: { firstName: true, lastName: true } } } } },
          },
          assignments: {
            where: { status: "Active" },
            include: { cycleInterviewer: { include: { user: { select: { firstName: true, lastName: true } } } } },
          },
        },
        orderBy: { startTime: "asc" },
      });
      for (const iv of interviews) {
        const u = iv.domainApplication.application.user;
        out.push([
          s.domainName,
          `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
          iv.startTime.toISOString(),
          iv.status,
          iv.assignments.map((asn) => `${asn.cycleInterviewer.user.firstName} ${asn.cycleInterviewer.user.lastName}`.trim()).join("; "),
        ]);
      }
    }
    return out;
  },
});

// ─── Lead cycle dashboard (/hiring/lead/cycle/:id) — four flat tables. The ──
// fifth on-page table (availability-coverage heatmap) is a day×time grid, not
// a row dataset — excluded from this pass along with the other matrix-shaped
// views (RosterMatrix, MentorGrid), per the same scope decision.
//
// Reviewers/Interviews/Interviewers mirror the three api.cycles.$cycleId.*
// resource routes exactly (same hasCycleAccess gate, same query). Decisions
// mirrors lead.cycle.$id.tsx's own loader query (isCore-gated, not
// hasCycleAccess — that page is Core/Admin only, unlike the api.cycles.*
// endpoints which also admit reviewers/interviewers/domain leads).

async function cycleAccessCtx(ctx: CsvExportContext): Promise<boolean> {
  const cycleId = ctx.searchParams.get("cycleId");
  if (!cycleId) return false;
  return hasCycleAccess(ctx.user.sub, cycleId);
}

defineCsvExport({
  id: "hiring-cycle-reviewers",
  filename: (ctx) => `hiring-cycle-${ctx.searchParams.get("cycleId")}-reviewers-${dateStamp()}.csv`,
  authorize: cycleAccessCtx,
  async rows(ctx) {
    const cycleId = ctx.searchParams.get("cycleId")!;
    const reviewers = await prisma.cycleReviewer.findMany({
      where: { applicationCycleId: cycleId },
      include: { user: { select: { firstName: true, lastName: true, daliEmail: true } }, domain: { select: { displayName: true } } },
    });
    const out: unknown[][] = [["Reviewer", "Email", "Domain"]];
    for (const r of reviewers) {
      out.push([`${r.user.firstName} ${r.user.lastName}`.trim(), r.user.daliEmail ?? "", r.domain.displayName]);
    }
    return out;
  },
});

defineCsvExport({
  id: "hiring-cycle-interviews",
  filename: (ctx) => `hiring-cycle-${ctx.searchParams.get("cycleId")}-interviews-${dateStamp()}.csv`,
  authorize: async (ctx) => {
    if (!(await cycleAccessCtx(ctx))) return false;
    // Mirrors api.cycles.$cycleId.interviews.ts exactly: cycle access alone
    // isn't enough — a reviewer/interviewer who hasn't signed this cycle's
    // confidentiality agreement is blocked from the JSON endpoint too.
    const cycleId = ctx.searchParams.get("cycleId")!;
    return (await requireApiSignedOrForbidden(ctx.user.sub, cycleId)) === null;
  },
  async rows(ctx) {
    const cycleId = ctx.searchParams.get("cycleId")!;
    const interviews = await prisma.interview.findMany({
      where: { applicationCycleId: cycleId },
      include: {
        domainApplication: {
          include: {
            application: { include: { user: { select: { firstName: true, lastName: true } } } },
            challengeVersion: { include: { domain: { select: { displayName: true } } } },
            domain: { select: { displayName: true } },
          },
        },
        assignments: {
          include: { cycleInterviewer: { include: { user: { select: { firstName: true, lastName: true } } } } },
        },
      },
      orderBy: { startTime: "asc" },
    });
    const out: unknown[][] = [["Applicant", "Domain", "Start Time", "Status", "Interviewers"]];
    for (const iv of interviews) {
      const u = iv.domainApplication.application.user;
      const domainName = iv.domainApplication.domain?.displayName ?? iv.domainApplication.challengeVersion?.domain?.displayName ?? "";
      out.push([
        `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
        domainName,
        iv.startTime.toISOString(),
        iv.status,
        iv.assignments.map((a) => `${a.cycleInterviewer.user.firstName} ${a.cycleInterviewer.user.lastName}`.trim()).join("; "),
      ]);
    }
    return out;
  },
});

defineCsvExport({
  id: "hiring-cycle-interviewers",
  filename: (ctx) => `hiring-cycle-${ctx.searchParams.get("cycleId")}-interviewers-${dateStamp()}.csv`,
  authorize: cycleAccessCtx,
  async rows(ctx) {
    const cycleId = ctx.searchParams.get("cycleId")!;
    const interviewers = await prisma.cycleInterviewer.findMany({
      where: { applicationCycleId: cycleId },
      include: {
        user: { select: { firstName: true, lastName: true, daliEmail: true } },
        domain: { select: { name: true } },
        availabilityBlocks: { select: { startTime: true, endTime: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const out: unknown[][] = [["Interviewer", "Email", "Domain", "Availability Blocks", "Availability Hours"]];
    for (const i of interviewers) {
      const totalMs = i.availabilityBlocks.reduce((sum, b) => sum + (b.endTime.getTime() - b.startTime.getTime()), 0);
      out.push([
        `${i.user.firstName} ${i.user.lastName}`.trim(),
        i.user.daliEmail ?? "",
        i.domain.name,
        i.availabilityBlocks.length,
        (totalMs / (1000 * 60 * 60)).toFixed(1),
      ]);
    }
    return out;
  },
});

defineCsvExport({
  id: "hiring-cycle-decisions",
  filename: (ctx) => `hiring-cycle-${ctx.searchParams.get("cycleId")}-decisions-${dateStamp()}.csv`,
  authorize: async (ctx) => {
    const cycleId = ctx.searchParams.get("cycleId");
    if (!cycleId) return false;
    if (!(await isCore(ctx.user.sub))) return false;
    // Mirrors lead.cycle.$id.tsx exactly: the page zeroes out finalDecisions
    // (applicant PII + decision type) whenever this cycle's confidentiality
    // agreement isn't signed, even for Core members who can otherwise reach
    // the page. A single-purpose decisions export has no "rest of the page"
    // to fall back to, so it blocks outright rather than returning an empty
    // CSV the way the multi-panel page silently does for this one section.
    const state = await getCycleConfidentialityState(ctx.user.sub, cycleId);
    return state.status === "signed";
  },
  async rows(ctx) {
    const cycleId = ctx.searchParams.get("cycleId")!;
    const decisions = await prisma.decision.findMany({
      where: {
        stage: "Final",
        children: { none: { stage: "Released" } },
        domainApplication: { application: { applicationCycleId: cycleId } },
      },
      include: {
        domainApplication: {
          include: {
            application: { include: { user: { select: { firstName: true, lastName: true } } } },
            domain: { select: { name: true } },
            challengeVersion: { include: { domain: { select: { name: true } } } },
          },
        },
        madeBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    const out: unknown[][] = [["Applicant", "Domain", "Decision", "Made By"]];
    for (const d of decisions) {
      const u = d.domainApplication.application.user;
      const domainName = d.domainApplication.domain?.name ?? d.domainApplication.challengeVersion?.domain?.name ?? "";
      out.push([
        `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
        domainName,
        d.type,
        d.madeBy ? `${d.madeBy.firstName} ${d.madeBy.lastName}`.trim() : "",
      ]);
    }
    return out;
  },
});

// ─── Intern-to-full cycle (/hiring/lead/intern-to-full-cycle/:id) — mirrors ─
// that route's own loader: isCore-gated, Draft+Final decisions.

defineCsvExport({
  id: "hiring-intern-to-full-decisions",
  filename: (ctx) => `intern-to-full-${ctx.searchParams.get("cycleId")}-decisions-${dateStamp()}.csv`,
  authorize: async (ctx) => {
    if (!ctx.searchParams.get("cycleId")) return false;
    return isCore(ctx.user.sub);
  },
  async rows(ctx) {
    const cycleId = ctx.searchParams.get("cycleId")!;
    const decisions = await prisma.decision.findMany({
      where: {
        stage: { in: ["Draft", "Final"] },
        children: { none: { stage: "Released" } },
        domainApplication: { application: { applicationCycleId: cycleId } },
      },
      include: {
        domainApplication: {
          include: {
            application: { include: { user: { select: { firstName: true, lastName: true } } } },
            domain: { select: { displayName: true } },
          },
        },
        madeBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    const out: unknown[][] = [["Applicant", "Domain", "Stage", "Decision", "Made By"]];
    for (const d of decisions) {
      const u = d.domainApplication.application.user;
      out.push([
        `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
        d.domainApplication.domain?.displayName ?? "",
        d.stage,
        d.type,
        d.madeBy ? `${d.madeBy.firstName} ${d.madeBy.lastName}`.trim() : "",
      ]);
    }
    return out;
  },
});

// ─── Onboarding (/hiring/onboarding) — mirrors onboarding.tsx loader, ───────
// reusing its shared roster query directly.

defineCsvExport({
  id: "hiring-onboarding",
  filename: () => `hiring-onboarding-${dateStamp()}.csv`,
  authorize: async (ctx) => isCore(ctx.user.sub),
  async rows(ctx) {
    const requested = ctx.searchParams.get("cycle");
    const data = await loadOnboardingRows({
      cycleId: requested === "all" ? "all" : requested,
      domainKey: ctx.searchParams.get("domain"),
    });
    const out: unknown[][] = [
      ["Member", "Domain", "Role", "Cycle", "Email Created", "In Slack", "Figma Invited", "Profile Submitted"],
    ];
    for (const r of data.rows) {
      out.push([
        r.name,
        r.domainKey,
        r.role,
        r.cycleName,
        r.emailCreated ? "yes" : "no",
        r.inSlack ? "yes" : "no",
        r.figmaInvited ? "yes" : "no",
        r.profileSubmitted ? "yes" : "no",
      ]);
    }
    return out;
  },
});

// ─── Waitlists (/hiring/waitlists) — mirrors waitlists.tsx loader. ──────────

defineCsvExport({
  id: "hiring-waitlists",
  filename: () => `hiring-waitlists-${dateStamp()}.csv`,
  authorize: async (ctx) => isCore(ctx.user.sub),
  async rows() {
    const entries = await listActiveWaitlistEntries();
    const out: unknown[][] = [["Cycle", "Domain", "Rank", "Applicant"]];
    for (const e of entries) {
      const name =
        `${e.applicant.firstName ?? ""} ${e.applicant.lastName ?? ""}`.trim() ||
        e.applicant.dartmouthEmail ||
        "(unknown)";
      out.push([e.cycle.name, e.domain.displayName ?? e.domain.name, e.rank, name]);
    }
    return out;
  },
});
