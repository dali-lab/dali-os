import { regroupRedirect } from "~/core/lib/regroup-redirect.server";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/projects.staffing";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { STAFFING_MEMBER_SELECT } from "~/lib/prisma-shapes";
import { primaryEmail } from "~/lib/display";
import { canManageStaffing, canViewStaffing } from "~/lib/roles";
import { prisma } from "~/lib/db.server";
import { resolvePhotoUrl } from "~/lib/photo";
import { getCollabToken } from "~/lib/collab-token.server";
import { getPresenceUser } from "~/lib/presence-user";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
import { ensureStaffingCycle } from "../lib/staffing-cycle";
import { getSlotBinding } from "../lib/form-slots";
import { buildSubmissionView } from "../lib/submission-view.server";
import { StaffingBoard } from "../components/StaffingBoard";
import { dedupeLiveAssignments, matchesDomainFilter } from "../lib/staffing-board";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import type {
  Assignment,
  BidField,
  Level,
  MemberInput,
  Preference,
} from "../lib/staffing-board";

const PROJECT_COLUMN_SELECT = {
  id: true,
  name: true,
  status: true,
  iconEmoji: true,
  githubTeamSlug: true,
  slackChannelName: true,
} as const;

export const handle = {
  docKey: "projects.staffing",
  docTitle: "Staffing",
};

export const meta: Route.MetaFunction = () => [{ title: "Staffing · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;
  const regrouped = await regroupRedirect(
    request,
    auth.user.sub,
    "/projects/staffing",
    "/core/staffing",
  );
  if (regrouped) return regrouped;
  // Newest-first; the date fields let us resolve "current term" in-memory
  // instead of a second term query. Everything here is discarded unless the
  // viewer passes the canViewStaffing gate below.
  const [canView, canManage, terms, collabToken, presenceUser] = await Promise.all([
    canViewStaffing(auth.user.sub, request),
    canManageStaffing(auth.user.sub, request),
    prisma.term.findMany({
      orderBy: { sortKey: "desc" },
      select: {
        id: true,
        code: true,
        startDate: true,
        endDate: true,
        sortKey: true,
      },
    }),
    getCollabToken(request),
    getPresenceUser(auth.user.sub),
  ]);
  if (!canView) return redirect("/");
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
  const [
    preferences,
    rawAssignmentRows,
    projects,
    domains,
    roleRequests,
    cardOrders,
    bidsBinding,
    bidSubmitterRows,
    boardMemberRows,
  ] = await Promise.all([
    prisma.staffingPreference.findMany({
      where: { staffingCycleId: cycle.id },
      select: {
        userId: true,
        projectId: true,
        domainId: true,
        level: true,
        preferenceRank: true,
        notes: true,
      },
    }),
    // Both in-progress (Proposed) and finalized (Confirmed) assignments — a
    // confirmed roster must stay on the board after finalize, not vanish.
    // Declined rows are audit only. Deduped to live rows per (user, project) below.
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
      select: PROJECT_COLUMN_SELECT,
    }),
    prisma.domain.findMany({ select: { id: true, displayName: true } }),
    // Read only to union in projects being staffed this term that have no
    // ProjectTerm row (see stagedProjectIds) — the board shows what is assigned,
    // not what was asked for.
    prisma.projectRoleRequest.findMany({
      where: { termId: selectedTerm.id },
      select: { projectId: true },
    }),
    // Manual within-column card order. columnKey is carried so a stale order
    // from a card's previous column is ignored once it moves (see below).
    prisma.staffingCardOrder.findMany({
      where: { staffingCycleId: cycle.id },
      select: { userId: true, sortKey: true, columnKey: true },
    }),
    // Full Project Bids answers per member, so clicking a card shows the whole
    // bid, not just the resolved rankings. One call resolves every member's
    // submission for the cycle in a few batched queries.
    getSlotBinding(cycle.id, "project-bids").then(async (binding) => ({
      binding,
      view: binding
        ? await buildSubmissionView({
            cycleIds: [cycle.id],
            slot: "project-bids",
            formId: binding.formId,
          })
        : null,
    })),
    prisma.formSubmission.findMany({
      where: { staffingCycleId: cycle.id, slot: "project-bids" },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.staffingBoardMember.findMany({
      where: { staffingCycleId: cycle.id },
      select: { userId: true },
    }),
  ]);

  const memberUserIds = Array.from(new Set(preferences.map((p) => p.userId)));
  const memberUserIdSet = new Set(memberUserIds);
  // Bid-submitters whose bids resolved to no StaffingPreference would otherwise
  // vanish, so they surface as flagged Unassigned cards.
  const bidSubmitterIds = bidSubmitterRows
    .map((s) => s.userId)
    .filter((id): id is string => !!id && !memberUserIdSet.has(id));
  // Members a staffing lead manually placed on the board (no bid). Anyone who
  // bid or was flagged is skipped so their real bid takes over.
  const placedIds = new Set([...memberUserIds, ...bidSubmitterIds]);
  const boardMemberIds = boardMemberRows
    .map((b) => b.userId)
    .filter((id) => !placedIds.has(id));

  // Collapse a member's Proposed + Confirmed rows to their live rows per project
  // (see dedupeLiveAssignments) so a finalized roster stays on the board.
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

  const [users, stagedProjects] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: [...memberUserIds, ...bidSubmitterIds, ...boardMemberIds] } },
      select: STAFFING_MEMBER_SELECT,
    }),
    stagedProjectIds.length > 0
      ? prisma.project.findMany({
          where: { id: { in: stagedProjectIds } },
          select: PROJECT_COLUMN_SELECT,
        })
      : [],
  ]);

  const bidsBindingRow = bidsBinding.binding;
  const bidFieldsByUser = new Map<string, BidField[]>();
  for (const row of bidsBinding.view?.rows ?? []) {
    // Show the member's own form answers (question fields) that have a value.
    // Builtins like "Submitter" are redundant in a per-member modal.
    bidFieldsByUser.set(
      row.userId,
      row.detailFields
        .filter((f) => f.source === "question" && f.value.trim() !== "")
        .map((f) => ({ label: f.label, value: f.value })),
    );
  }

  const strays = stagedProjects.filter((p) => p.status !== "Archived");
  if (strays.length > 0) {
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

  const usersById = new Map(users.map((u) => [u.id, u]));
  const usersFor = (ids: string[]) =>
    ids.flatMap((id) => {
      const u = usersById.get(id);
      return u ? [u] : [];
    });

  const members: MemberInput[] = await Promise.all([
    ...usersFor(memberUserIds).map((u) => toMemberInput(u, prefsByUser.get(u.id) ?? [], false)),
    ...usersFor(bidSubmitterIds).map((u) => toMemberInput(u, [], true)),
    ...usersFor(boardMemberIds).map(async (u) => ({
      ...(await toMemberInput(u, [], false)),
      manuallyAdded: true,
    })),
  ]);

  // Apply the domain filter to the member pool — see matchesDomainFilter for
  // what counts as "in this domain" (hired role, not bids). Ignore an unknown
  // domain id (treat as "all") so a stale ?domain= link doesn't empty the board.
  const domainFilterActive =
    selectedDomainId !== null && domains.some((d) => d.id === selectedDomainId);
  if (domainFilterActive) {
    const assignedUserIds = new Set(
      assignmentRows
        .filter((a) => a.domainId === selectedDomainId)
        .map((a) => a.userId),
    );
    const filtered = members.filter((m) =>
      matchesDomainFilter(m, selectedDomainId, assignedUserIds),
    );
    members.length = 0;
    members.push(...filtered);
  }

  const initialAssignments: Assignment[] = assignmentRows.map((a) => ({
    userId: a.userId,
    projectId: a.projectId,
    domainId: a.domainId,
    level: a.level as Level,
    status: a.status as "Proposed" | "Confirmed",
  }));

  const domainNames = Object.fromEntries(domains.map((d) => [d.id, d.displayName]));

  // Project columns are non-archived only (you can't staff into an archived
  // project), but a member can still have ranked one that was later archived.
  // Resolve names for every project any preference references so the card/modal
  // shows the project name instead of leaking the raw id. Archived projects
  // stay out of `projects` (no droppable column) — this map is labels only.
  const preferenceProjectIds = new Set(preferences.map((p) => p.projectId));
  const extraProjectNames = stagedProjects.filter(
    (p) => p.status === "Archived" && preferenceProjectIds.has(p.id),
  );
  const projectNames: Record<string, string> = {
    ...Object.fromEntries(projects.map((p) => [p.id, p.name])),
    ...Object.fromEntries(extraProjectNames.map((p) => [p.id, p.name])),
  };

  // Bids only exist through a bound Project Bids form. If none is bound, the
  // board legitimately has no new bids to staff — surface that so a lead
  // doesn't read an empty board as a bug. (Legacy StaffingPreference rows
  // may still appear; that's the documented exception.)
  const bidsFormBound = !!bidsBindingRow;

  return {
    cycle: {
      id: cycle.id,
      termId: selectedTermId,
    },
    terms: terms.map((t) => ({
      id: t.id,
      code: t.code,
      isCurrent: t.id === currentTermRow?.id,
    })),
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
    bidsFormBound,
    ...presence,
  };
}

export default function StaffingPage() {
  const data = useLoaderData<typeof loader>();
  const { os, pageTitle } = useOsChrome();

  if (!data.cycle) {
    return (
      <div className="flex flex-col gap-4">
        <header>
          <h1 className={pageTitle}>Staffing</h1>
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
        <h1 className={pageTitle}>Staffing</h1>
        <PresenceBar />
      </header>

      {!data.bidsFormBound && (
        <div
          className={cn(
            "border border-os-amber/40 bg-os-amber/10 px-3 py-2 text-sm text-os-amber",
            os ? "rounded-os-item" : "rounded-md",
          )}
        >
          No Project Bids form is connected for this term — connect one on the
          Project Bids page.
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
