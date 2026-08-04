import { useLoaderData, Link, Form } from "react-router";
import { redirectToLogin } from "~/lib/login-next";
import type { Route } from "./+types/education.$offeringId";
import { requireAuth } from "~/lib/auth";
import { withdrawApplication } from "~/education/lib/decisions.server";
import {
  isOfferingManager,
  redirectDartmouthToPortal,
} from "~/education/lib/access.server";
import {
  getOfferingDetail,
  registrationOpen,
} from "~/education/lib/offerings.server";
import { collabDocToHtml } from "~/collab/export";
import {
  TypeBadge,
  StatusBadge,
  MyStatusChip,
  registrationWindowLabel,
} from "~/education/components/OfferingCard";
import { buttonClasses } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { prisma } from "~/lib/db";
import { formatDateTime, formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.offering.title ?? "Offering"} · DALI OS` },
];

export const handle = {
  breadcrumb: (data: { offering: { title: string } } | undefined) =>
    data?.offering.title ?? "Offering",
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectDartmouthToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const offering = await getOfferingDetail(params.offeringId!);
  if (!offering) throw new Response("Not found", { status: 404 });

  const isManager = await isOfferingManager(auth.user.sub, offering.id);
  // Draft/Archived offerings are manager-only surfaces.
  if (offering.status !== "Published" && !isManager) {
    throw new Response("Not found", { status: 404 });
  }

  const [descriptionHtml, myApplication] = await Promise.all([
    offering.descriptionDocId
      ? collabDocToHtml(offering.descriptionDocId)
      : Promise.resolve(""),
    prisma.educationApplication.findUnique({
      where: {
        applicantUserId_offeringId: {
          applicantUserId: auth.user.sub,
          offeringId: offering.id,
        },
      },
      select: { id: true, status: true },
    }),
  ]);

  return {
    offering: {
      ...offering,
      sessions: offering.sessions.map((s) => ({
        id: s.id,
        sequence: s.sequence,
        datetime: s.datetime,
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

export default function OfferingDetail() {
  const { offering, descriptionHtml, myStatus, isManager, canApply } =
    useLoaderData<typeof loader>();
  const tz = useUserTimeZone();
  const confirmSubmit = useConfirmSubmit();
  const seatsLeft = Math.max(0, offering.capacity - offering.approvedCount);

  return (
    <div className="flex flex-col gap-6">
      {/* Header matches the manage page: full width, title first, badges under
          it as qualifiers rather than an eyebrow. */}
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {offering.title}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <TypeBadge type={offering.type} />
            {offering.status !== "Published" && <StatusBadge status={offering.status} />}
            <MyStatusChip status={myStatus} />
          </div>
        </div>
        <div className="flex items-start gap-4">
          <div className="flex items-center gap-2 shrink-0">
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
                className={buttonClasses(myStatus === "Approved" ? "secondary" : "primary", "sm")}
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
                <button
                  type="submit"
                  className={buttonClasses("ghost", "sm")}
                >
                  Withdraw
                </button>
              </Form>
            )}
          </div>
        </div>
      </header>
      <div className="-mt-4">
        <p className="text-sm text-muted-foreground">
          {formatDateShort(offering.startsAt, tz)} – {formatDateShort(offering.endsAt, tz)}
          {" · "}
          {registrationWindowLabel(offering, tz)}
          {" · "}
          {seatsLeft > 0
            ? `${seatsLeft} of ${offering.capacity} seats left`
            : "Full — new applications join the waitlist"}
        </p>
        {offering.instructors.length > 0 && (
          <p className="text-sm text-foreground mt-1">
            Taught by{" "}
            {offering.instructors.map((i) => i.name).join(", ")}
          </p>
        )}
      </div>

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
            No sessions scheduled yet.
          </p>
        ) : (
          <ul className="bg-card border border-border rounded-lg divide-y divide-border">
            {offering.sessions.map((s) => (
              <li key={s.id} className="px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Session {s.sequence}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(s.datetime, tz)}
                    {s.location ? ` · ${s.location}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
