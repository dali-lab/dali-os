import { useLoaderData } from "react-router";
import type { Route } from "./+types/education.check-in.$sessionId";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { isSessionCheckInOpen } from "~/education/lib/session-checkin.server";
import { formatSessionWhen } from "~/lib/display";
import { resolveUserTimeZone } from "~/lib/timezone";
import { SelfCheckInCard } from "~/components/SelfCheckInCard";
import { useOsShellRoot } from "~/lib/os-shell";

export const meta: Route.MetaFunction = () => [{ title: "Session check-in · DALI OS" }];

// Standalone self-check-in surface for an education session — the target of the
// projected QR / share link. Kept out of the member/portal education shells so a
// scan lands straight here; enrollment is checked in the loader, and marking
// goes through /api/education/sessions/:id/check-in (which takes the user from
// their own session).
//
// Enrollment is the only gate. Most students in a course are Dartmouth accounts
// with no DALIMember row, so this route must stay outside the member layout —
// its non-member gate redirects unrecognized paths to /portal, which swallowed
// every scan. Being shell-free also means no layout loader supplies the display
// timezone, so this loader resolves it itself.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const session = await prisma.educationSession.findUnique({
    where: { id: params.sessionId! },
    select: {
      id: true,
      sequence: true,
      title: true,
      datetime: true,
      endsAt: true,
      location: true,
      checkInOpenAt: true,
      offering: { select: { id: true, title: true } },
    },
  });
  if (!session) throw new Response("Not found", { status: 404 });

  const [application, viewer] = await Promise.all([
    prisma.educationApplication.findFirst({
      where: {
        offeringId: session.offering.id,
        applicantUserId: auth.user.sub,
        status: "Approved",
      },
      select: {
        id: true,
        attendances: { where: { sessionId: session.id }, select: { status: true } },
      },
    }),
    prisma.user.findUnique({
      where: { id: auth.user.sub },
      select: { timeZone: true },
    }),
  ]);

  return {
    timeZone: resolveUserTimeZone(viewer),
    sessionId: session.id,
    courseTitle: session.offering.title,
    sessionLabel: session.title
      ? `${session.sequence}. ${session.title}`
      : `Session ${session.sequence}`,
    datetime: session.datetime,
    endsAt: session.endsAt,
    location: session.location,
    open: isSessionCheckInOpen(session),
    enrolled: Boolean(application),
    alreadyPresent: application?.attendances[0]?.status === "Present",
  };
}

export default function EducationSessionCheckIn() {
  useOsShellRoot(true);
  const data = useLoaderData<typeof loader>();
  return (
    <SelfCheckInCard
      eyebrow={data.courseTitle}
      title={data.sessionLabel}
      when={`${formatSessionWhen(data.datetime, data.endsAt, data.timeZone)}${data.location ? ` · ${data.location}` : ""}`}
      blocked={data.enrolled ? null : "You're not enrolled in this course, so you can't check in."}
      open={data.open}
      alreadyPresent={data.alreadyPresent}
      closedText="Check-in isn't open for this session right now. Ask your instructor to open it."
      postUrl={`/api/education/sessions/${data.sessionId}/check-in`}
    />
  );
}
