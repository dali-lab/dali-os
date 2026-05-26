import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/projects.staffing";
import { requireAuth } from "~/lib/auth";
import { canManageStaffing, canViewStaffing } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { resolvePhotoUrl } from "~/lib/photo";
import { ensureStaffingCycle } from "../lib/staffing-cycle";
import { getSlotBinding } from "../lib/form-slots";
import { StaffingBoard } from "../components/StaffingBoard";
import type {
  Assignment,
  Level,
  MemberInput,
  Preference,
} from "../lib/staffing-board";

export const meta: Route.MetaFunction = () => [{ title: "Staffing · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  // Viewing the board is now Core/Admin only. Mutations are further gated
  // by canManageStaffing (staffing leads); the UI hides drag affordances
  // when canManage is false.
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
  if (terms.length === 0) {
    return { cycle: null, canManage, terms: [] };
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

  const [users, assignmentRows, projects, domains, roleRequests] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: memberUserIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        daliEmail: true,
        dartmouthEmail: true,
        photoUrl: true,
        adminMembership: { select: { id: true } },
        coreAssignments: { select: { leadTitle: true } },
        domainEligibilities: {
          select: {
            level: true,
            domain: { select: { displayName: true } },
          },
        },
      },
    }),
    prisma.staffingAssignment.findMany({
      where: { staffingCycleId: cycle.id, status: "Proposed" },
      select: { userId: true, projectId: true, domainId: true, level: true },
    }),
    prisma.project.findMany({
      where: { status: { not: "Archived" } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: { id: true, name: true, status: true },
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
  ]);

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
  const toMemberInput = async (
    u: (typeof users)[number],
    preferences: Preference[],
    unresolvedBid: boolean,
  ): Promise<MemberInput> => ({
    userId: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.daliEmail ?? u.dartmouthEmail,
    photoUrl: await resolvePhotoUrl(u.photoUrl),
    isAdmin: u.adminMembership !== null,
    coreTitles: Array.from(
      new Set(u.coreAssignments.map((a) => a.leadTitle).filter((t): t is string => !!t)),
    ),
    domainLevels: u.domainEligibilities
      .map((e) => ({ domainName: e.domain.displayName, level: e.level as Level }))
      .sort((a, b) => a.domainName.localeCompare(b.domainName)),
    preferences,
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
      select: {
        id: true,
        firstName: true,
        lastName: true,
        daliEmail: true,
        dartmouthEmail: true,
        photoUrl: true,
        adminMembership: { select: { id: true } },
        coreAssignments: { select: { leadTitle: true } },
        domainEligibilities: {
          select: { level: true, domain: { select: { displayName: true } } },
        },
      },
    });
    const flagged = await Promise.all(
      flaggedUsers.map((u) => toMemberInput(u, [], true)),
    );
    members.push(...flagged);
  }

  const initialAssignments: Assignment[] = assignmentRows.map((a) => ({
    userId: a.userId,
    projectId: a.projectId,
    domainId: a.domainId,
    level: a.level as Level,
  }));

  const domainNames = Object.fromEntries(domains.map((d) => [d.id, d.displayName]));

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
  const bidsFormBound = !!(await getSlotBinding(cycle.id, "project-bids"));

  return {
    cycle: {
      id: cycle.id,
      termId: selectedTermId,
    },
    terms: terms.map((t) => ({ id: t.id, code: t.code })),
    canManage,
    projects,
    members,
    initialAssignments,
    domainNames,
    demandByProject,
    bidsFormBound,
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

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">Staffing</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {data.canManage
            ? "Pick a term, then drag-and-drop project assignments. Changes are saved as Proposed staffing assignments."
            : "Pick a term to view its proposed assignments."}
        </p>
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
        projects={data.projects}
        members={data.members}
        initialAssignments={data.initialAssignments}
        domainNames={data.domainNames}
        demandByProject={data.demandByProject}
        canManage={data.canManage}
      />
    </div>
  );
}
