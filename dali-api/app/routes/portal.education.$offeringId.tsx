import { redirect, useLoaderData, Link, Form } from "react-router";
import type { Route } from "./+types/portal.education.$offeringId";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { withdrawApplication } from "~/education/lib/decisions.server";
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
  MyStatusChip,
  registrationWindowLabel,
} from "~/education/components/OfferingCard";
import { OfferingFunnel } from "~/education/components/v2/OfferingFunnel";
import { buttonClasses } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { formatDateTime, formatDateShort } from "~/lib/display";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.offering.title ?? "Offering"} · DALI` },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "member")
    return redirect(`/education/${params.offeringId}`);

  const offering = await getOfferingDetail(params.offeringId!);
  if (!offering || offering.status !== "Published")
    throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const step = url.searchParams.get("step");

  const roles = await getUserRoles(auth.user.sub, request);
  const redesign = await isFeatureEnabled("education-redesign", auth.user.sub, roles, request);

  const [descriptionHtml, myApplication, me] = await Promise.all([
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
    prisma.user.findUnique({
      where: { id: auth.user.sub },
      select: { timeZone: true },
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
    step === "apply" && canApply
      ? "apply"
      : myApplication && myApplication.status !== "Withdrawn"
        ? "status"
        : "detail";

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
    isManager: false,
    applyForm,
    step: resolvedStep as "detail" | "apply" | "status",
    basePath: "/portal/education",
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
    return redirect(`/portal/education/${params.offeringId}`);
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

export default function PortalOfferingDetail() {
  const data = useLoaderData<typeof loader>();

  // Branch between whole components (not inline early-return before hooks) so
  // a flag flip mid-session can't change this component's hook order.
  if (data.redesign) {
    // The portal shell adds no gutters — the funnel centers itself here.
    return (
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-8">
        <OfferingFunnel data={data} />
      </div>
    );
  }
  return <PortalOfferingDetailV1 data={data} />;
}

function PortalOfferingDetailV1({
  data,
}: {
  data: Extract<ReturnType<typeof useLoaderData<typeof loader>>, { redesign: false }>;
}) {
  const { offering, descriptionHtml, tz, myStatus, canApply } = data;
  const confirmSubmit = useConfirmSubmit();
  const seatsLeft = Math.max(0, offering.capacity - offering.approvedCount);

  return (
    <div className="w-full px-4 sm:px-6 py-8 flex flex-col gap-6">
      <header>
        <p className="text-xs text-muted-foreground">
          <Link to="/portal/education" className="hover:underline">
            ← Education
          </Link>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
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
          {offering.startsAt && offering.endsAt
            ? `${formatDateShort(offering.startsAt, tz)} – ${formatDateShort(offering.endsAt, tz)}`
            : "Sessions TBD"}
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
