import { redirect, useLoaderData } from "react-router";
import { redirectToLogin } from "~/lib/login-next";
import type { Route } from "./+types/education.$offeringId.apply";
import { requireAuth } from "~/lib/auth";
import { redirectDartmouthToPortal } from "~/education/lib/access.server";
import {
  getOfferingDetail,
  registrationOpen,
} from "~/education/lib/offerings.server";
import { loadOfferingApplicationForm } from "~/education/lib/application-form.server";
import {
  submitApplication,
  getMyApplication,
} from "~/education/lib/apply.server";
import { OfferingApplyForm } from "~/education/components/OfferingApplyForm";
import { MyStatusChip, TypeBadge } from "~/education/components/OfferingCard";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `Apply · ${data?.offering.title ?? "Offering"} · DALI OS` },
];

export const handle = {
  // /education/:offeringId/apply — the opaque :offeringId drops from the segment
  // walk, so declare the trail to keep the offering in the path.
  breadcrumbTrail: (data: unknown) => {
    const o = (
      data as { offering?: { id?: string; title?: string } } | undefined
    )?.offering;
    if (!o?.id) return null;
    return [
      { label: "Education", to: "/education" },
      { label: o.title ?? "Offering", to: `/education/${o.id}` },
      { label: "Apply" },
    ];
  },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectDartmouthToPortal(auth);
  if (portalRedirect) return redirect(`/portal/education/${params.offeringId}/apply`);

  const offering = await getOfferingDetail(params.offeringId!);
  if (!offering || offering.status !== "Published")
    throw new Response("Not found", { status: 404 });

  const [form, myApplication] = await Promise.all([
    loadOfferingApplicationForm(offering.id, auth.user.sub),
    getMyApplication(auth.user.sub, offering.id),
  ]);

  const decided =
    myApplication &&
    (myApplication.status === "Approved" ||
      myApplication.status === "Waitlisted" ||
      myApplication.status === "Rejected");

  return {
    offering: {
      id: offering.id,
      title: offering.title,
      type: offering.type,
      requiresReview: offering.requiresReview,
    },
    open: registrationOpen(offering) && !decided && form !== null,
    myStatus: myApplication?.status ?? null,
    questions: form?.questions ?? [],
    versionUpdatedAt: form?.versionUpdatedAt,
    // Form intros are stored as ProseMirror JSON until the forms editor
    // migrates; normalize to block JSON for the read-only DocEditor.
    description: ensureBlocks(form?.description ?? null),
    defaultAnswers:
      myApplication?.status === "Submitted"
        ? ((myApplication.formSubmission?.answers ?? {}) as Record<string, string>)
        : undefined,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
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

export default function ApplyToOffering() {
  const { offering, open, myStatus, questions, description, defaultAnswers, versionUpdatedAt } =
    useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <header>
        <div className="flex items-center gap-2">
          <TypeBadge type={offering.type} />
          <MyStatusChip status={myStatus} />
        </div>
        <h1 className="mt-1 font-heading text-2xl font-bold text-foreground">
          {offering.requiresReview ? "Apply to" : "RSVP for"} {offering.title}
        </h1>
      </header>

      {open ? (
        <div className="bg-card border border-border rounded-lg p-5">
          <OfferingApplyForm
            questions={questions}
            description={description}
            defaultAnswers={defaultAnswers}
            versionUpdatedAt={versionUpdatedAt}
            submitLabel={
              myStatus === "Submitted"
                ? "Update application"
                : offering.requiresReview
                  ? "Submit application"
                  : "RSVP"
            }
          />
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="font-heading font-semibold text-foreground">
            {myStatus
              ? "Your application is in"
              : "Registration isn't open"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {myStatus
              ? "Check the offering page for your current status."
              : "Check back when the registration window opens."}
          </p>
        </div>
      )}
    </div>
  );
}
