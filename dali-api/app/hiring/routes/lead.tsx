import { useState } from "react";
import { Form, Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/lead";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin, getUserRoles, currentTerm } from "~/lib/roles";
import { ChevronRight, ChevronDown, Plus } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { STATUS_TONES, STATUS_LABELS } from "~/hiring/lib/labels";
import { Select } from "~/components/ui/floating";
import {
  APPLICANT_GROUPS,
  APPLICANTS_LABELS,
  DEFAULT_STAGES,
  defaultTimelineFor,
  isAdminOnlyCycle,
} from "~/hiring/lib/applicant-groups";
import { linkCoreDomain } from "~/hiring/lib/cycle-applicants.server";
import { APPLICANT_GROUP_CONFIG } from "~/hiring/lib/applicant-groups.server";
import { defaultApplicationWindow, termWeek } from "~/hiring/lib/cycle-phases";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import { APPLICATION_TZ, zonedDayEndUtc, zonedDayStartUtc } from "~/lib/timezone";
import type { CycleApplicants } from "~/generated/prisma/client";

export const meta: Route.MetaFunction = () => [{ title: "Cycles · Hiring · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isCore) return redirect("/");

  const allCycles = await prisma.applicationCycle.findMany({
    include: {
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      domains: { include: { domain: true } },
      term: { select: { code: true, startDate: true } },
      _count: { select: { applications: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  // Lab members cycles are Admin-managed only; hide them from non-admin Core
  // members who otherwise use this dashboard to run the other cycles.
  const cycles = roles.isAdmin
    ? allCycles
    : allCycles.filter((c) => !isAdminOnlyCycle(c.applicants));

  // Terms a cycle can run in: the current one and anything later, soonest first.
  const current = await currentTerm(request);
  const terms = await prisma.term.findMany({
    where: current ? { sortKey: { gte: current.sortKey } } : {},
    orderBy: { sortKey: "asc" },
    select: { id: true, code: true },
  });

  return {
    cycles,
    terms,
    currentTermId: current?.id ?? null,
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
  const applicantsRaw = formData.get("applicants") as string;
  const applicants: CycleApplicants = (APPLICANT_GROUPS as readonly string[]).includes(applicantsRaw)
    ? (applicantsRaw as CycleApplicants)
    : "Students";
  if (!name) return { error: "Name is required" };

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  // Lab members cycles are Admin-only to create; the rest stay at the Core
  // (hiring-lead) tier.
  const canCreate =
    isAdminOnlyCycle(applicants)
      ? await isAdmin(auth.user.sub)
      : await isCore(auth.user.sub);
  if (!canCreate) return redirect("/");
  const adminUser = await prisma.user.findUniqueOrThrow({
    where: { id: auth.user.sub },
  });

  // The term dates the phases; its default application window (Week 4 to the
  // end of Week 5) fills the open and close dates, editable in setup.
  const termId = (formData.get("termId") as string) || null;
  const term = termId
    ? await prisma.term.findUnique({ where: { id: termId }, select: { id: true, startDate: true } })
    : null;
  const window = term ? defaultApplicationWindow(term.startDate) : null;
  const toYmd = (d: Date) => [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()] as const;

  const cycle = await prisma.applicationCycle.create({
    data: {
      name,
      applicants,
      ...DEFAULT_STAGES[applicants],
      timeline: defaultTimelineFor(applicants),
      termId: term?.id ?? null,
      openDate: window ? zonedDayStartUtc(...toYmd(window.open), APPLICATION_TZ) : null,
      closeDate: window ? zonedDayEndUtc(...toYmd(window.closeDay), APPLICATION_TZ) : null,
      statusUpdates: {
        create: { newStatus: "Draft", userId: adminUser.id },
      },
    },
  });

  // Application form is bound in setup, not here: cycles start with no form so
  // an operator can reuse an existing Drive Form (bind picker) or create a fresh
  // one on demand — auto-creating one per cycle left unused forms behind.

  // Lab members cycles aren't domain-scoped: link the single CORE domain and
  // seed the reviewer pool (editable afterward).
  if (APPLICANT_GROUP_CONFIG[applicants].domainStrategy === "single-core-domain") {
    await linkCoreDomain(cycle.id, applicants);
  }

  return redirect(`/hiring/lead/cycle/${cycle.id}`);
}

export default function HiringLeadDashboard() {
  const data = useLoaderData<typeof loader>() as any;
  const cycles = data?.cycles ?? [];
  const [showModal, setShowModal] = useState(false);
  const { pageTitle, formClass, fieldLabel, formTrigger } = useOsChrome();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className={pageTitle}>Cycles</h1>
        <button type="button" className="os-add-btn" onClick={() => setShowModal(true)}>
          <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
          New cycle
        </button>
      </header>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        labelledBy="new-cycle-title"
        containerClassName={modalCardClass("max-w-md")}
      >
        <ModalHeader
          titleId="new-cycle-title"
          title="New cycle"
          onClose={() => setShowModal(false)}
        />
        <Form
          method="post"
          onSubmit={() => setShowModal(false)}
          className={cn(formClass, "flex flex-col gap-4")}
        >
          <label className={fieldLabel}>
            Name
            <input
              name="name"
              placeholder="e.g. Fall 2027"
              required
              autoFocus
              autoComplete="off"
            />
          </label>
          <div className={fieldLabel}>
            Term
            <Select
              name="termId"
              ariaLabel="Term"
              defaultValue={data?.currentTermId ?? ""}
              options={(data?.terms ?? []).map((t: { id: string; code: string }) => ({
                value: t.id,
                label: t.id === data?.currentTermId ? `${t.code} · current` : t.code,
              }))}
              buttonClassName={formTrigger}
            />
            <span className="text-xs">Phase weeks count from this term's start.</span>
          </div>
          <div className={fieldLabel}>
            Applicants
            <Select
              name="applicants"
              ariaLabel="Applicants"
              defaultValue="Students"
              options={APPLICANT_GROUPS
                // Lab members cycles are Admin-only to create.
                .filter((a) => data?.pillRoles?.isAdmin || !isAdminOnlyCycle(a))
                .map((a) => ({ value: a, label: APPLICANTS_LABELS[a] }))}
              buttonClassName={formTrigger}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className={buttonClasses("secondary")}
            >
              Cancel
            </button>
            <button type="submit" className={buttonClasses("primary")}>
              Create
            </button>
          </div>
        </Form>
      </Modal>

      <ActiveCycles cycles={cycles} />
      <PastCycles cycles={cycles} />
    </div>
  );
}

function setupLinkFor(cycle: any): string {
  return `/hiring/lead/cycle/${cycle.id}`;
}

// Any number of cycles can run at once, so every cycle that isn't finished
// (Draft, Open, UnderReview) is listed as active, newest first.
function isCurrentCycle(cycle: any): boolean {
  const status = cycle.statusUpdates[0]?.newStatus ?? "Draft";
  return status !== "Completed";
}

function StatusBadge({ status }: { status: string }) {
  return <Pill dot={STATUS_TONES[status] ?? "neutral"}>{STATUS_LABELS[status]}</Pill>;
}

function cycleMeta(cycle: any): string {
  const domains = cycle.domains.map((d: any) => d.domain.name).join(", ") || "No domains";
  const n = cycle._count.applications;
  const parts = [domains, `${n} application${n === 1 ? "" : "s"}`];
  if (cycle.term) {
    const week = termWeek(new Date(cycle.term.startDate));
    parts.unshift(week >= 1 && week <= 10 ? `${cycle.term.code} · Week ${week}` : cycle.term.code);
  }
  return parts.join(" · ");
}

function ActiveCycles({ cycles }: { cycles: any[] }) {
  const { panel, sectionShell, sectionTitle, bodyText } = useOsChrome();
  const current = cycles.filter(isCurrentCycle);

  return (
    <section className={sectionShell}>
      <h2 className={sectionTitle}>Active</h2>
      {current.length === 0 ? (
        <div className={cn(panel, "p-10 text-center")}>
          <p className="font-heading font-semibold text-foreground">No active cycle</p>
          <p className={cn(bodyText, "mt-1")}>Create a cycle to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {current.map((c) => {
            const currentStatus = c.statusUpdates[0]?.newStatus ?? "Draft";
            return (
              <Link
                key={c.id}
                to={setupLinkFor(c)}
                className={cn(
                  panel,
                  "group flex items-center justify-between gap-4 p-6 transition-colors hover:bg-os-card-hover",
                )}
              >
                <div className="flex min-w-0 flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-widest text-os-grey">
                    {APPLICANTS_LABELS[c.applicants as CycleApplicants]}
                  </span>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-heading text-2xl font-medium text-foreground">
                      {c.name}
                    </span>
                    <StatusBadge status={currentStatus} />
                  </div>
                  <span className={bodyText}>{cycleMeta(c)}</span>
                </div>
                <ChevronRight
                  className="h-5 w-5 shrink-0 text-os-grey transition-colors group-hover:text-os-accent"
                  aria-hidden
                />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PastCycles({ cycles }: { cycles: any[] }) {
  const { panel, sectionShell, sectionTitle, bodyText } = useOsChrome();
  const [open, setOpen] = useState(false);

  const pastCycles = cycles.filter((c: any) => !isCurrentCycle(c));

  if (pastCycles.length === 0) return null;

  return (
    <section className={sectionShell}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn(sectionTitle, "inline-flex items-center gap-2 self-start")}
      >
        Past
        <span className="tabular-nums text-os-grey">{pastCycles.length}</span>
        <ChevronDown
          className={cn("h-4 w-4 text-os-grey transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && (
        <ul className={cn(panel, "overflow-hidden")}>
          {pastCycles.map((cycle: any) => {
            const currentStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";
            return (
              <li key={cycle.id} className="border-t border-os-container first:border-t-0">
                <Link
                  to={setupLinkFor(cycle)}
                  className="flex items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-os-card-hover"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <span className="font-medium text-foreground">{cycle.name}</span>
                    <span className="text-xs font-semibold uppercase tracking-widest text-os-grey">
                      {APPLICANTS_LABELS[cycle.applicants as CycleApplicants]}
                    </span>
                    <StatusBadge status={currentStatus} />
                    <span className={bodyText}>{cycleMeta(cycle)}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-os-grey" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
