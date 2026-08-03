import { redirect, useLoaderData, Link, Form } from "react-router";
import type { Route } from "./+types/portal.education.$offeringId";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { withdrawApplication } from "~/education/lib/decisions.server";
import {
  getOfferingDetail,
  registrationOpen,
} from "~/education/lib/offerings.server";
import { getMyApplication } from "~/education/lib/apply.server";
import { collabDocToHtml } from "~/collab/export";
import {
  TypeBadge,
  MyStatusChip,
  registrationWindowLabel,
} from "~/education/components/OfferingCard";
import { buttonClasses } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { formatDateTime, formatDateShort } from "~/lib/display";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.offering.title ?? "Offering"} · DALI` },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "member")
    return redirect(`/education/${params.offeringId}`);

  const offering = await getOfferingDetail(params.offeringId!);
  if (!offering || offering.status !== "Published")
    throw new Response("Not found", { status: 404 });

  const [descriptionHtml, myApplication, me] = await Promise.all([
    offering.descriptionDocId
      ? collabDocToHtml(offering.descriptionDocId)
      : Promise.resolve(""),
    getMyApplication(auth.user.sub, offering.id),
    prisma.user.findUnique({
      where: { id: auth.user.sub },
      select: { timeZone: true },
    }),
  ]);

  return {
    offering: {
      id: offering.id,
      type: offering.type,
      title: offering.title,
      capacity: offering.capacity,
      approvedCount: offering.approvedCount,
      requiresReview: offering.requiresReview,
      registrationOpensAt: offering.registrationOpensAt,
      registrationClosesAt: offering.registrationClosesAt,
      startsAt: offering.startsAt,
      endsAt: offering.endsAt,
      instructors: offering.instructors.map((i) => i.name),
      sessions: offering.sessions.map((s) => ({
        id: s.id,
        sequence: s.sequence,
        datetime: s.datetime,
        location: s.location,
      })),
    },
    descriptionHtml,
    tz: me?.timeZone ?? "America/New_York",
    myStatus: myApplication?.status ?? null,
    canApply:
      registrationOpen(offering) &&
      (!myApplication ||
        myApplication.status === "Withdrawn" ||
        myApplication.status === "Submitted"),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const formData = await request.formData();
  if (formData.get("intent") !== "withdraw")
    return Response.json({ error: "Unknown intent" }, { status: 400 });
  const result = await withdrawApplication({
    userId: auth.user.sub,
    offeringId: params.offeringId!,
  });
  if ("error" in result && typeof result.error === "string")
    return Response.json({ error: result.error }, { status: result.status });
  return { ok: true };
}

export default function PortalOfferingDetail() {
  const { offering, descriptionHtml, tz, myStatus, canApply } =
    useLoaderData<typeof loader>();
  const confirmSubmit = useConfirmSubmit();
  const seatsLeft = Math.max(0, offering.capacity - offering.approvedCount);

  return (
    <div className="w-full px-4 sm:px-6 py-8 flex flex-col gap-6">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={offering.type} />
          <MyStatusChip status={myStatus} />
        </div>
        <div className="mt-2 flex items-start justify-between gap-4">
          <h1 className="font-heading text-2xl font-bold text-dark-blue">
            {offering.title}
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            {myStatus === "Approved" && (
              <Link
                to={`/portal/education/${offering.id}/hub`}
                className={buttonClasses("primary", "sm")}
              >
                Open course hub
              </Link>
            )}
            {canApply && (
              <Link
                to={`/portal/education/${offering.id}/apply`}
                className={buttonClasses("primary", "sm")}
              >
                {myStatus === "Submitted"
                  ? "Edit application"
                  : offering.requiresReview
                    ? "Apply"
                    : "RSVP"}
              </Link>
            )}
            {(myStatus === "Submitted" ||
              myStatus === "Approved" ||
              myStatus === "Waitlisted") && (
              <Form
                method="post"
                onSubmit={confirmSubmit({
                  title: "Withdraw from this offering?",
                  description:
                    myStatus === "Approved"
                      ? "Your seat opens up for the next person on the waitlist."
                      : "This removes your application. You can re-apply while registration is open.",
                  confirmLabel: "Withdraw",
                  tone: "destructive",
                })}
              >
                <input type="hidden" name="intent" value="withdraw" />
                <button type="submit" className={buttonClasses("ghost", "sm")}>
                  Withdraw
                </button>
              </Form>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {formatDateShort(offering.startsAt, tz)} – {formatDateShort(offering.endsAt, tz)}
          {" · "}
          {registrationWindowLabel(offering)}
          {" · "}
          {seatsLeft > 0
            ? `${seatsLeft} of ${offering.capacity} seats left`
            : "Full — new applications join the waitlist"}
        </p>
        {offering.instructors.length > 0 && (
          <p className="text-sm text-foreground mt-1">
            Taught by {offering.instructors.join(", ")}
          </p>
        )}
        {myStatus === "Waitlisted" && (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-md px-3 py-2 mt-3">
            You&apos;re on the waitlist — if a seat opens up you&apos;ll be
            enrolled automatically and notified by email.
          </p>
        )}
      </header>

      {descriptionHtml && (
        <section
          className="bg-card border border-border rounded-lg p-5 prose prose-sm dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
        />
      )}

      <section>
        <h2 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Sessions
        </h2>
        {offering.sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Session times will be posted here.
          </p>
        ) : (
          <ul className="bg-card border border-border rounded-lg divide-y divide-border">
            {offering.sessions.map((s) => (
              <li key={s.id} className="px-4 py-3">
                <p className="text-sm font-medium text-dark-blue">
                  Session {s.sequence}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(s.datetime, tz)}
                  {s.location ? ` · ${s.location}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
