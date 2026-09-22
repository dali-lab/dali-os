import { redirect, useLoaderData, Link, Form } from "react-router";
import { redirectToLogin } from "~/lib/login-next";
import type { Route } from "./+types/education.$offeringId";
import { requireAuth } from "~/lib/auth";
import { withdrawApplication } from "~/education/lib/decisions.server";
import { isOfferingManager } from "~/education/lib/access.server";
import {
  getOfferingDetail,
  registrationOpen,
} from "~/education/lib/offerings.server";
import { collabDocToHtml } from "~/collab/export";
import {
  TypeBadge,
  StatusBadge,
  MyStatusChip,
  registrationMeta,
} from "~/education/components/OfferingCard";
import {
  OfferingTypeTile,
  runsValue,
  seatsMeta,
} from "~/education/components/OfferingCatalog";
import { META_TONE_CLASS, type MetaTone } from "~/components/ui/MetaList";
import { Avatar } from "~/components/ui/Avatar";
import { buttonClasses } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { cn } from "~/lib/cn";
import { prisma } from "~/lib/db";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { formatSessionWhen } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.offering.title ?? "Offering"} · DALI OS` },
];

export const handle = {
  // Offering pages name themselves in their own headers, so the trail above
  // them only repeated where you already are.
  hideBreadcrumbs: true,
  breadcrumb: (data: { offering: { title: string } } | undefined) =>
    data?.offering.title ?? "Offering",
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const offering = await getOfferingDetail(params.offeringId!);
  if (!offering) throw new Response("Not found", { status: 404 });

  const isManager = await isOfferingManager(auth.user.sub, offering.id);
  // Dartmouth students belong on the portal mirror — but a Dartmouth-auth
  // instructor (or Core) manages this offering from the member shell, so bounce
  // only non-managers instead of every CAS user.
  if (auth.user.type === "dartmouth" && !isManager) {
    return redirect("/portal/education");
  }

  const myApplication = await prisma.educationApplication.findUnique({
    where: {
      applicantUserId_offeringId: {
        applicantUserId: auth.user.sub,
        offeringId: offering.id,
      },
    },
    select: { id: true, status: true },
  });

  // Draft/Archived offerings are manager-only surfaces — except to someone who
  // applied to this one. Close-out archives a course, so its own students would
  // otherwise lose the page the day it finished.
  if (offering.status !== "Published" && !isManager && !myApplication) {
    throw new Response("Not found", { status: 404 });
  }

  // After the gate — a course the viewer can open lands in their recents.
  recordRouteVisit(auth.user.sub, `/education/${offering.id}`, offering.title, request);

  const descriptionHtml = offering.descriptionDocId
    ? await collabDocToHtml(offering.descriptionDocId)
    : "";

  return {
    offering: {
      ...offering,
      sessions: offering.sessions.map((s) => ({
        id: s.id,
        sequence: s.sequence,
        title: s.title,
        datetime: s.datetime,
        endsAt: s.endsAt,
        location: s.location,
      })),
    },
    descriptionHtml,
    myStatus: myApplication?.status ?? null,
    isManager,
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

// One labelled fact in the header summary. Same tone vocabulary the catalog
// cards use, so a closing deadline or a full offering reads the same here.
function Fact({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: MetaTone;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={cn("mt-0.5 text-sm", META_TONE_CLASS[tone])}>{value}</dd>
    </div>
  );
}

export default function OfferingDetail() {
  const { offering, descriptionHtml, myStatus, isManager, canApply } =
    useLoaderData<typeof loader>();
  const tz = useUserTimeZone();
  const confirmSubmit = useConfirmSubmit();
  const reg = registrationMeta(offering, tz);
  const seats = seatsMeta(offering);
  const now = Date.now();

  const withdrawable =
    myStatus === "Submitted" || myStatus === "Approved" || myStatus === "Waitlisted";

  return (
    <div className="flex flex-col gap-6">
      {/* The title stays on the page background, like any page header. The two
          things that are objects rather than prose — the summary facts and the
          schedule — sit on their own surfaces, so the page reads as header,
          summary, then body instead of one continuous sheet. */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-4">
          <OfferingTypeTile
            type={offering.type}
            iconEmoji={offering.iconEmoji}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <h1 className="font-heading text-2xl font-bold text-foreground">
              {offering.title}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <TypeBadge type={offering.type} />
              {offering.status !== "Published" && (
                <StatusBadge status={offering.status} />
              )}
              <MyStatusChip status={myStatus} />
              <span className="text-xs text-muted-foreground">
                {offering.sessions.length} session
                {offering.sessions.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {myStatus === "Approved" && (
              <Link
                to={`/education/${offering.id}/hub`}
                className={buttonClasses("primary", "sm")}
              >
                Open course hub
              </Link>
            )}
            {canApply && (
              <Link
                to={`/education/${offering.id}/apply`}
                className={buttonClasses(
                  myStatus === "Approved" ? "secondary" : "primary",
                  "sm",
                )}
              >
                {myStatus === "Submitted"
                  ? "Edit application"
                  : offering.requiresReview
                    ? "Apply"
                    : "RSVP"}
              </Link>
            )}
            {isManager && (
              <Link
                to={`/education/manage/${offering.id}`}
                className={buttonClasses("secondary", "sm")}
              >
                Manage
              </Link>
            )}
            {withdrawable && (
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

        <dl className="grid gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Runs" value={runsValue(offering, tz)} />
          <Fact label="Registration" value={reg.value} tone={reg.tone} />
          <Fact label="Seats" value={seats.value} tone={seats.tone} />
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Taught by
            </dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2">
              {offering.instructors.length === 0 ? (
                <span className="text-sm text-muted-foreground">
                  Not assigned yet
                </span>
              ) : (
                offering.instructors.map((i) => (
                  <span key={i.userId} className="flex items-center gap-1.5">
                    <Avatar photoUrl={i.photoUrl} name={i.name} size="xs" />
                    <span className="text-sm text-foreground">{i.name}</span>
                  </span>
                ))
              )}
            </dd>
          </div>
        </dl>
      </section>

      {/* Reading column and schedule side by side once there's room; the
          schedule takes the full width when there's no description to pair
          it with. */}
      <div
        className={cn(
          "grid gap-6 items-start",
          descriptionHtml && "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
        )}
      >
        {descriptionHtml && (
          <section>
            <h2 className="mb-3 font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              About
            </h2>
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: descriptionHtml }}
            />
          </section>
        )}

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-3 font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Schedule
          </h2>
          {offering.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Session times will be posted here.
            </p>
          ) : (
            <ol className="flex flex-col divide-y divide-border">
              {offering.sessions.map((s) => {
                // A session that has already run stays listed but steps back,
                // so the next one is what the eye lands on.
                const past = new Date(s.endsAt ?? s.datetime).getTime() < now;
                return (
                  <li
                    key={s.id}
                    className={cn(
                      "flex gap-3 py-2.5 first:pt-0 last:pb-0",
                      past && "opacity-60",
                    )}
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                      {s.sequence}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {s.title ?? `Session ${s.sequence}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatSessionWhen(s.datetime, s.endsAt, tz)}
                        {s.location ? ` · ${s.location}` : ""}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
