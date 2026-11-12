import { useLoaderData } from "react-router";
import type { Route } from "./+types/events.check-in.$eventId";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { isEventCheckInOpen } from "~/hiring/lib/hiring-events.server";
import { applicantPortalPath } from "~/hiring/lib/applicant-groups";
import { formatSessionWhen } from "~/lib/display";
import { resolveUserTimeZone } from "~/lib/timezone";
import { SelfCheckInCard } from "~/components/SelfCheckInCard";
import { useOsShellRoot } from "~/lib/os-shell";

export const meta: Route.MetaFunction = () => [{ title: "Event check-in · DALI OS" }];

const KIND_LABELS: Record<string, string> = {
  HelpHour: "Help hour",
  Social: "Social",
  InfoSession: "Info session",
  Other: "Other",
};

// Standalone self-check-in surface for an application event (help hour,
// social, info session) — the target of the projected QR. Kept out of the
// member/portal shells so a scan lands straight here: an applicant who hasn't
// started an application yet still has a Dartmouth login but no DALIMember
// row, same reasoning as education/check-in. No enrollment/application gate —
// any authenticated user can check in (app/hiring/lib/hiring-events.server.ts
// selfCheckInToEvent) — so the only gates here are auth and the feature flag.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const event = await prisma.hiringEvent.findUnique({
    where: { id: params.eventId! },
    select: {
      id: true,
      title: true,
      kind: true,
      startsAt: true,
      endsAt: true,
      location: true,
      checkInOpenAt: true,
      applicationCycle: { select: { id: true, name: true, applicants: true } },
    },
  });
  if (!event) throw new Response("Not found", { status: 404 });

  const [attendance, application, viewer] = await Promise.all([
    prisma.hiringEventAttendance.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: auth.user.sub } },
      select: { id: true },
    }),
    prisma.application.findUnique({
      where: {
        userId_applicationCycleId: { userId: auth.user.sub, applicationCycleId: event.applicationCycle.id },
      },
      select: { id: true },
    }),
    prisma.user.findUnique({ where: { id: auth.user.sub }, select: { timeZone: true } }),
  ]);

  return {
    timeZone: resolveUserTimeZone(viewer),
    eventId: event.id,
    title: event.title,
    kindLabel: KIND_LABELS[event.kind] ?? event.kind,
    cycleName: event.applicationCycle.name,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    location: event.location,
    open: isEventCheckInOpen(event),
    alreadyPresent: Boolean(attendance),
    applyHref: application
      ? null
      : applicantPortalPath(event.applicationCycle.applicants, event.applicationCycle.id),
  };
}

export default function HiringEventCheckIn() {
  useOsShellRoot(true);
  const data = useLoaderData<typeof loader>();
  return (
    <SelfCheckInCard
      eyebrow={data.cycleName}
      title={data.title}
      when={`${data.kindLabel} · ${formatSessionWhen(data.startsAt, data.endsAt, data.timeZone)}${data.location ? ` · ${data.location}` : ""}`}
      open={data.open}
      alreadyPresent={data.alreadyPresent}
      closedText="Check-in isn't open for this event right now."
      postUrl={`/api/hiring/events/${data.eventId}/check-in`}
      extra={(present) =>
        present && data.applyHref ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Started your application yet?{" "}
            <a href={data.applyHref} className="text-os-accent hover:underline">
              Apply
            </a>
          </p>
        ) : null
      }
    />
  );
}
