import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/projects.staffing";
import { requireAuth } from "~/lib/auth";
import { canManageStaffing, canViewStaffing } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { ensureStaffingCycle } from "../lib/staffing-cycle";
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

  const requestedCode = new URL(request.url).searchParams.get("term");
  const selectedTerm =
    (requestedCode && terms.find((t) => t.code === requestedCode)) ||
    currentTermRow ||
    terms[0];

  const cycle = await ensureStaffingCycle(
    selectedTerm.id,
    selectedTerm.code,
  );
  const cycleTermCode = selectedTerm.code;

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

  const [users, assignmentRows, projects, domains] = await Promise.all([
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

  const members: MemberInput[] = users.map((u) => ({
    userId: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.daliEmail ?? u.dartmouthEmail,
    photoUrl: u.photoUrl,
    isAdmin: u.adminMembership !== null,
    coreTitles: Array.from(
      new Set(u.coreAssignments.map((a) => a.leadTitle).filter((t): t is string => !!t)),
    ),
    domainLevels: u.domainEligibilities
      .map((e) => ({ domainName: e.domain.displayName, level: e.level as Level }))
      .sort((a, b) => a.domainName.localeCompare(b.domainName)),
    preferences: prefsByUser.get(u.id) ?? [],
  }));

  const initialAssignments: Assignment[] = assignmentRows.map((a) => ({
    userId: a.userId,
    projectId: a.projectId,
    domainId: a.domainId,
    level: a.level as Level,
  }));

  const domainNames = Object.fromEntries(domains.map((d) => [d.id, d.displayName]));

  return {
    cycle: {
      id: cycle.id,
      termCode: cycleTermCode,
    },
    terms: terms.map((t) => ({ id: t.id, code: t.code })),
    canManage,
    projects,
    members,
    initialAssignments,
    domainNames,
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

      <StaffingBoard
        cycleId={data.cycle.id}
        termCode={data.cycle.termCode}
        terms={data.terms}
        projects={data.projects}
        members={data.members}
        initialAssignments={data.initialAssignments}
        domainNames={data.domainNames}
        canManage={data.canManage}
      />
    </div>
  );
}
