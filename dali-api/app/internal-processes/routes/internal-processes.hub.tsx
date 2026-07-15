import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/internal-processes.hub";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { labProcessesPills } from "~/internal-processes/labProcessesPills";
import { AreaPillNav } from "~/components/AreaPillNav";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [{ title: "Lab Processes · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  return { isCore: await isCore(auth.user.sub) };
}

export default function LabProcessesHub() {
  const { isCore: core } = useLoaderData<typeof loader>();
  const processes = [
    ...(core
      ? [
          {
            to: "/internal-processes/onboarding",
            title: "Onboarding",
            description: "Accepted applicants and their onboarding progress.",
          },
        ]
      : []),
    {
      to: "/internal-processes/transfer",
      title: "Transfer",
      description: "Move members between domains or teams.",
    },
    {
      to: "/internal-processes/jobx",
      title: "JobX",
      description: "Internal job exchange and role rotation.",
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <AreaPillNav items={labProcessesPills({ isCore: core, active: "hub" })} />
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Lab Processes
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          How members move through the lab. Pick a process to get started.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {processes.map((p) => (
          <Link
            key={p.to}
            to={p.to}
            className="bg-card border border-border rounded-lg p-4 hover:border-accent-coral/60 hover:shadow-sm transition-all"
          >
            <h2 className="font-heading font-semibold text-foreground">{p.title}</h2>
            <p className="text-sm text-muted-foreground mt-1">{p.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
