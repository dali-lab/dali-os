import { prisma } from "~/lib/db";
import { resolvePhotoUrl } from "~/lib/photo";

export type OnboardingRow = {
  userId: string;
  name: string;
  photoUrl: string | null;
  domainKey: string;
  role: string;
  cycleId: string;
  cycleName: string;
  daliEmail: string | null;
  emailCreated: boolean;
  inSlack: boolean;
  figmaInvited: boolean;
  profileSubmitted: boolean;
};

/** Shared roster query for the onboarding board loader, its remind action, and the CSV export (app/hiring/lib/csv-exports.server.ts). */
export async function loadOnboardingRows(args: {
  cycleId: string | "all" | null;
  domainKey: string | null;
}): Promise<{
  cycles: { id: string; name: string; cycleType: string }[];
  selectedCycleId: string | "all" | null;
  domains: { key: string; label: string }[];
  selectedDomain: string | null;
  rows: OnboardingRow[];
  allCycles: boolean;
}> {
  const cycles = await prisma.applicationCycle.findMany({
    select: { id: true, name: true, cycleType: true },
    orderBy: { createdAt: "desc" },
  });

  const allCycles = args.cycleId === "all";
  const selectedCycleId: string | "all" | null = allCycles
    ? "all"
    : args.cycleId && cycles.some((c) => c.id === args.cycleId)
      ? args.cycleId
      : (cycles[0]?.id ?? null);

  if (!selectedCycleId) {
    return {
      cycles,
      selectedCycleId: null,
      domains: [],
      selectedDomain: null,
      rows: [],
      allCycles: false,
    };
  }

  const decisions = await prisma.decision.findMany({
    where: {
      stage: "Released",
      type: "Accepted",
      domainApplication: {
        application: allCycles
          ? {}
          : { applicationCycleId: selectedCycleId as string },
      },
    },
    select: {
      id: true,
      createdAt: true,
      domainApplication: {
        select: {
          domain: { select: { displayName: true, name: true, code: true } },
          application: {
            select: {
              applicationCycleId: true,
              applicationCycle: { select: { id: true, name: true } },
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  photoUrl: true,
                  daliEmail: true,
                  slackUserId: true,
                  figmaInvitedAt: true,
                  daliMember: { select: { onboardedAt: true } },
                  adminMembership: { select: { isStaff: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Collapse re-releases: latest per (user, domain, cycle).
  const seen = new Set<string>();
  const rawRows: Array<Omit<OnboardingRow, "photoUrl"> & { rawPhotoUrl: string | null }> = [];
  for (const d of decisions) {
    const u = d.domainApplication.application.user;
    // Full-time staff aren't new-hire onboarding cases — skip them so a
    // staffer who once applied doesn't surface a stale onboarding checklist.
    if (u.adminMembership?.isStaff === true) continue;
    const dom = d.domainApplication.domain;
    const cycle = d.domainApplication.application.applicationCycle;
    const domainKey = dom.code ?? dom.name;
    const key = `${u.id}:${domainKey}:${cycle.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rawRows.push({
      userId: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.daliEmail || u.id,
      rawPhotoUrl: u.photoUrl,
      domainKey,
      role: dom.displayName ?? dom.name,
      cycleId: cycle.id,
      cycleName: cycle.name,
      daliEmail: u.daliEmail,
      emailCreated: !!u.daliEmail,
      inSlack: !!u.slackUserId,
      figmaInvited: u.figmaInvitedAt != null,
      profileSubmitted: u.daliMember?.onboardedAt != null,
    });
  }

  // Resolve S3/presigned photo URLs once per user (a person can appear on
  // multiple domain/cycle rows).
  const photoByUser = new Map<string, string | null>();
  await Promise.all(
    [...new Set(rawRows.map((r) => r.userId))].map(async (userId) => {
      const raw = rawRows.find((r) => r.userId === userId)?.rawPhotoUrl ?? null;
      photoByUser.set(userId, await resolvePhotoUrl(raw));
    }),
  );

  const allRows: OnboardingRow[] = rawRows.map(({ rawPhotoUrl: _, ...r }) => ({
    ...r,
    photoUrl: photoByUser.get(r.userId) ?? null,
  }));

  const domains = Array.from(
    new Map(allRows.map((r) => [r.domainKey, r.role])).entries(),
  )
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const selectedDomain =
    args.domainKey && domains.some((d) => d.key === args.domainKey)
      ? args.domainKey
      : null;

  const rows = selectedDomain
    ? allRows.filter((r) => r.domainKey === selectedDomain)
    : allRows;

  return {
    cycles,
    selectedCycleId,
    domains,
    selectedDomain,
    rows,
    allCycles,
  };
}
