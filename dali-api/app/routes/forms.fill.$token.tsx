import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/forms.fill.$token";
import { requireAuth } from "~/lib/auth";
import { requireMember } from "~/lib/roles";
import { loadPublicForm } from "~/forms/lib/public-form";
import { canFillEducationForm } from "~/education/lib/feedback.server";
import {
  MemberFormFillView,
  MemberFormShell,
} from "~/forms/components/MemberFormFillView";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${(data as { name?: string })?.name ?? "Form"} · DALI OS` },
];

// AUTHENTICATED member fill route for slot-bound forms (Project Bids etc.).
// Identity comes from the session — no name/email capture — which is what
// lets a submission be interpreted into StaffingPreference for this member.
// Reuses loadPublicForm (token-addressed, published-only) for the form body.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  // Education feedback context riding the fill URL (?session= / ?offering=).
  // Validated server-side; carried into the submit body so the submission
  // records its education scope.
  const url = new URL(request.url);
  const educationSessionId = url.searchParams.get("session");
  const educationOfferingId = url.searchParams.get("offering");

  // Only lab members submit staffing forms — but a non-member portal student
  // may fill a form bound to an education slot they're enrolled in (session
  // feedback). The education context is what admits them.
  if (!(await requireMember(auth.user.sub))) {
    const admitted =
      (educationSessionId || educationOfferingId) &&
      (await canFillEducationForm({
        token: params.token!,
        userId: auth.user.sub,
        sessionId: educationSessionId,
        offeringId: educationOfferingId,
      }));
    if (!admitted) return redirect("/");
  }

  // Pass the member's id so member-scoped reference sources (e.g. a bid's
  // domain dropdown limited to the member's own eligibility) populate.
  const form = await loadPublicForm(params.token!, auth.user.sub);
  if (!form) throw new Response("Not found", { status: 404 });
  // loadPublicForm doesn't echo the token back; the submit endpoint is
  // addressed by it, so pass it through explicitly.
  return { ...form, token: params.token!, educationSessionId, educationOfferingId };
}

export default function MemberFormFill() {
  const data = useLoaderData<typeof loader>();
  return (
    <MemberFormShell>
      <MemberFormFillView
        data={data}
        extraBody={
          data.educationSessionId || data.educationOfferingId
            ? {
                educationSessionId: data.educationSessionId,
                educationOfferingId: data.educationOfferingId,
              }
            : undefined
        }
      />
    </MemberFormShell>
  );
}
