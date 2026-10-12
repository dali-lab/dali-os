import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/forms.fill.$token";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { requireMember } from "~/lib/roles";
import {
  formAccessMeta,
  formFillAccess,
  loadPublicForm,
  ordinaryFillBlock,
} from "~/forms/lib/public-form";
import { applicantFillRedirect } from "~/forms/lib/form-usages.server";
import { canFillEducationForm } from "~/education/lib/feedback.server";
import {
  MemberFormFillView,
  MemberFormShell,
} from "~/forms/components/MemberFormFillView";
import { buttonClasses } from "~/components/ui/Button";
import { useOsShellRoot } from "~/lib/os-shell";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${(data as { name?: string })?.name ?? "Form"} · DALI OS` },
];

// Token-addressed fill route. Who may fill is the form's audience setting
// (Members / SignedIn / Groups / Public), gated by formFillAccess — the same
// gate the submit endpoint uses. Public-audience forms render without a
// session; signed-in fills are identified by the session (no name/email
// capture), which is what lets a submission be interpreted into
// StaffingPreference for the member. Reuses loadPublicForm (token-addressed,
// published-only) for the form body.
export async function loader({ request, params }: Route.LoaderArgs) {
  const meta = await formAccessMeta(params.token!);
  if (!meta) throw new Response("Not found", { status: 404 });

  // Optional session: only non-public audiences require one.
  const auth = await requireAuth(request);
  const userId = auth.ok ? auth.user.sub : null;

  // Education feedback context riding the fill URL (?session= / ?offering=).
  // Validated server-side; carried into the submit body so the submission
  // records its education scope.
  const url = new URL(request.url);
  const educationSessionId = url.searchParams.get("session");
  const educationOfferingId = url.searchParams.get("offering");

  if (educationSessionId || educationOfferingId) {
    // Education-context fills bypass the audience gate: enrollment (or an
    // instructor assignment) is their authorization, and a session is
    // required so the submission is attributable.
    if (!userId) return redirectToLogin(request);
    if (!(await requireMember(userId))) {
      const admitted = await canFillEducationForm({
        token: params.token!,
        userId,
        sessionId: educationSessionId,
        offeringId: educationOfferingId,
      });
      if (!admitted) return redirect("/");
    }
  } else {
    // A hiring/partner application form is filled on its feature's applicant
    // route, which runs its own gate. Send a stray token link there rather
    // than through the audience gate the applicant is bound to fail.
    const elsewhere = await applicantFillRedirect(meta.id);
    if (elsewhere) return redirect(elsewhere);

    const access = await formFillAccess(meta, userId);
    if (access === "login") return redirectToLogin(request);
    if (access === "denied") {
      return { accessDenied: true as const, name: meta.name };
    }
  }

  // Pass the user's id (when signed in) so member-scoped reference sources
  // (e.g. a bid's domain dropdown limited to the member's own eligibility)
  // populate; they resolve to [] on anonymous fills.
  const form = await loadPublicForm(params.token!, userId);
  if (!form) throw new Response("Not found", { status: 404 });

  // Already-submitted gate: education-context fills are per-session and exempt;
  // anonymous fills have no identity to key on. ordinaryFillBlock returns the
  // prior submission for a bound staffing form (one-and-done) or for an ordinary
  // oneResponsePerMember form, mirroring submitMemberForm's 409 gate.
  const block =
    userId && !educationSessionId && !educationOfferingId
      ? await ordinaryFillBlock(form.formId, userId)
      : null;

  // Where to send the member after they submit — carried by the app-lock gate
  // (layout.tsx) as ?next so a gated fill returns them to the page they were
  // headed for. Local paths only (leading single slash), to avoid an open
  // redirect off a hand-crafted link.
  const nextParam = url.searchParams.get("next");
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : null;

  // loadPublicForm doesn't echo the token back; the submit endpoint is
  // addressed by it, so pass it through explicitly.
  return {
    accessDenied: false as const,
    ...form,
    token: params.token!,
    educationSessionId,
    educationOfferingId,
    next,
    alreadySubmitted: block ? { at: block.at.toISOString() } : null,
  };
}

export default function MemberFormFill() {
  useOsShellRoot(true);
  const data = useLoaderData<typeof loader>();
  if (data.accessDenied) {
    return (
      <div className="os-shell min-h-screen bg-os-bg text-foreground">
        <MemberFormShell allowExit>
          <div className="text-center py-10">
            <h1 className="font-heading text-xl font-bold text-foreground">
              You don't have access to this form
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              "{data.name}" is limited to a specific audience. If you think you
              should have access, contact whoever sent you this link.
            </p>
          </div>
        </MemberFormShell>
      </div>
    );
  }
  if (data.alreadySubmitted) {
    return (
      <div className="os-shell min-h-screen bg-os-bg text-foreground">
        <MemberFormShell allowExit>
          <div className="text-center py-10">
            <h1 className="font-heading text-xl font-bold text-foreground">
              You've already filled out this form
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              You submitted "{data.name}" on{" "}
              {new Date(data.alreadySubmitted.at).toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
              .
            </p>
            {data.next && (
              <Link to={data.next} className={buttonClasses("primary", "md", "mt-6")}>
                Continue
              </Link>
            )}
          </div>
        </MemberFormShell>
      </div>
    );
  }
  return (
    <div className="os-shell min-h-screen bg-os-bg text-foreground">
      <MemberFormShell allowExit>
        <MemberFormFillView
          data={data}
          next={data.next}
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
    </div>
  );
}
