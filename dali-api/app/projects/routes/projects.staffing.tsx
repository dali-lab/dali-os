import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/projects.staffing";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { STAFFING_MEMBER_SELECT } from "~/lib/prisma-shapes";
import { primaryEmail } from "~/lib/display";
import { canManageStaffing, canViewStaffing } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { resolvePhotoUrl } from "~/lib/photo";
import { parseSessionCookie } from "~/lib/cookies";
import { getPresenceUser } from "~/lib/presence-user";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
import { ensureStaffingCycle } from "../lib/staffing-cycle";
import { getSlotBinding } from "../lib/form-slots";
import { buildSubmissionView } from "../lib/submission-view.server";
import { StaffingBoard } from "../components/StaffingBoard";
import { dedupeLiveAssignments } from "../lib/staffing-board";
import type {
  Assignment,
  BidField,
  Level,
  MemberInput,
  Preference,
} from "../lib/staffing-board";

export const meta: Route.MetaFunction = () => [{ title: "Staffing · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  // Viewing and managing the board are both Core/Admin (canViewStaffing and
  // canManageStaffing are the same membership set); the UI still hides drag
  // affordances when canManage is false (e.g. a future read-only tier).
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const canManage = await canManageStaffing(auth.user.sub);

  // Term picker drives which cycle the board shows. ?term=<code> selects it;
  // default to the current term, then the newest term. Staffing is always
  // open — there's exactly one cycle per term, auto-created on first view.
  // Newest-first; the date fields let us resolve "current term" in-memory
  // instead of a second term query.
  const terms = await prisma.term.findMany({
    orderBy: { sortKey: "desc" },
    select: {
      id: true,
      code: true,
      startDate: true,
      endDate: true,
      sortKey: true,
    },
  });
  const collabToken = parseSessionCookie(request);
  const presenceUser = await getPresenceUser(auth.user.sub);
  const presence = {
    collabToken,
    currentUserId: auth.user.sub,
    presenceUserName: presenceUser?.name ?? auth.user.email,
    presencePhotoUrl: presenceUser?.photoUrl ?? null,
    presenceSubtitle: presenceUser?.subtitle ?? null,
  };

  if (terms.length === 0) {
    return { cycle: null, canManage, terms: [], ...presence };
  }

  // Current term = the one bracketing now(); if we're between terms, the next
  // upcoming one (mirrors lib/roles currentTerm()).
  const now = Date.now();
  const currentTermRow =
    terms.find(
      (t) => t.startDate.getTime() <= now && t.endDate.getTime() >= now,
    ) ??
    [...terms]
      .reverse()
      .find((t) => t.startDate.getTime() > now) ??
    null;

  // The term is addressed by id, matching the shared TermFilter convention
  // used by every other term-scoped page (?term=<id>). Honouring a bare code
  // here would silently miss id-based links from the rest of the app and fall
  // back to the current term, so a chosen term (e.g. 26S) wouldn't stick.
  const requestedId = new URL(request.url).searchParams.get("term");
  const selectedTerm =
    (requestedId && terms.find((t) => t.id === requestedId)) ||
    currentTermRow ||
    terms[0];

  const cycle = await ensureStaffingCycle(
    selectedTerm.id,
    selectedTerm.code,
  );
  const selectedTermId = selectedTerm.id;

  // Optional domain filter (?domain=<id>). Narrows the member pool to people
  // eligible in that domain. Validated against real domains so a stale id falls
  // back to "all". Empty/absent = all domains. The filter is applied to the
  // assembled `members` list below, after all pools are built.
  const requestedDomainId = new URL(request.url).searchParams.get("domain");
  const selectedDomainId =
    requestedDomainId && requestedDomainId !== ""
      ? requestedDomainId
      : null;

  // The pool of members on the board is everyone who submitted at least one
  // StaffingPreference for this cycle. Members who didn't bid don't show up.
  const preferences = await prisma.staffingPreference.findMany({
    where: { staffingCycleId: cycle.id },
    select: {
      userId: true,
      projectId: true,
      domainId: true,
      level: true,
      preferenceRank: true,
      notes: true,
    },
  });

  const memberUserIds = Array.from(new Set(preferences.map((p) => p.userId)));

  const [users, rawAssignmentRows, projects, domains, roleRequests, cardOrders] =
    await Promise.all([
    prisma.user.findMany({
      where: { id: { in: memberUserIds } },
      select: STAFFING_MEMBER_SELECT,
    }),
    // Both in-progress (Proposed) and finalized (Confirmed) assignments — a
    // confirmed roster must stay on the board after finalize, not vanish.
    // Declined rows are audit only. Deduped to one card per (user, cycle) below.
    prisma.staffingAssignment.findMany({
      where: { staffingCycleId: cycle.id, status: { in: ["Proposed", "Confirmed"] } },
      select: { userId: true, projectId: true, domainId: true, level: true, status: true },
    }),
    // Columns are the projects that actually RUN in the selected term
    // (ProjectTerm), not every non-archived project — otherwise the board lists
    // projects from other terms with empty "0 assigned" columns. Projects with
    // bids/assignments in this cycle are unioned in below so a project being
    // staffed never vanishes for a missing ProjectTerm row.
    prisma.project.findMany({
      where: {
        status: { not: "Archived" },
        projectTerms: { some: { termId: selectedTerm.id } },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      // githubTeamSlug pre-fills the Finalize modal's editable GitHub field.
      select: { id: true, name: true, status: true, githubTeamSlug: true, slackChannelName: true },
    }),
    prisma.domain.findMany({ select: { id: true, displayName: true } }),
    // Expected headcount per (project, domain) for THIS term. ProjectRoleRequest
    // is keyed (projectId, termId, domainId, level), so we sum slots across
    // levels to get the headline number a staffing lead actually cares about
    // ("we need 3 devs on this project") and show it under each column title.
    prisma.projectRoleRequest.findMany({
      where: { termId: selectedTerm.id },
      select: { projectId: true, domainId: true, slots: true },
    }),
    // Manual within-column card order. columnKey is carried so a stale order
    // from a card's previous column is ignored once it moves (see below).
    prisma.staffingCardOrder.findMany({
      where: { staffingCycleId: cycle.id },
      select: { userId: true, sortKey: true, columnKey: true },
    }),
  ]);

  // Collapse a member's Proposed + Confirmed rows to one live card (see
  // dedupeLiveAssignments) so a finalized roster stays on the board.
  const assignmentRows = dedupeLiveAssignments(rawAssignmentRows);

  // Union in any non-archived project that's actually being staffed this cycle
  // (a bid, assignment, or role request) but lacks a ProjectTerm row for the
  // term — without it that project would lose its column mid-cycle. Normal
  // projects already came through the term-scoped query above; this only adds
  // the strays, so the board still drops projects from other terms.
  const columnProjectIds = new Set(projects.map((p) => p.id));
  const stagedProjectIds = Array.from(
    new Set([
      ...preferences.map((p) => p.projectId),
      ...assignmentRows.map((a) => a.projectId),
      ...roleRequests.map((r) => r.projectId),
    ]),
  ).filter((id) => !columnProjectIds.has(id));
  if (stagedProjectIds.length > 0) {
    const strays = await prisma.project.findMany({
      where: { id: { in: stagedProjectIds }, status: { not: "Archived" } },
      select: { id: true, name: true, status: true, githubTeamSlug: true, slackChannelName: true },
    });
    projects.push(...strays);
    projects.sort(
      (a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name),
    );
  }

  const prefsByUser = new Map<string, Preference[]>();
  for (const p of preferences) {
    const list = prefsByUser.get(p.userId) ?? [];
    list.push({
      projectId: p.projectId,
      domainId: p.domainId,
      level: p.level as Level,
      preferenceRank: p.preferenceRank,
      notes: p.notes,
    });
    prefsByUser.set(p.userId, list);
  }

  // Same shape for both pools (members with preferences, and bid-submitters
  // whose bids resolved to none). preferences/unresolvedBid are passed in
  // because they differ between the two.
  // Full Project Bids answers per member, so clicking a card shows the whole
  // bid (all form answers), not just the resolved rankings. One call resolves
  // every member's submission for the cycle (reference answers → project/domain
  // names) in a few batched queries — cheaper than a fetch per opened card.
  const bidsBinding = await getSlotBinding(cycle.id, "project-bids");
  const bidFieldsByUser = new Map<string, BidField[]>();
  if (bidsBinding) {
    const view = await buildSubmissionView({
      cycleIds: [cycle.id],
      slot: "project-bids",
      formId: bidsBinding.formId,
    });
    for (const row of view.rows) {
      // Show the member's own form answers (question fields) that have a value.
      // Builtins like "Submitter" are redundant in a per-member modal.
      bidFieldsByUser.set(
        row.userId,
        row.detailFields
          .filter((f) => f.source === "question" && f.value.trim() !== "")
          .map((f) => ({ label: f.label, value: f.value })),
      );
    }
  }

  const toMemberInput = async (
    u: (typeof users)[number],
    preferences: Preference[],
    unresolvedBid: boolean,
  ): Promise<MemberInput> => ({
    userId: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: primaryEmail(u) ?? null,
    photoUrl: await resolvePhotoUrl(u.photoUrl),
    isAdmin: u.adminMembership !== null,
    coreTitles: Array.from(
      new Set(u.coreAssignments.map((a) => a.leadTitle).filter((t): t is string => !!t)),
    ),
    domainLevels: u.domainEligibilities
      .map((e) => ({
        domainId: e.domain.id,
        domainName: e.domain.displayName,
        level: e.level as Level,
      }))
      .sort((a, b) => a.domainName.localeCompare(b.domainName)),
    preferences,
    bidFields: bidFieldsByUser.get(u.id) ?? [],
    unresolvedBid,
  });

  const members: MemberInput[] = await Promise.all(
    users.map((u) => toMemberInput(u, prefsByUser.get(u.id) ?? [], false)),
  );

  // A member who submitted this cycle's Project Bids form but produced no
  // StaffingPreference (their picks had no open role in an eligibility domain)
  // would otherwise vanish — the pool above is preference-derived. Surface them
  // as flagged Unassigned cards so a staffing lead can act. Only users not
  // already in the preference pool need adding.
  const bidSubmitterIds = (
    await prisma.formSubmission.findMany({
      where: { staffingCycleId: cycle.id, slot: "project-bids" },
      select: { userId: true },
      distinct: ["userId"],
    })
  )
    .map((s) => s.userId)
    .filter((id): id is string => !!id && !memberUserIds.includes(id));

  if (bidSubmitterIds.length > 0) {
    const flaggedUsers = await prisma.user.findMany({
      where: { id: { in: bidSubmitterIds } },
      select: STAFFING_MEMBER_SELECT,
    });
    const flagged = await Promise.all(
      flaggedUsers.map((u) => toMemberInput(u, [], true)),
    );
    members.push(...flagged);
  }

  // Members a staffing lead manually placed on the board (no bid) — surfaced as
  // ordinary Unassigned cards (no unresolved-bid flag). Skip anyone already in
  // the pool above (they bid, or were flagged), so their real bid takes over.
  const placedUserIds = new Set(members.map((m) => m.userId));
  const boardMemberIds = (
    await prisma.staffingBoardMember.findMany({
      where: { staffingCycleId: cycle.id },
      select: { userId: true },
    })
  )
    .map((b) => b.userId)
    .filter((id) => !placedUserIds.has(id));

  if (boardMemberIds.length > 0) {
    const manualUsers = await prisma.user.findMany({
      where: { id: { in: boardMemberIds } },
      select: STAFFING_MEMBER_SELECT,
    });
    const manual = await Promise.all(
      manualUsers.map(async (u) => ({
        ...(await toMemberInput(u, [], false)),
        manuallyAdded: true,
      })),
    );
    members.push(...manual);
  }

  // Apply the domain filter to the member pool. A member stays if they're
  // eligible in the domain, OR already have a bid/assignment in it — filtering
  // out a member who's proposed-staffed in that domain would make a real
  // assignment silently vanish from the board. Ignore an unknown domain id
  // (treat as "all") so a stale ?domain= link doesn't empty the board.
  const domainFilterActive =
    selectedDomainId !== null && domains.some((d) => d.id === selectedDomainId);
  if (domainFilterActive) {
    const assignedUserIds = new Set(
      assignmentRows
        .filter((a) => a.domainId === selectedDomainId)
        .map((a) => a.userId),
    );
    const filtered = members.filter(
      (m) =>
        m.domainLevels.some((d) => d.domainId === selectedDomainId) ||
        m.preferences.some((p) => p.domainId === selectedDomainId) ||
        assignedUserIds.has(m.userId),
    );
    members.length = 0;
    members.push(...filtered);
  }

  const initialAssignments: Assignment[] = assignmentRows.map((a) => ({
    userId: a.userId,
    projectId: a.projectId,
    domainId: a.domainId,
    level: a.level as Level,
  }));

  const domainNames = Object.fromEntries(domains.map((d) => [d.id, d.displayName]));

  // Project columns are non-archived only (you can't staff into an archived
  // project), but a member can still have ranked one that was later archived.
  // Resolve names for every project any preference references so the card/modal
  // shows the project name instead of leaking the raw id. Archived projects
  // stay out of `projects` (no droppable column) — this map is labels only.
  const referencedProjectIds = Array.from(
    new Set(preferences.map((p) => p.projectId)),
  ).filter((id) => !projects.some((p) => p.id === id));
  const extraProjectNames =
    referencedProjectIds.length > 0
      ? await prisma.project.findMany({
          where: { id: { in: referencedProjectIds } },
          select: { id: true, name: true },
        })
      : [];
  const projectNames: Record<string, string> = {
    ...Object.fromEntries(projects.map((p) => [p.id, p.name])),
    ...Object.fromEntries(extraProjectNames.map((p) => [p.id, p.name])),
  };

  // Sum slots per (project, domain), drop zero rows, sort the per-project
  // list alphabetically so the chip order is stable run-to-run.
  const demandTotals = new Map<string, number>();
  for (const r of roleRequests) {
    const key = `${r.projectId}:${r.domainId}`;
    demandTotals.set(key, (demandTotals.get(key) ?? 0) + r.slots);
  }
  const demandByProject: Record<
    string,
    Array<{ domainId: string; domainName: string; slots: number }>
  > = {};
  for (const [key, slots] of demandTotals) {
    if (slots <= 0) continue;
    const [projectId, domainId] = key.split(":");
    const list = demandByProject[projectId] ?? (demandByProject[projectId] = []);
    list.push({
      domainId,
      domainName: domainNames[domainId] ?? domainId,
      slots,
    });
  }
  for (const list of Object.values(demandByProject)) {
    list.sort((a, b) => a.domainName.localeCompare(b.domainName));
  }

  // Bids only exist through a bound Project Bids form. If none is bound, the
  // board legitimately has no new bids to staff — surface that so a lead
  // doesn't read an empty board as a bug. (Legacy StaffingPreference rows
  // may still appear; that's the documented exception.)
  const bidsFormBound = !!bidsBinding;

  return {
    cycle: {
      id: cycle.id,
      termId: selectedTermId,
    },
    terms: terms.map((t) => ({ id: t.id, code: t.code })),
    domains: [...domains]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((d) => ({ id: d.id, name: d.displayName })),
    selectedDomainId: domainFilterActive ? selectedDomainId : "",
    canManage,
    projects,
    members,
    initialAssignments,
    // Manual card order rows (userId, columnKey, sortKey). buildBoard applies a
    // row only when its columnKey matches the card's current column, so a stale
    // order from before a move is ignored. Sparse; unordered cards sort by name.
    cardOrder: cardOrders,
    projectNames,
    domainNames,
    demandByProject,
    bidsFormBound,
    ...presence,
  };
}

export default function StaffingPage() {
  const data = useLoaderData<typeof loader>();

  if (!data.cycle) {
    return (
      <div className="flex flex-col gap-4">
        <header>
          <h1 className="font-heading text-2xl font-bold text-foreground">Staffing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            No terms in the database yet — run the v0-reference seed first.
          </p>
        </header>
      </div>
    );
  }

  const page = (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">Staffing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data.canManage
              ? "Pick a term, then drag-and-drop project assignments. Changes are saved as Proposed staffing assignments."
              : "Pick a term to view its proposed assignments."}
          </p>
        </div>
        <PresenceBar />
      </header>

      {!data.bidsFormBound && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No Project Bids form is connected for this term, so there are no new
          bids to staff from. Connect one on the Project Bids page — bids only
          exist through the form.
        </div>
      )}

      <StaffingBoard
        cycleId={data.cycle.id}
        termId={data.cycle.termId}
        terms={data.terms}
        domains={data.domains}
        selectedDomainId={data.selectedDomainId}
        projects={data.projects}
        members={data.members}
        initialAssignments={data.initialAssignments}
        cardOrder={data.cardOrder}
        projectNames={data.projectNames}
        domainNames={data.domainNames}
        demandByProject={data.demandByProject}
        canManage={data.canManage}
      />
    </div>
  );

  return data.collabToken ? (
    <PresenceProvider
      pageId={`staffing:term:${data.cycle.termId}`}
      token={data.collabToken}
      userName={data.presenceUserName}
      userId={data.currentUserId}
      photoUrl={data.presencePhotoUrl}
      subtitle={data.presenceSubtitle}
    >
      {page}
    </PresenceProvider>
  ) : (
    page
  );
}
