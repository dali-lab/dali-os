import { useLoaderData } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/education.check-in.$sessionId";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { isSessionCheckInOpen } from "~/education/lib/session-checkin.server";
import { formatSessionWhen } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { CheckCircle2 } from "lucide-react";

export const meta: Route.MetaFunction = () => [{ title: "Session check-in · DALI OS" }];

// Standalone self-check-in surface for an education session — the target of the
// projected QR / share link. Kept out of the member/portal education shells so a
// scan lands straight here; enrollment is checked in the loader, and marking
// goes through /api/education/sessions/:id/check-in (which takes the user from
// their own session).
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

  const application = await prisma.educationApplication.findFirst({
    where: {
      offeringId: session.offering.id,
      applicantUserId: auth.user.sub,
      status: "Approved",
    },
    select: { id: true, attendances: { where: { sessionId: session.id }, select: { status: true } } },
  });

  return {
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
  const data = useLoaderData<typeof loader>();
  const tz = useUserTimeZone();
  const [present, setPresent] = useState(data.alreadyPresent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkIn() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/education/sessions/${data.sessionId}/check-in`, {
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
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-brand-2 p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {data.courseTitle}
        </p>
        <h1 className="mt-1 font-heading text-xl font-bold text-foreground">{data.sessionLabel}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatSessionWhen(data.datetime, data.endsAt, tz)}
          {data.location ? ` · ${data.location}` : ""}
        </p>

        <div className="mt-6">
          {!data.enrolled ? (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              You're not enrolled in this course, so you can't check in.
            </p>
          ) : present ? (
            <div className="flex flex-col items-center gap-2 text-accent-teal">
              <CheckCircle2 className="w-12 h-12" aria-hidden />
              <p className="text-base font-semibold text-foreground">You're checked in.</p>
            </div>
          ) : !data.open ? (
            <p className="text-sm text-muted-foreground bg-muted rounded-md px-3 py-2">
              Check-in isn't open for this session right now. Ask your instructor to open it.
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={checkIn}
                disabled={submitting}
                className="w-full px-4 py-3 rounded-md bg-accent-coral text-white text-base font-medium hover:bg-accent-coral/90 transition-colors disabled:opacity-50"
              >
                {submitting ? "Checking in…" : "Check in"}
              </button>
              {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
