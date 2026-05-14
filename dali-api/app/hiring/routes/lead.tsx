import { useState } from "react";
import { Form, Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/lead";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { ChevronRight, ChevronDown, Plus, X } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  Draft: "Draft",
  Open: "Open",
  UnderReview: "Under Review",
  Completed: "Completed",
};

const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-muted text-foreground/80",
  Open: "bg-green-100 text-green-700",
  UnderReview: "bg-yellow-100 text-yellow-700",
  Completed: "bg-blue-100 text-blue-700",
};

export const meta: Route.MetaFunction = () => [{ title: "Hiring lead · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isHiringLead(auth.user.sub))) return redirect("/");

  const cycles = await prisma.applicationCycle.findMany({
    include: {
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      domains: { include: { domain: true } },
      _count: { select: { applications: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return { cycles };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const name = (formData.get("name") as string)?.trim();
  const cycleTypeRaw = (formData.get("cycleType") as string) ?? "Standard";
  const cycleType = cycleTypeRaw === "InternToFull" ? "InternToFull" : "Standard";
  if (!name) return { error: "Name is required" };

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isHiringLead(auth.user.sub))) return redirect("/");
  const adminUser = await prisma.user.findUniqueOrThrow({
    where: { id: auth.user.sub },
  });

  const cycle = await prisma.applicationCycle.create({
    data: {
      name,
      cycleType,
      statusUpdates: {
        create: { newStatus: "Draft", userId: adminUser.id },
      },
    },
  });

  return redirect(`/hiring/lead/cycle/${cycle.id}`);
}

export default function HiringLeadDashboard() {
  const data = useLoaderData<typeof loader>() as any;
  const cycles = data?.cycles ?? [];
  const [showModal, setShowModal] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Hiring Cycles</h1>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <Plus className="w-4 h-4" />
          New Cycle
        </button>
      </div>

      {showModal && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
            <div className="bg-card rounded-lg shadow-xl w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">New Hiring Cycle</h2>
                <button onClick={() => setShowModal(false)} className="text-muted-foreground/70 hover:text-muted-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <Form method="post" onSubmit={() => setShowModal(false)} className="space-y-4">
                <div>
                  <label htmlFor="cycle-name" className="block text-sm font-medium text-foreground/80 mb-1">
                    Cycle name
                  </label>
                  <input
                    id="cycle-name"
                    name="name"
                    placeholder="e.g. Fall 2027"
                    required
                    autoFocus
                    autoComplete="off"
                    className="w-full px-3 py-2 text-sm text-foreground border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="cycle-type" className="block text-sm font-medium text-foreground/80 mb-1">
                    Cycle type
                  </label>
                  <select
                    id="cycle-type"
                    name="cycleType"
                    defaultValue="Standard"
                    className="w-full px-3 py-2 text-sm text-foreground border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Standard">Standard hire</option>
                    <option value="InternToFull">Intern → Full-time conversion</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    InternToFull cycles use a shortform (no challenge) and skip interviews.
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-gray-300 rounded-md hover:bg-muted/50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                  >
                    Create
                  </button>
                </div>
              </Form>
            </div>
          </div>
        </>
      )}


      <ActiveCycleHero cycles={cycles} />
      <PastCycles cycles={cycles} />
    </div>
  );
}

// Single source of truth for hero cycle selection.
// ActiveCycleHero features the result; PastCycles excludes it.
// Prefers Open/UnderReview (truly active) over Draft.
function selectHeroCycle(cycles: any[]): any | undefined {
  return (
    cycles.find((c: any) => {
      const status = c.statusUpdates[0]?.newStatus;
      return status && ["Open", "UnderReview"].includes(status);
    }) ??
    cycles.find((c: any) => {
      const status = c.statusUpdates[0]?.newStatus;
      return status === "Draft";
    })
  );
}

function ActiveCycleHero({ cycles }: { cycles: any[] }) {
  const activeCycle = selectHeroCycle(cycles);

  if (!activeCycle) {
    return (
      <div className="bg-card border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
        <p className="text-muted-foreground mb-1">No active hiring cycle.</p>
        <p className="text-sm text-muted-foreground/70">Create a new cycle to get started.</p>
      </div>
    );
  }

  const currentStatus = activeCycle.statusUpdates[0]?.newStatus ?? "Draft";
  const domains = activeCycle.domains.map((d: any) => d.domain.name);

  return (
    <Link
      to={`/hiring/lead/cycle/${activeCycle.id}`}
      className="block bg-card border border-border rounded-xl p-6 hover:border-blue-300 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-foreground">{activeCycle.name}</span>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[currentStatus]}`}>
              {STATUS_LABELS[currentStatus]}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>{domains.join(", ") || "No domains"}</span>
            <span>·</span>
            <span>{activeCycle._count.applications} application{activeCycle._count.applications !== 1 ? "s" : ""}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-blue-600 font-medium text-sm">
          Manage Cycle
          <ChevronRight className="w-4 h-4" />
        </div>
      </div>
    </Link>
  );
}

function PastCycles({ cycles }: { cycles: any[] }) {
  const [open, setOpen] = useState(false);

  // Exclude the hero cycle (same selection as ActiveCycleHero)
  const heroCycle = selectHeroCycle(cycles);
  const pastCycles = cycles.filter((c: any) => c.id !== heroCycle?.id);

  if (pastCycles.length === 0) return null;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 flex items-center justify-between bg-muted/50 hover:bg-muted transition text-left"
      >
        <span className="text-sm font-semibold text-foreground/80">Past Cycles ({pastCycles.length})</span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground/70 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="divide-y divide-gray-100">
          {pastCycles.map((cycle: any) => {
            const currentStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";
            const domains = cycle.domains.map((d: any) => d.domain.name);
            return (
              <Link
                key={cycle.id}
                to={`/hiring/lead/cycle/${cycle.id}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">{cycle.name}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[currentStatus]}`}>
                    {STATUS_LABELS[currentStatus]}
                  </span>
                  <span className="text-xs text-muted-foreground/70">
                    {domains.join(", ")} · {cycle._count.applications} app{cycle._count.applications !== 1 ? "s" : ""}
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/70" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
