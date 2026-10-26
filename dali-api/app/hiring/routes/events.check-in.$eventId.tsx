import { useLoaderData } from "react-router";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { Route } from "./+types/events.check-in.$eventId";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { isEventCheckInOpen } from "~/hiring/lib/hiring-events.server";
import { applicantPortalPath } from "~/hiring/lib/applicant-groups";
import { formatSessionWhen } from "~/lib/display";
import { resolveUserTimeZone } from "~/lib/timezone";
import { Button } from "~/components/ui/Button";
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

  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("application-events", auth.user.sub, roles, request))) {
    throw new Response("Not found", { status: 404 });
  }

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
  const [present, setPresent] = useState(data.alreadyPresent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkIn() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/hiring/events/${data.eventId}/check-in`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Check-in failed");
        return;
      }
      setPresent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="os-shell min-h-screen flex items-center justify-center bg-os-bg text-foreground p-4">
      <div className="w-full max-w-sm rounded-os-card bg-os-card p-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{data.cycleName}</p>
        <h1 className="mt-1 font-heading text-xl font-bold text-foreground">{data.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.kindLabel} · {formatSessionWhen(data.startsAt, data.endsAt, data.timeZone)}
          {data.location ? ` · ${data.location}` : ""}
        </p>

        <div className="mt-6">
          {present ? (
            <div className="flex flex-col items-center gap-2 text-os-green">
              <CheckCircle2 className="w-12 h-12" aria-hidden />
              <p className="text-base font-semibold text-foreground">You're checked in.</p>
            </div>
          ) : !data.open ? (
            <p className="text-sm text-muted-foreground bg-muted rounded-md px-3 py-2">
              Check-in isn't open for this event right now.
            </p>
          ) : (
            <>
              <Button type="button" onClick={checkIn} disabled={submitting} className="w-full">
                {submitting ? "Checking in…" : "Check in"}
              </Button>
              {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            </>
          )}
        </div>

        {present && data.applyHref && (
          <p className="mt-4 text-sm text-muted-foreground">
            Started your application yet?{" "}
            <a href={data.applyHref} className="text-os-accent hover:underline">
              Apply
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
