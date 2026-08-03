import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/projects.my-staffing";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { requireMember, canViewStaffing } from "~/lib/roles";
import { listMemberStaffingForms } from "../lib/member-staffing.server";
import { projectsPills } from "../components/projectsPills";
import { AreaPillNav } from "~/components/AreaPillNav";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [
  { title: "My Staffing · DALI OS" },
];

// Member-facing "My Staffing" page: the persistent destination for the staffing
// forms a member is meant to fill this cycle. Without it, the only apply
// surface is an ephemeral My Tasks tile that vanishes once dismissed and gives
// no way to revisit a submitted form. Gated `requireMember` (NOT
// canViewStaffing — this is the member's own surface, not the Core board);
// every submission lookup is scoped to the session user.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portal = redirectApplicantToPortal(auth);
  if (portal) return portal;
  if (!(await requireMember(auth.user.sub))) return redirect("/");

  const [forms, canStaff] = await Promise.all([
    listMemberStaffingForms(auth.user.sub),
    canViewStaffing(auth.user.sub),
  ]);
  return { forms, canStaff };
}

export default function MyStaffingPage() {
  const { forms, canStaff } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-4">
      <AreaPillNav
        items={projectsPills({ canViewStaffing: canStaff, active: "my-staffing" })}
      />
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          My Staffing
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Staffing forms open for you this cycle. Submitting here is the same as
          completing the task in your sidebar.
        </p>
      </header>

      {forms.length === 0 ? (
        <div className="bg-card border border-border rounded-lg px-4 py-8 text-center text-sm text-muted-foreground">
          No staffing forms are open for you right now.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {forms.map((f) => (
            <li
              key={f.slot}
              className="bg-card border border-border rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div>
                <div className="text-sm font-medium text-foreground">
                  {f.slotLabel}
                </div>
                <div className="text-xs text-muted-foreground">
                  {f.formName}
                  {f.submitted && f.submittedAt
                    ? ` · Submitted ${new Date(f.submittedAt).toLocaleDateString()}`
                    : ""}
                </div>
              </div>
              <a
                href={f.fillLink}
                className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted"
              >
                {f.submitted ? "View / update" : "Open form"}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
