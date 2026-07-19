import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin-console";
import { requireAuth } from "~/lib/auth";
import { isAdmin, isCore } from "~/lib/roles";
import { adminPills } from "~/admin-console/adminPills";
import { AreaPillNav } from "~/components/AreaPillNav";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [{ title: "Admin · DALI OS" }];

// Access mirrors the admin tools themselves: any Core member may enter the
// area; the last three tools are Admin-only and hidden from the card grid.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isCore(auth.user.sub))) return redirect("/");
  return { isAdmin: await isAdmin(auth.user.sub) };
}

export default function AdminHub() {
  const { isAdmin: admin } = useLoaderData<typeof loader>();
  const tools = [
    {
      to: "/admin-console/members",
      title: "Roles & Permissions",
      description: "Assign Admin, Core, and Domain Lead roles per term.",
    },
    {
      to: "/admin-console/domains",
      title: "Domains",
      description: "The lab's domains and who leads them.",
    },
    {
      to: "/admin-console/announcements",
      title: "Announcements",
      description:
        "Send an announcement to the lab, with an optional due date and attached form.",
    },
    {
      to: "/admin-console/email-templates",
      title: "Email Templates",
      description:
        "Shared library of email templates, bound per hiring cycle or education offering.",
    },
    {
      to: "/admin-console/attendance",
      title: "Attendance",
      description:
        "Self check-in events — see who was invited and who checked in.",
    },
    ...(admin
      ? [
          {
            to: "/admin-console/activity",
            title: "Activity",
            description: "Audit log of admin actions across the site.",
          },
          {
            to: "/admin-console/analytics",
            title: "Analytics",
            description: "Site usage and error analytics.",
          },
          {
            to: "/admin-console/jobs",
            title: "Jobs",
            description: "Background job status — reminders, digests, scheduled sends.",
          },
          {
            to: "/admin-console/email-senders",
            title: "Email Senders",
            description: "Which Google account each area's outbound email sends from.",
          },
          {
            to: "/admin-console/payroll-export",
            title: "Payroll: Hire Setup",
            description: "Generate the per-term payroll export.",
          },
          {
            to: "/admin-console/payroll",
            title: "Payroll: Reconcile",
            description:
              "Reconcile TimesheetX actuals against DALI OS staffing.",
          },
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <AreaPillNav items={adminPills({ isAdmin: admin, active: "hub" })} />
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">Admin</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Lab administration tools.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="bg-card border border-border shadow-brand-1 rounded-lg p-4 hover:border-accent-coral/60 hover:shadow-brand-2 transition-all"
          >
            <h2 className="font-heading font-semibold text-foreground">{t.title}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
