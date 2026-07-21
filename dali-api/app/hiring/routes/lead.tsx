import { useState } from "react";
import { Form, Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/lead";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, getUserRoles } from "~/lib/roles";
import { hiringPills } from "~/hiring/components/hiringPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { ChevronRight, ChevronDown, Plus, Layers } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import { PageHeader } from "~/hiring/components/PageHeader";
import { EmptyState } from "~/hiring/components/EmptyState";
import { CycleStatusPill } from "~/hiring/components/Pill";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [{ title: "Hiring lead · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isCore) return redirect("/");

  const cycles = await prisma.applicationCycle.findMany({
    include: {
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      domains: { include: { domain: true } },
      _count: { select: { applications: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return {
    cycles,
    pillRoles: {
      isCore: roles.isCore,
      isDomainLead: roles.isDomainLead,
      isAdmin: roles.isAdmin,
      isInterviewer: roles.isInterviewer,
    },
  };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const name = (formData.get("name") as string)?.trim();
  const cycleTypeRaw = (formData.get("cycleType") as string) ?? "Standard";
  const cycleType = cycleTypeRaw === "InternToFull" ? "InternToFull" : "Standard";
  if (!name) return { error: "Name is required" };

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) return redirect("/");
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
    <div className="flex flex-col gap-5">
      {data?.pillRoles && (
        <AreaPillNav items={hiringPills({ ...data.pillRoles, active: "cycles" })} />
      )}
      <PageHeader
        title="Hiring cycles"
        subtitle="Set up, run, and revisit each recruiting cycle."
        actions={
          <Button variant="primary" onClick={() => setShowModal(true)}>
            <Plus className="h-4 w-4" />
            New cycle
          </Button>
        }
      />

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        labelledBy="new-cycle-title"
        containerClassName="bg-card rounded-lg shadow-xl w-full max-w-sm p-6 space-y-4 my-auto"
      >
        <>
          <ModalHeader
            titleId="new-cycle-title"
            title="New Hiring Cycle"
            onClose={() => setShowModal(false)}
            className="mb-0"
          />
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
                    className="w-full px-3 py-2 text-sm text-foreground bg-card border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
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
                    className="w-full px-3 py-2 text-sm text-foreground bg-card border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                  >
                    <option value="Standard">Standard hire</option>
                    <option value="InternToFull">Fellowship</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Fellowship cycles use a shortform (no challenge) and skip interviews.
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setShowModal(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary">
                    Create cycle
                  </Button>
                </div>
              </Form>
        </>
      </Modal>


      <ActiveCycleHero cycles={cycles} />
      <PastCycles cycles={cycles} />
    </div>
  );
}

const CYCLE_TYPE_LABELS: Record<string, string> = {
  Standard: "Standard hire",
  InternToFull: "Fellowship",
};

function heroLinkFor(cycle: any): string {
  return cycle.cycleType === "InternToFull"
    ? `/hiring/lead/intern-to-full-cycle/${cycle.id}`
    : `/hiring/lead/cycle/${cycle.id}`;
}

// Pick at most one hero per cycleType so Standard and InternToFull cycles
// don't fight over the single hero slot when both are active concurrently.
// Within a type, prefers Open/UnderReview over Draft.
function selectHeroCycles(cycles: any[]): any[] {
  const byType = new Map<string, any>();
  for (const c of cycles) {
    const status = c.statusUpdates[0]?.newStatus;
    const isActive = status && ["Open", "UnderReview"].includes(status);
    const isDraft = status === "Draft";
    if (!isActive && !isDraft) continue;
    const existing = byType.get(c.cycleType);
    if (!existing) {
      byType.set(c.cycleType, c);
      continue;
    }
    const existingActive =
      existing.statusUpdates[0]?.newStatus &&
      ["Open", "UnderReview"].includes(existing.statusUpdates[0].newStatus);
    if (isActive && !existingActive) byType.set(c.cycleType, c);
  }
  // Standard first so it stays visually anchored when InternToFull is also active.
  const order = ["Standard", "InternToFull"];
  return order.flatMap((t) => (byType.has(t) ? [byType.get(t)] : []));
}

function ActiveCycleHero({ cycles }: { cycles: any[] }) {
  const heroes = selectHeroCycles(cycles);

  if (heroes.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No active hiring cycle"
        description="Create a cycle to open applications, assign reviewers, and start moving candidates through the funnel."
      />
    );
  }

  return (
    <div className="space-y-3">
      {heroes.map((c) => {
        const currentStatus = c.statusUpdates[0]?.newStatus ?? "Draft";
        const domains = c.domains.map((d: any) => d.domain.name);
        return (
          <Link
            key={c.id}
            to={heroLinkFor(c)}
            className="block bg-card border border-border rounded-xl p-6 hover:border-accent-coral/40 hover:shadow-md transition-all"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {CYCLE_TYPE_LABELS[c.cycleType] ?? c.cycleType}
                  </span>
                  <span className="font-heading text-xl font-bold text-foreground">{c.name}</span>
                  <CycleStatusPill status={currentStatus} />
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>{domains.join(", ") || "No domains"}</span>
                  <span>·</span>
                  <span>{c._count.applications} application{c._count.applications !== 1 ? "s" : ""}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-accent-coral font-medium text-sm">
                Manage cycle
                <ChevronRight className="w-4 h-4" />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function PastCycles({ cycles }: { cycles: any[] }) {
  const [open, setOpen] = useState(false);

  // Exclude every hero (one per cycleType) so we don't double-list active cycles.
  const heroIds = new Set(selectHeroCycles(cycles).map((c) => c.id));
  const pastCycles = cycles.filter((c: any) => !heroIds.has(c.id));

  if (pastCycles.length === 0) return null;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full px-5 py-3 flex items-center justify-between bg-muted/50 hover:bg-muted transition text-left"
      >
        <span className="text-sm font-semibold text-foreground/80">Past cycles ({pastCycles.length})</span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="divide-y divide-border">
          {pastCycles.map((cycle: any) => {
            const currentStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";
            const domains = cycle.domains.map((d: any) => d.domain.name);
            return (
              <Link
                key={cycle.id}
                to={heroLinkFor(cycle)}
                className="flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {CYCLE_TYPE_LABELS[cycle.cycleType] ?? cycle.cycleType}
                  </span>
                  <span className="text-sm font-medium text-foreground">{cycle.name}</span>
                  <CycleStatusPill status={currentStatus} />
                  <span className="text-xs text-muted-foreground">
                    {domains.join(", ")} · {cycle._count.applications} app{cycle._count.applications !== 1 ? "s" : ""}
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
