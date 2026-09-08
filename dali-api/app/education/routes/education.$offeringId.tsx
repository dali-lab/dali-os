import { redirect, useLoaderData, Link, Form } from "react-router";
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
import { loadOfferingApplicationForm } from "~/education/lib/application-form.server";
import {
  submitApplication,
  getMyApplication,
} from "~/education/lib/apply.server";
import { collabDocToHtml } from "~/collab/export";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import {
  TypeBadge,
  StatusBadge,
  MyStatusChip,
  registrationWindowLabel,
} from "~/education/components/OfferingCard";
import { OfferingFunnel } from "~/education/components/v2/OfferingFunnel";
import { buttonClasses } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { prisma } from "~/lib/db";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { formatDateTime, formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";

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

  // After the gate — a course the viewer can open lands in their recents.
  recordRouteVisit(auth.user.sub, `/education/${offering.id}`, offering.title, request);

  const url = new URL(request.url);
  const step = url.searchParams.get("step");

  const roles = await getUserRoles(auth.user.sub, request);
  const redesign = await isFeatureEnabled("education-redesign", auth.user.sub, roles, request);

  const [descriptionHtml, myApplication] = await Promise.all([
    offering.descriptionDocId
      ? collabDocToHtml(offering.descriptionDocId)
      : Promise.resolve(""),
    redesign
      ? getMyApplication(auth.user.sub, offering.id)
      : prisma.educationApplication.findUnique({
          where: {
            applicantUserId_offeringId: {
              applicantUserId: auth.user.sub,
              offeringId: offering.id,
            },
          },
          select: { id: true, status: true },
        }),
  ]);

  const canApply =
    registrationOpen(offering) &&
    (!myApplication ||
      myApplication.status === "Withdrawn" ||
      myApplication.status === "Submitted");

  if (!redesign) {
    return {
      redesign: false as const,
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
      canApply,
    };
  }

  // Redesign path: load form data when ?step=apply and the user can apply.
  let applyForm: {
    questions: import("~/types").Question[];
    description: unknown;
    defaultAnswers?: Record<string, string>;
    versionUpdatedAt?: string;
  } | null = null;

  if (step === "apply" && canApply) {
    const form = await loadOfferingApplicationForm(offering.id, auth.user.sub);
    if (form) {
      applyForm = {
        questions: form.questions,
        description: ensureBlocks(form.description ?? null),
        versionUpdatedAt: form.versionUpdatedAt,
        defaultAnswers:
          myApplication?.status === "Submitted"
            ? ((("formSubmission" in myApplication
                ? myApplication.formSubmission?.answers
                : undefined) ?? {}) as Record<string, string>)
            : undefined,
      };
    }
  }

  const resolvedStep =
    step === "apply" && canApply ? "apply" : myApplication && myApplication.status !== "Withdrawn" ? "status" : "detail";

  return {
    redesign: true as const,
    offering: {
      id: offering.id,
      type: offering.type,
      title: offering.title,
      status: offering.status,
      capacity: offering.capacity,
      approvedCount: offering.approvedCount,
      requiresReview: offering.requiresReview,
      registrationOpensAt: offering.registrationOpensAt,
      registrationClosesAt: offering.registrationClosesAt,
      startsAt: offering.startsAt,
      endsAt: offering.endsAt,
      instructors: offering.instructors,
      sessions: offering.sessions.map((s) => ({
        id: s.id,
        sequence: s.sequence,
        datetime: s.datetime,
        location: s.location,
      })),
      descriptionHtml,
    },
    myStatus: myApplication?.status ?? null,
    waitlistRank:
      myApplication && "waitlistRank" in myApplication
        ? (myApplication.waitlistRank ?? null)
        : null,
    canApply,
    isManager,
    applyForm,
    step: resolvedStep as "detail" | "apply" | "status",
    basePath: "/education",
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const formData = await request.formData();
  // OfferingApplyForm posts bare answers (no intent field) — same shape the
  // legacy /apply route action consumed.
  const intent =
    formData.get("intent") ?? (formData.has("answers") ? "submit-application" : null);

  if (intent === "withdraw") {
    const result = await withdrawApplication({
      userId: auth.user.sub,
      offeringId: params.offeringId!,
    });
    if ("error" in result && typeof result.error === "string")
      return Response.json({ error: result.error }, { status: result.status });
    return { ok: true };
  }

  if (intent === "submit-application") {
    let answers: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(String(formData.get("answers") ?? ""));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("bad shape");
      answers = parsed as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid submission." }, { status: 400 });
    }

    const result = await submitApplication({
      offeringId: params.offeringId!,
      userId: auth.user.sub,
      answers,
      versionUpdatedAt: (formData.get("versionUpdatedAt") as string) || undefined,
    });
    if ("error" in result)
      return Response.json({ error: result.error }, { status: result.status });
    return redirect(`/education/${params.offeringId}`);
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

export default function OfferingDetail() {
  const data = useLoaderData<typeof loader>();

  // Branch between whole components (not inline early-return before hooks) so
  // a flag flip mid-session can't change this component's hook order.
  if (data.redesign) {
    return <OfferingFunnel data={data} />;
  }
  return <OfferingDetailV1 data={data} />;
}

function OfferingDetailV1({
  data,
}: {
  data: Extract<ReturnType<typeof useLoaderData<typeof loader>>, { redesign: false }>;
}) {
  const { offering, descriptionHtml, myStatus, isManager, canApply } = data;
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
          {offering.startsAt && offering.endsAt
            ? `${formatDateShort(offering.startsAt, tz)} – ${formatDateShort(offering.endsAt, tz)}`
            : "Sessions TBD"}
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
