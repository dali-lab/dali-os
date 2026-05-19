import { useMemo, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/projects.project-bids";
import { requireAuth } from "~/lib/auth";
import { canManageStaffing, canViewStaffing, currentTerm } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { ensureStaffingCycle } from "../lib/staffing-cycle";
import {
  getSlotBinding,
  listSelectableForms,
  setSlotBinding,
  setSlotColumnMapping,
} from "../lib/form-slots";
import { SubmissionFilters } from "../components/SubmissionFilters";
import { SlotFormPicker } from "../components/SlotFormPicker";
import { SlotColumnMapper } from "../components/SlotColumnMapper";
import { TermFilter } from "~/components/TermFilter";
import { resolveTermFilter } from "~/lib/terms";
import {
  parseColumnMapping,
  validateMapping,
  type ColumnMapping,
} from "../lib/slot-roles";
import type { Question } from "~/types";

const SLOT = "project-bids" as const;

export const meta: Route.MetaFunction = () => [
  { title: "Project Bids · DALI OS" },
];

// Read-only database of received Project Bid submissions for the current
// cycle. Core/Admin only. Members fill whichever generic form a staffing
// manager bound to this cycle's "project-bids" slot (see form-slots).
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const {
    terms: termOptions,
    selected: selectedTerm,
    termId: filterTermId,
    isAll,
  } = await resolveTermFilter(request);

  const fallbackTerm = await currentTerm();
  if (!fallbackTerm && termOptions.length === 0)
    return { gate: "no-cycle" as const };

  // Which staffing cycle(s) feed the board:
  //  - All terms → every existing cycle (read-only aggregate; don't create).
  //  - A specific term (default = current) → that term's cycle, get-or-create
  //    so the live cycle keeps its existing auto-provision behavior.
  let cycleIds: string[];
  let cycleName: string;
  let singleCycleId: string | null;
  if (isAll) {
    const cycles = await prisma.staffingCycle.findMany({
      select: { id: true },
    });
    cycleIds = cycles.map((c) => c.id);
    cycleName = "all terms";
    singleCycleId = null;
  } else {
    const t =
      termOptions.find((o) => o.id === filterTermId) ??
      (fallbackTerm
        ? { id: fallbackTerm.id, code: fallbackTerm.code }
        : termOptions[0]);
    const cycle = await ensureStaffingCycle(t.id, t.code);
    cycleIds = [cycle.id];
    cycleName = cycle.name;
    singleCycleId = cycle.id;
  }

  // A submission only exists in relation to a bound form: a member's bids
  // show here only if they actually submitted the cycle's Project Bids form
  // (a FormSubmission stamped with this cycle + the project-bids slot). This
  // filters out legacy/seed StaffingPreference rows that never came through a
  // form, so an unbound cycle shows nothing rather than phantom bids.
  const formSubs = await prisma.formSubmission.findMany({
    where: {
      staffingCycleId: { in: cycleIds },
      slot: SLOT,
      userId: { not: null },
    },
    select: { userId: true },
  });
  const submittedUserIds = [
    ...new Set(formSubs.map((s) => s.userId).filter((id): id is string => !!id)),
  ];

  const rows = submittedUserIds.length
    ? await prisma.staffingPreference.findMany({
        where: {
          staffingCycleId: { in: cycleIds },
          userId: { in: submittedUserIds },
        },
        orderBy: [{ userId: "asc" }, { preferenceRank: "asc" }],
        select: {
          userId: true,
          projectId: true,
          domainId: true,
          preferenceRank: true,
          level: true,
          notes: true,
          user: { select: { firstName: true, lastName: true, daliEmail: true } },
        },
      })
    : [];

  // StaffingPreference stores projectId/domainId as bare strings (no
  // relations), so resolve display names in one batched lookup each.
  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const domainIds = [...new Set(rows.map((r) => r.domainId))];
  const [projects, domains] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    }),
    prisma.domain.findMany({
      where: { id: { in: domainIds } },
      select: { id: true, displayName: true },
    }),
  ]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const domainName = new Map(domains.map((d) => [d.id, d.displayName]));

  const byUser = new Map<
    string,
    {
      userId: string;
      name: string;
      email: string | null;
      bids: {
        rank: number;
        project: string;
        domainId: string;
        domain: string;
        level: string;
        notes: string | null;
      }[];
    }
  >();
  for (const r of rows) {
    const existing = byUser.get(r.userId);
    const bid = {
      rank: r.preferenceRank,
      project: projectName.get(r.projectId) ?? "(unknown project)",
      domainId: r.domainId,
      domain: domainName.get(r.domainId) ?? "(unknown domain)",
      level: r.level as string,
      notes: r.notes,
    };
    if (!existing) {
      byUser.set(r.userId, {
        userId: r.userId,
        name: `${r.user.firstName} ${r.user.lastName}`,
        email: r.user.daliEmail,
        bids: [bid],
      });
    } else {
      existing.bids.push(bid);
    }
  }

  const submissions = [...byUser.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  // Distinct domains across all bids, for the filter dropdown.
  const domainFilter = [...domainName.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // The generic-form slot binding is per-cycle, so it only applies to the
  // single-term view. In the all-terms aggregate there's no one slot to bind,
  // so the picker is hidden (singleCycleId === null).
  const canManage = await canManageStaffing(auth.user.sub);
  const [binding, selectableForms] = await Promise.all([
    singleCycleId ? getSlotBinding(singleCycleId, SLOT) : Promise.resolve(null),
    canManage && singleCycleId
      ? listSelectableForms()
      : Promise.resolve([]),
  ]);

  // The bound form's latest-version questions drive the column mapper, and
  // validating the saved mapping against them warns a manager (before any
  // member submits) that the mapping is missing/stale.
  let formQuestions: {
    key: string;
    label: string;
    type: string;
    referenceSource?: string;
  }[] = [];
  let mappingWarning: string | null = null;
  if (binding) {
    const latest = await prisma.formVersion.findFirst({
      where: { form: { id: binding.formId } },
      orderBy: { versionNumber: "desc" },
      select: { questions: true },
    });
    const qs = (latest?.questions as unknown as Question[]) ?? [];
    formQuestions = qs.map((q) => ({
      key: q.key,
      label: q.data.label,
      type: q.type,
      referenceSource: q.data.referenceSource,
    }));
    const check = validateMapping("project-bids", qs, binding.mapping);
    if (!check.ok) mappingWarning = check.reason;
  }

  // No form bound to this single cycle ⇒ there can be no submissions; the
  // page says so explicitly instead of rendering an empty/!misleading table.
  // (The all-terms aggregate has no single slot to bind, so it's exempt.)
  const noFormConnected = !isAll && !binding;

  return {
    gate: "ok" as const,
    cycle: { name: cycleName },
    termOptions,
    selectedTerm,
    isAll,
    submissions,
    domainFilter,
    canManage,
    binding,
    selectableForms,
    formQuestions,
    mappingWarning,
    noFormConnected,
  };
}

// Staffing managers bind a generic form to this cycle's Project Bids slot.
// Gated tighter than the loader: viewing the board is Core/Admin, changing
// the form requires staffing management.
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await canManageStaffing(auth.user.sub)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const term = await currentTerm();
  if (!term)
    return Response.json({ error: "No active staffing term." }, { status: 400 });
  const cycle = await ensureStaffingCycle(term.id, term.code);

  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "set-slot-form") {
    const formId = String(form.get("formId") ?? "");
    const result = await setSlotBinding(cycle.id, SLOT, formId, auth.user.sub);
    if (!result.ok)
      return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ ok: true });
  }

  if (intent === "set-slot-mapping") {
    const binding = await getSlotBinding(cycle.id, SLOT);
    if (!binding)
      return Response.json(
        { error: "Bind a form before mapping its columns." },
        { status: 400 },
      );
    const mapping = parseColumnMapping(safeJsonParse(form.get("mapping")));
    if (!mapping)
      return Response.json({ error: "Invalid mapping." }, { status: 400 });
    // Validate against the bound form's current questions before saving.
    const latest = await prisma.formVersion.findFirst({
      where: { form: { id: binding.formId } },
      orderBy: { versionNumber: "desc" },
      select: { questions: true },
    });
    const qs = (latest?.questions as unknown as Question[]) ?? [];
    const check = validateMapping(SLOT, qs, mapping);
    if (!check.ok)
      return Response.json({ error: check.reason }, { status: 400 });
    const result = await setSlotColumnMapping(
      cycle.id,
      SLOT,
      mapping as ColumnMapping,
      auth.user.sub,
    );
    if (!result.ok)
      return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

function safeJsonParse(v: FormDataEntryValue | null): unknown {
  if (typeof v !== "string") return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export default function ProjectBidsDatabase() {
  const data = useLoaderData<typeof loader>();

  if (data.gate === "no-cycle") {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <p className="text-sm text-muted-foreground">
          No active staffing term right now.
        </p>
      </div>
    );
  }

  return <Loaded data={data} />;
}

function Loaded({
  data,
}: {
  data: Extract<Awaited<ReturnType<typeof loader>>, { gate: "ok" }>;
}) {
  const [query, setQuery] = useState("");
  const [domainId, setDomainId] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.submissions.filter((s) => {
      if (q && !`${s.name} ${s.email ?? ""}`.toLowerCase().includes(q)) {
        return false;
      }
      if (domainId && !s.bids.some((b) => b.domainId === domainId)) {
        return false;
      }
      return true;
    });
  }, [data.submissions, query, domainId]);

  return (
    <div className="flex flex-col gap-4">
      <Header cycleName={data.cycle.name} />

      {!data.isAll && (
        <SlotFormPicker
          slotLabel="Project Bids"
          binding={data.binding}
          forms={data.selectableForms}
          canManage={data.canManage}
        />
      )}

      {!data.isAll && data.binding && (
        <SlotColumnMapper
          slot="project-bids"
          questions={data.formQuestions}
          mapping={data.binding.mapping}
          cycleTerms={[]}
          canManage={data.canManage}
        />
      )}

      {data.mappingWarning && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span className="font-medium">Bids won’t be recorded yet:</span>{" "}
          {data.mappingWarning}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <SubmissionFilters
            query={query}
            onQueryChange={setQuery}
            domainId={domainId}
            onDomainChange={setDomainId}
            domains={data.domainFilter}
          />
        </div>
        <TermFilter terms={data.termOptions} selected={data.selectedTerm} />
      </div>

      <div className="bg-card border border-border rounded-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">Submissions</h2>
          <span className="text-xs text-muted-foreground">
            {filtered.length}
            {filtered.length === data.submissions.length
              ? ""
              : ` of ${data.submissions.length}`}{" "}
            member
            {data.submissions.length === 1 ? "" : "s"}
          </span>
        </div>
        {data.noFormConnected ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No Project Bids form is connected for this term. Connect a form
            above so members can submit bids — bids only exist through the
            form.
          </div>
        ) : data.submissions.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No bid submissions yet.
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No members match the current filters.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((s) => (
              <li key={s.userId} className="px-4 py-3">
                <div className="mb-2">
                  <div className="text-sm text-foreground">{s.name}</div>
                  {s.email && (
                    <div className="text-xs text-muted-foreground">
                      {s.email}
                    </div>
                  )}
                </div>
                <ol className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {s.bids.map((b) => (
                    <li
                      key={b.rank}
                      className="flex items-start gap-2 text-sm"
                    >
                      <span className="shrink-0 w-5 h-5 rounded-full bg-accent-coral text-white text-xs font-semibold flex items-center justify-center">
                        {b.rank}
                      </span>
                      <div className="min-w-0">
                        <div className="text-foreground">
                          {b.project}
                          <span className="text-muted-foreground">
                            {" "}
                            · {b.domain} · {b.level}
                          </span>
                        </div>
                        {b.notes && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {b.notes}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Header({ cycleName }: { cycleName?: string }) {
  return (
    <header>
      <h1 className="font-heading text-2xl font-bold text-foreground">
        Project Bids
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        Received bid submissions{cycleName ? ` for ${cycleName}` : ""}.
      </p>
    </header>
  );
}
