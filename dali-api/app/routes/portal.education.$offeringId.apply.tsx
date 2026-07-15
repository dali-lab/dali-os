import { redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/portal.education.$offeringId.apply";
import { requireAuth } from "~/lib/auth";
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
import { buttonClasses } from "~/components/ui/Button";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `Apply · ${data?.offering.title ?? "Offering"} · DALI` },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "member")
    return redirect(`/education/${params.offeringId}/apply`);

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
    description: form?.description ?? null,
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
  });
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return redirect(`/portal/education/${params.offeringId}`);
}

export default function PortalApplyToOffering() {
  const { offering, open, myStatus, questions, description, defaultAnswers } =
    useLoaderData<typeof loader>();

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-4">
      <header>
        <div className="flex items-center gap-2">
          <TypeBadge type={offering.type} />
          <MyStatusChip status={myStatus} />
        </div>
        <h1 className="mt-1 font-heading text-2xl font-bold text-dark-blue">
          {offering.requiresReview ? "Apply to" : "RSVP for"} {offering.title}
        </h1>
      </header>

      {open ? (
        <div className="bg-card border border-border rounded-lg p-5">
          <OfferingApplyForm
            questions={questions}
            description={description}
            defaultAnswers={defaultAnswers}
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
          <p className="font-heading font-semibold text-dark-blue">
            {myStatus ? "Your application is in" : "Registration isn't open"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {myStatus
              ? "Check the offering page for your current status."
              : "Check back when the registration window opens."}
          </p>
          <Link
            to={`/portal/education/${offering.id}`}
            className={buttonClasses("secondary", "sm") + " mt-4 inline-flex"}
          >
            Back to offering
          </Link>
        </div>
      )}
    </div>
  );
}
