import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/forms.fill.$token";
import { requireAuth } from "~/lib/auth";
import { requireMember } from "~/lib/roles";
import { loadPublicForm } from "~/forms/lib/public-form";
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
  // Only lab members submit staffing forms; the level/eligibility a bid needs
  // only exists for members.
  if (!(await requireMember(auth.user.sub))) return redirect("/");

  // Pass the member's id so member-scoped reference sources (e.g. a bid's
  // domain dropdown limited to the member's own eligibility) populate.
  const form = await loadPublicForm(params.token!, auth.user.sub);
  if (!form) throw new Response("Not found", { status: 404 });
  // loadPublicForm doesn't echo the token back; the submit endpoint is
  // addressed by it, so pass it through explicitly.
  return { ...form, token: params.token! };
}

export default function MemberFormFill() {
  const data = useLoaderData<typeof loader>();
  return (
    <MemberFormShell>
      <MemberFormFillView data={data} />
    </MemberFormShell>
  );
}
