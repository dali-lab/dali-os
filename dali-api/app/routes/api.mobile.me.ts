import type { Route } from "./+types/api.mobile.me";
import { prisma } from "~/lib/db.server";
import { currentTerm } from "~/lib/roles";
import { listActiveGroupNamesForUser } from "~/lib/groups";
import { leadLabels, orderedEmails, parseStatusBody } from "~/lib/mobile-format";
import { memberSummaryFor, termFactsForUser } from "~/lib/mobile-members.server";
import { mobileError, mobileJson, requireMobileUser } from "~/lib/mobile-auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  const { userId } = guard;

  const [user, summary, groups, facts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        netId: true,
        classYear: true,
        currentLocation: true,
        timeZone: true,
        daliEmail: true,
        dartmouthEmail: true,
        personalEmail: true,
        phoneNumber: true,
        githubUsername: true,
        domainEligibilities: {
          orderBy: { promotedAt: "asc" },
          select: { level: true, domain: { select: { displayName: true } } },
        },
      },
    }),
    memberSummaryFor(userId),
    listActiveGroupNamesForUser(userId, request),
    termFactsForUser(userId, (await currentTerm(request))?.code ?? null),
  ]);
  if (!user || !summary) return mobileError("Not found", 404);

  return mobileJson({
    user: summary,
    netId: user.netId,
    classYear: user.classYear,
    basedIn: user.currentLocation,
    timeZone: user.timeZone,
    emails: orderedEmails(user),
    phone: user.phoneNumber,
    github: user.githubUsername,
    leadRoles: facts ? leadLabels(facts) : [],
    domainLevels: user.domainEligibilities.map((e) => ({ domain: e.domain.displayName, level: e.level })),
    groups,
  });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "PUT") return mobileError("Method not allowed", 405);
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  const status = parseStatusBody(await request.json().catch(() => null));
  if (!status) return mobileError("status must be 'active' or 'away'", 400);
  await prisma.user.update({
    where: { id: guard.userId },
    data: { presenceAway: status === "away" },
  });
  return mobileJson({ ok: true });
}
